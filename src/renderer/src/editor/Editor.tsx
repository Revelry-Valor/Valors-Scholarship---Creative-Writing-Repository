// The writing surface. Wraps CodeMirror with the vault-aware extensions and
// handles autosave, block ids, and the "this block appears on N pages" guard.
import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, highlightActiveLine, dropCursor } from '@codemirror/view';
import { Annotation, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { planBlockIds } from '../../../core/document';
import { analysisField, envField, openEntityAtCursor, setEnv, writingExtensions, type AnalyzedDocBlock, type EditorEnv } from './extensions';
import { formattingExtensions, paragraphKeys } from './format';
import { useApp } from '../state';
import { api } from '../api';

const internal = Annotation.define<'ids' | 'reload'>();

const flashEffect = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) if (e.is(flashEffect)) v = e.value ? Decoration.set([Decoration.mark({ class: 'cm-flash' }).range(e.value.from, e.value.to)]) : Decoration.none;
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const markdownStyle = HighlightStyle.define([
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '0.9em' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.quote, fontStyle: 'italic' },
]);

export interface EditorHandle {
  view: EditorView;
  flush(): Promise<void>;
}

export interface EditorProps {
  initial: string;
  /** Bumps when the stored text changed outside this editor. */
  external?: { body: string; version: number };
  directOwner?: string;
  mode: 'document' | 'block';
  placeholder?: string;
  focusBlock?: string;
  autoFocus?: boolean;
  onSave: (body: string) => Promise<{ body: string; changed: boolean } | void>;
  onCancel?: () => void;
  /** Called before saving when blocks that appear on other pages were removed. */
  confirmRemoval?: (removed: Array<{ id: string; pages: number; text: string }>) => Promise<'delete' | 'move' | 'restore'>;
  onReady?: (h: EditorHandle) => void;
  /** Called after the selection or text changes (drives the formatting toolbar). */
  onUpdate?: (view: EditorView) => void;
  /** Extra CodeMirror extensions (the profile page adds its "written elsewhere" slots). */
  extensions?: Extension[];
}

function pagesOf(b: AnalyzedDocBlock) {
  return 1 + b.analysis.filedTo.filter((f) => f.via !== 'direct').length;
}

// Files end with a newline; the editor doesn't show that empty last line, so
// clicking below the text never attaches new words to the last paragraph.
const stripEnd = (s: string) => s.replace(/\n+$/, '');

export function Editor(props: EditorProps) {
  const app = useApp();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void> | null>(null);
  const lastSaved = useRef(stripEnd(props.initial));
  const savedBlocks = useRef(new Map<string, { pages: number; text: string }>());
  const appRef = useRef(app);
  appRef.current = app;

  const env = (): EditorEnv => {
    const a = appRef.current;
    return {
      ctx: a.analysisContext(),
      entities: a.entityById,
      templates: a.nameData.templates,
      relationTypes: a.nameData.relationTypes,
      lastUsedType: a.nameData.settings.lastUsedType ?? a.nameData.settings.defaultEntityType,
      topicType: a.templates.has('topic') ? 'topic' : '',
      directOwner: propsRef.current.directOwner,
      raw: a.rawMarkup,
      openEntity: (id) => a.openTab({ kind: 'entity', id }),
      createEntity: async (name, type) => {
        try {
          await api.createEntity({ name, type });
          await appRef.current.refreshNames();
        } catch (err) {
          appRef.current.notify((err as Error).message, 'error');
        }
      },
      onCurrentBlock:
        propsRef.current.mode === 'document'
          ? (b) =>
              a.setCurrentBlock(
                b
                  ? {
                      text: b.text,
                      id: b.id,
                      filedTo: b.analysis.filedTo,
                      warnings: b.analysis.warnings,
                      fields: b.analysis.fields,
                      relations: b.analysis.relations,
                      creates: b.analysis.creates,
                    }
                  : null,
              )
          : undefined,
    };
  };

  const rememberBlocks = (view: EditorView) => {
    const m = new Map<string, { pages: number; text: string }>();
    for (const b of view.state.field(analysisField)) if (b.id) m.set(b.id, { pages: pagesOf(b), text: b.text });
    savedBlocks.current = m;
  };

  const save = async (): Promise<void> => {
    const view = viewRef.current;
    if (!view) return;
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const run = (async () => {
      let text = view.state.doc.toString();
      if (text === lastSaved.current) {
        app.setSaveState('saved');
        return;
      }
      app.setSaveState('saving');
      if (propsRef.current.mode === 'document') {
        // Give new blocks their permanent ids, keeping the cursor before the hidden id.
        const edits = planBlockIds(text);
        if (edits.length) {
          const changes = view.state.changes(edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })));
          const sel = view.state.selection.main;
          view.dispatch({
            changes,
            selection: { anchor: changes.mapPos(sel.anchor, -1), head: changes.mapPos(sel.head, -1) },
            annotations: internal.of('ids'),
          });
          text = view.state.doc.toString();
        }
        // Removing a block that also appears on profiles asks first (spec 8, T8).
        const present = new Set(view.state.field(analysisField).map((b) => b.id));
        const removed = [...savedBlocks.current.entries()].filter(([id, info]) => !present.has(id) && info.pages > 1).map(([id, info]) => ({ id, ...info }));
        if (removed.length && propsRef.current.confirmRemoval) {
          const choice = await propsRef.current.confirmRemoval(removed);
          if (choice === 'restore') {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lastSaved.current }, annotations: internal.of('reload') });
            app.setSaveState('saved');
            return;
          }
        }
      }
      try {
        const res = await propsRef.current.onSave(propsRef.current.mode === 'document' && text ? `${text}\n` : text);
        lastSaved.current = res ? stripEnd(res.body) : text;
        if (res && res.changed && view.state.doc.toString() === text) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: stripEnd(res.body) }, annotations: internal.of('reload') });
        }
        rememberBlocks(view);
        app.setSaveState(view.state.doc.toString() === lastSaved.current ? 'saved' : 'unsaved');
      } catch (err) {
        app.setSaveState('error');
        app.notify(`Could not save: ${(err as Error).message}`, 'error');
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  };

  useEffect(() => {
    const isBlock = props.mode === 'block';
    const state = EditorState.create({
      doc: stripEnd(props.initial),
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        highlightSelectionMatches(),
        isBlock ? [] : highlightActiveLine(),
        closeBrackets(),
        markdown({ base: markdownLanguage, addKeymap: false }),
        syntaxHighlighting(markdownStyle),
        formattingExtensions(),
        cmPlaceholder(props.placeholder ?? ''),
        flashField,
        writingExtensions({ stripe: !isBlock }),
        props.extensions ?? [],
        keymap.of([
          { key: 'Mod-Enter', run: (v) => (isBlock ? (void save(), true) : openEntityAtCursor(v)) },
          { key: 'Mod-s', run: () => (void save(), true), preventDefault: true },
          ...(isBlock
            ? [
                {
                  key: 'Escape',
                  run: () => {
                    propsRef.current.onCancel?.();
                    return true;
                  },
                },
              ]
            : []),
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...(isBlock ? [] : paragraphKeys),
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged || u.selectionSet || u.focusChanged) propsRef.current.onUpdate?.(u.view);
          if (!u.docChanged) return;
          const kind = u.transactions.map((tr) => tr.annotation(internal)).find(Boolean);
          if (kind) return;
          if (isBlock) return;
          app.setSaveState('unsaved');
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 900);
        }),
        EditorView.domEventHandlers({
          blur: () => {
            if (isBlock) {
              // Leaving an inline block editor saves it.
              setTimeout(() => {
                if (viewRef.current && !viewRef.current.hasFocus) void save();
              }, 150);
            } else void save();
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current! });
    viewRef.current = view;
    view.dispatch({ effects: setEnv.of(env()) });
    rememberBlocks(view);
    if (props.autoFocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
    props.onReady?.({ view, flush: save });
    return () => {
      clearTimeout(timer.current);
      if (!isBlock && view.state.doc.toString() !== lastSaved.current) void propsRef.current.onSave(`${view.state.doc.toString()}\n`);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Names, templates or raw mode changed → re-analyse.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setEnv.of(env()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.nameData, app.rawMarkup]);

  // Stored text changed elsewhere (another pane, a profile edit, Notepad).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !props.external) return;
    const body = stripEnd(props.external.body);
    const cur = view.state.doc.toString();
    if (body === cur || body === lastSaved.current) return;
    if (cur !== lastSaved.current) return; // unsaved local edits win; they save next
    let a = 0;
    while (a < cur.length && a < body.length && cur[a] === body[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < body.length - a && cur[cur.length - 1 - b] === body[body.length - 1 - b]) b++;
    view.dispatch({ changes: { from: a, to: cur.length - b, insert: body.slice(a, body.length - b) }, annotations: internal.of('reload') });
    lastSaved.current = body;
    rememberBlocks(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.external?.version]);

  // Jump to a block (from a profile's "from: …" link).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !props.focusBlock) return;
    const b = view.state.field(analysisField).find((x) => x.id === props.focusBlock);
    if (!b) return;
    const end = b.from + b.text.length;
    view.dispatch({ selection: { anchor: end }, effects: [EditorView.scrollIntoView(b.from, { y: 'center' }), flashEffect.of({ from: b.from, to: end })], annotations: internal.of('reload') });
    view.focus();
    const tm = setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1600);
    return () => clearTimeout(tm);
  }, [props.focusBlock]);

  return <div ref={host} className={`editor editor-${props.mode}`} data-testid={`editor-${props.mode}`} />;
}

export { envField };
