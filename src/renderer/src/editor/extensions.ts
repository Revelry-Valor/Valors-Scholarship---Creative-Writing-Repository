// CodeMirror extensions for writing in a vault:
//  - live chips for tags, links, facts, relations, topics (raw text under the cursor)
//  - hidden block ids
//  - the context stripe: a coloured bar per entity each block will be filed to (spec 4.3)
//  - warning underlines for broken markup (spec 4.1 mistake-proofing)
//  - the `@` menu and `{` / `>` / `#` pickers (spec 4.1)

import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { autocompletion, type Completion, type CompletionContext, type CompletionResult, startCompletion } from '@codemirror/autocomplete';
import { analyzeBlocks, type AnalysisContext, type AnalyzedBlock } from '../../../core/analysis';
import { splitBlocks, type ParsedBlock } from '../../../core/document';
import { factPickerFields } from '../../../core/editing';
import { formatTag, normalizeName, type Token } from '../../../core/markup';
import type { EntityChip, ResolvedTemplate, RelationTypeDef } from '../../../core/types';

export interface EditorEnv {
  ctx: AnalysisContext;
  entities: Map<string, EntityChip>;
  templates: ResolvedTemplate[];
  relationTypes: RelationTypeDef[];
  lastUsedType: string;
  topicType: string;
  directOwner?: string;
  raw: boolean;
  openEntity(id: string): void;
  createEntity(name: string, type: string): Promise<void>;
  onCurrentBlock?(b: (ParsedBlock & { analysis: AnalyzedBlock }) | null): void;
}

export const setEnv = StateEffect.define<EditorEnv>();

export const envField = StateField.define<EditorEnv | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setEnv)) return e.value;
    return v;
  },
});

export type AnalyzedDocBlock = ParsedBlock & { analysis: AnalyzedBlock };

export const analysisField = StateField.define<AnalyzedDocBlock[]>({
  create: (state) => analyzeDoc(state),
  update(v, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setEnv))) return analyzeDoc(tr.state);
    return v;
  },
});

function analyzeDoc(state: EditorState): AnalyzedDocBlock[] {
  const env = state.field(envField, false);
  if (!env) return [];
  const blocks = splitBlocks(state.doc.toString());
  const a = analyzeBlocks(blocks, { ...env.ctx, directOwner: env.directOwner });
  return blocks.map((b, i) => ({ ...b, analysis: a[i] }));
}

export function blockAt(state: EditorState, pos: number): AnalyzedDocBlock | null {
  const blocks = state.field(analysisField, false) ?? [];
  for (const b of blocks) if (pos >= b.from && pos <= b.to) return b;
  return null;
}

// ------------------------------------------------------------------ widgets

type ChipVariant = 'ok' | 'new' | 'missing' | 'ambiguous' | 'optout';

class ChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly color: string,
    readonly kind: 'tag' | 'topic' | 'link',
    readonly variant: ChipVariant,
    readonly entityId: string | undefined,
    readonly title: string,
    readonly section?: string,
  ) {
    super();
  }
  eq(o: ChipWidget) {
    return o.label === this.label && o.color === this.color && o.variant === this.variant && o.entityId === this.entityId && o.section === this.section && o.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-chip cm-chip-${this.kind} cm-chip-${this.variant}`;
    s.style.setProperty('--chip', this.color);
    s.title = this.title;
    if (this.entityId) s.dataset.entity = this.entityId;
    if (this.kind === 'topic') s.textContent = `#${this.label}`;
    else s.textContent = this.label;
    if (this.variant === 'new') {
      const dot = document.createElement('span');
      dot.className = 'cm-chip-dot';
      s.prepend(dot);
    }
    if (this.section) {
      const sec = document.createElement('span');
      sec.className = 'cm-chip-section';
      sec.textContent = this.section;
      s.append(sec);
    }
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class BadgeWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly value: string,
    readonly cls: string,
    readonly title: string,
  ) {
    super();
  }
  eq(o: BadgeWidget) {
    return o.label === this.label && o.value === this.value && o.cls === this.cls && o.title === this.title;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-badge ${this.cls}`;
    s.title = this.title;
    if (this.label) {
      const l = document.createElement('span');
      l.className = 'cm-badge-label';
      l.textContent = this.label;
      s.append(l);
    }
    const v = document.createElement('span');
    v.className = 'cm-badge-value';
    v.textContent = this.value;
    s.append(v);
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

class HiddenWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-hidden-id';
    return s;
  }
}
const hidden = Decoration.replace({ widget: new HiddenWidget() });

// ------------------------------------------------------------------ decorations

function tokenTouchesSelection(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function buildDecorations(view: EditorView): { all: DecorationSet; atomic: DecorationSet } {
  const state = view.state;
  const env = state.field(envField, false);
  const blocks = state.field(analysisField, false) ?? [];
  if (!env) return { all: Decoration.none, atomic: Decoration.none };
  const ranges: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const raw = env.raw;

  for (const b of blocks) {
    const base = b.from;
    // Heading lines
    if (b.kind === 'heading') {
      const line = state.doc.lineAt(base);
      ranges.push(Decoration.line({ class: `cm-heading cm-h${b.headingLevel}` }).range(line.from));
      const hashes = /^#{1,6}\s/.exec(b.text);
      if (hashes && !raw) ranges.push(Decoration.mark({ class: 'cm-heading-mark' }).range(base, base + hashes[0].length));
    }
    // Marked paragraphs are tinted, so important details stand out on the page.
    const markCls = b.analysis.marks.includes('key') ? 'cm-key-line' : b.analysis.marks.includes('check') ? 'cm-check-line' : '';
    if (markCls) {
      for (let p = base; p <= b.to; ) {
        const line = state.doc.lineAt(p);
        ranges.push(Decoration.line({ class: markCls }).range(line.from));
        p = line.to + 1;
      }
    }
    if (b.kind === 'quote') {
      for (let p = base; p <= b.to; ) {
        const line = state.doc.lineAt(p);
        ranges.push(Decoration.line({ class: 'cm-quote-line' }).range(line.from));
        p = line.to + 1;
      }
    }
    // Block id (lives after b.text, before b.to)
    if (b.id) {
      const idFrom = base + b.text.length;
      if (raw) ranges.push(Decoration.mark({ class: 'cm-raw-id' }).range(idFrom, b.to));
      else {
        ranges.push(hidden.range(idFrom, b.to));
        atomic.push(hidden.range(idFrom, b.to));
      }
    }
    const warnAt = new Map<number, string>();
    for (const w of b.analysis.warnings) warnAt.set(w.from, w.message);

    for (const t of b.analysis.tokens) {
      const from = base + t.from;
      const to = base + t.to;
      if (t.kind === 'blockId') {
        // An id left inside a block after two paragraphs were joined; tidied on save.
        if (!raw) ranges.push(hidden.range(from, to));
        continue;
      }
      if (t.kind === 'note') {
        ranges.push(Decoration.mark({ class: 'cm-note' }).range(from, to));
        continue;
      }
      if (t.kind === 'code' || t.kind === 'unclosed') {
        if (t.kind === 'unclosed') ranges.push(Decoration.mark({ class: 'cm-warn', attributes: { title: `Unclosed ${t.what}` } }).range(from, to));
        continue;
      }
      const editing = raw || tokenTouchesSelection(state, from, to);
      const warning = warnAt.get(t.from);
      const deco = describeToken(t, env, warning);
      if (!deco) continue;
      if (editing) {
        ranges.push(
          Decoration.mark({
            class: `cm-raw cm-raw-${t.kind}${warning ? ' cm-warn' : ''}`,
            attributes: { style: `--chip:${deco.color}`, ...(warning ? { title: warning } : {}) },
          }).range(from, to),
        );
      } else {
        const r = Decoration.replace({ widget: deco.widget }).range(from, to);
        ranges.push(r);
        atomic.push(r);
      }
    }
  }
  return { all: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) };
}

function describeToken(t: Token, env: EditorEnv, warning?: string): { widget: WidgetType; color: string } | null {
  const grey = 'var(--muted)';
  switch (t.kind) {
    case 'tag': {
      if (t.bare) {
        return { widget: new BadgeWidget('', '@', 'cm-badge-owner', 'This heading owns every block beneath it'), color: 'var(--accent)' };
      }
      const r = env.ctx.resolver.resolve(t.name);
      if (r.status === 'ok') {
        const e = env.entities.get(r.id);
        const label = t.optOut ? `not ${t.display ?? t.name}` : t.display ?? t.name;
        const title = `${e?.name ?? t.name} · ${e?.typeName ?? ''}${t.optOut ? ' — removed from this block' : ''}\nCtrl+click to open`;
        return { widget: new ChipWidget(label, e?.color ?? grey, 'tag', t.optOut ? 'optout' : 'ok', r.id, title, t.section), color: e?.color ?? grey };
      }
      if (r.status === 'ambiguous') {
        return { widget: new ChipWidget(t.display ?? t.name, 'var(--warn)', 'tag', 'ambiguous', undefined, warning ?? 'Matches several entities', t.section), color: 'var(--warn)' };
      }
      if (t.create) {
        return { widget: new ChipWidget(t.display ?? t.name, 'var(--accent)', 'tag', 'new', undefined, `New entity "${t.name}" — created when saved`, t.section), color: 'var(--accent)' };
      }
      return { widget: new ChipWidget(t.display ?? t.name, 'var(--danger)', 'tag', 'missing', undefined, warning ?? `No entity named "${t.name}"`, t.section), color: 'var(--danger)' };
    }
    case 'topic': {
      const r = env.ctx.resolver.resolve(t.name);
      const e = r.status === 'ok' ? env.entities.get(r.id) : undefined;
      return {
        widget: new ChipWidget(t.name, e?.color ?? 'var(--accent)', 'topic', e ? 'ok' : 'new', e?.id, e ? `Topic: ${e.name}` : `New topic "${t.name}" — created when saved`),
        color: e?.color ?? 'var(--accent)',
      };
    }
    case 'link': {
      const r = env.ctx.resolver.resolve(t.name);
      const e = r.status === 'ok' ? env.entities.get(r.id) : undefined;
      return {
        widget: new ChipWidget(t.display ?? t.name, e?.color ?? 'var(--danger)', 'link', e ? 'ok' : 'missing', e?.id, e ? `Link to ${e.name} (not filed to the profile)` : warning ?? 'No such entity'),
        color: e?.color ?? 'var(--danger)',
      };
    }
    case 'field': {
      const label = t.entity ? `${t.entity}.${t.field}` : t.field;
      const val = t.value.replace(/^@+/, '') + (t.confidence ? ` ?${t.confidence}` : '');
      return { widget: new BadgeWidget(label.replace(/_/g, ' '), val, warning ? 'cm-badge-warn' : 'cm-badge-field', warning ?? `Sets ${label}`), color: warning ? 'var(--danger)' : grey };
    }
    case 'relation': {
      const def = env.relationTypes.find((r) => r.id === t.type);
      return {
        widget: new BadgeWidget('', `→ ${def?.label.toLowerCase() ?? t.type.replace(/_/g, ' ')} →`, warning ? 'cm-badge-warn' : 'cm-badge-rel', warning ?? `Relationship: ${def?.label ?? t.type}`),
        color: warning ? 'var(--danger)' : 'var(--accent)',
      };
    }
    case 'pin':
      return { widget: new BadgeWidget('', '📌', 'cm-badge-pin', 'Pinned as the profile summary'), color: grey };
    case 'mark':
      return t.mark === 'key'
        ? { widget: new BadgeWidget('', '★ Important', 'cm-badge-key', 'Marked important — listed in Key details and on its pages'), color: 'var(--key)' }
        : { widget: new BadgeWidget('', '⚑ Check this', 'cm-badge-check', 'Marked to verify — listed in Key details'), color: 'var(--warn)' };
    default:
      return null;
  }
}

const decorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      ({ all: this.decorations, atomic: this.atomic } = buildDecorations(view));
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setEnv)))) {
        ({ all: this.decorations, atomic: this.atomic } = buildDecorations(u.view));
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
  },
);

// ------------------------------------------------------------------ keep hidden ids intact

/**
 * Block ids sit hidden at the end of each block. Typing at the very end of a
 * line would land after the id, and Backspace would delete the whole hidden id.
 * This filter redirects such edits to the visible text just before the id.
 */
const protectIds = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr;
  if (tr.startState.field(envField, false)?.raw) return tr;
  const blocks = tr.startState.field(analysisField, false) ?? [];
  const ids = blocks.filter((b) => b.id).map((b) => ({ from: b.from, idFrom: b.from + b.text.length, idTo: b.to }));
  if (!ids.length) return tr;
  let changed = false;
  const specs: Array<{ from: number; to: number; insert: string }> = [];
  let cursor: number | null = null;
  const backward = tr.isUserEvent('delete.backward');
  const forward = tr.isUserEvent('delete.forward');
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    let from = fromA;
    let to = toA;
    const text = inserted.toString();
    for (const b of ids) {
      if (from < b.idTo && to > b.idFrom && !(from <= b.from && to >= b.idTo)) {
        if (from >= b.idFrom) {
          // Deleting only the hidden id: delete the neighbouring visible character instead.
          if (backward && b.idFrom > b.from && !text) [from, to] = [b.idFrom - 1, b.idFrom];
          else if (forward && !text) [from, to] = [b.idTo, Math.min(b.idTo + 1, tr.startState.doc.length)];
          else [from, to] = [b.idFrom, b.idFrom];
        } else to = b.idFrom;
        changed = true;
        cursor = from;
      }
      if (from === to && from === b.idTo && text && !text.startsWith('\n')) {
        from = to = b.idFrom;
        changed = true;
        cursor = from;
      } else if (from === to && from === b.idFrom && text.startsWith('\n')) {
        // Enter at the end of a paragraph: the id stays with the paragraph, not the new line.
        from = to = b.idTo;
        changed = true;
        cursor = from;
      }
    }
    specs.push({ from, to, insert: text });
  });
  if (!changed) return tr;
  const changes = tr.startState.changes(specs);
  const head = cursor !== null ? changes.mapPos(cursor, 1) : tr.selection?.main.head ?? 0;
  return {
    changes,
    selection: { anchor: Math.min(head, changes.newLength) },
    scrollIntoView: true,
    userEvent: tr.annotation(Transaction.userEvent) ?? (tr.isUserEvent('delete') ? 'delete' : 'input'),
  };
});

// ------------------------------------------------------------------ context stripe

class StripeMarker extends GutterMarker {
  constructor(
    readonly colors: string[],
    readonly names: string[],
    readonly first: boolean,
    readonly last: boolean,
  ) {
    super();
  }
  eq(o: StripeMarker) {
    return o.colors.join() === this.colors.join() && o.first === this.first && o.last === this.last && o.names.join() === this.names.join();
  }
  toDOM() {
    const d = document.createElement('div');
    d.className = `cm-stripe${this.first ? ' cm-stripe-first' : ''}${this.last ? ' cm-stripe-last' : ''}`;
    d.title = `Filed to: ${this.names.join(', ')}`;
    for (const c of this.colors) {
      const bar = document.createElement('span');
      bar.style.background = c;
      d.append(bar);
    }
    return d;
  }
}

function stripeMarkers(view: EditorView): RangeSet<GutterMarker> {
  const env = view.state.field(envField, false);
  const blocks = view.state.field(analysisField, false) ?? [];
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!env) return builder.finish();
  for (const b of blocks) {
    const filed = b.analysis.filedTo.filter((f) => f.via !== 'direct');
    const colors = filed.map((f) => env.entities.get(f.entityId)?.color ?? '#999');
    const names = filed.map((f) => env.entities.get(f.entityId)?.name ?? '?');
    for (const c of b.analysis.creates) {
      colors.push('var(--accent)');
      names.push(`${c.name} (new)`);
    }
    if (!colors.length) continue;
    const firstLine = view.state.doc.lineAt(b.from).number;
    const lastLine = view.state.doc.lineAt(b.to).number;
    for (let n = firstLine; n <= lastLine; n++) {
      const line = view.state.doc.line(n);
      builder.add(line.from, line.from, new StripeMarker(colors, names, n === firstLine, n === lastLine));
    }
  }
  return builder.finish();
}

const stripeGutter = gutter({
  class: 'cm-stripe-gutter',
  markers: stripeMarkers,
  lineMarkerChange: (u) => u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setEnv))),
  initialSpacer: () => new StripeMarker(['transparent'], [], false, false),
});

// ------------------------------------------------------------------ current block + clicks

const currentBlockReporter = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    last: string | null = null;
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setEnv)))) this.schedule();
    }
    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const env = this.view.state.field(envField, false);
        if (!env?.onCurrentBlock) return;
        const b = blockAt(this.view.state, this.view.state.selection.main.head);
        const key = b ? `${b.from}:${b.text}:${b.analysis.filedTo.map((f) => f.entityId).join()}` : null;
        if (key === this.last) return;
        this.last = key;
        env.onCurrentBlock(b);
      }, 120);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

const clickHandlers = EditorView.domEventHandlers({
  mousedown(e, view) {
    const el = (e.target as HTMLElement).closest('.cm-chip[data-entity]') as HTMLElement | null;
    if (el && (e.ctrlKey || e.metaKey)) {
      view.state.field(envField, false)?.openEntity(el.dataset.entity!);
      e.preventDefault();
      return true;
    }
    return false;
  },
});

/** Mod-Enter on a chip opens its profile. */
export function openEntityAtCursor(view: EditorView): boolean {
  const env = view.state.field(envField, false);
  const b = blockAt(view.state, view.state.selection.main.head);
  if (!env || !b) return false;
  const rel = view.state.selection.main.head - b.from;
  for (const t of b.analysis.tokens) {
    if (rel < t.from || rel > t.to) continue;
    const name = t.kind === 'tag' ? t.name : t.kind === 'topic' || t.kind === 'link' ? t.name : null;
    if (!name) continue;
    const r = env.ctx.resolver.resolve(name);
    if (r.status === 'ok') {
      env.openEntity(r.id);
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ the @ menu

function typeLabel(env: EditorEnv, id: string) {
  return env.templates.find((t) => t.id === id)?.name ?? id;
}

function orderedTypes(env: EditorEnv): ResolvedTemplate[] {
  const list = env.templates.filter((t) => t.id !== env.topicType);
  list.sort((a, b) => (a.id === env.lastUsedType ? -1 : b.id === env.lastUsedType ? 1 : a.name.localeCompare(b.name)));
  return list;
}

function createOptions(env: EditorEnv, name: string, from: number, to: number): Completion[] {
  return orderedTypes(env).map((t, i) => ({
    label: `Create “${name}”`,
    detail: `as ${t.name}${i === 0 ? '  ↵' : ''}`,
    type: 'create',
    boost: -10 - i,
    apply: (view: EditorView) => {
      const insert = `${formatTag(name, { create: true })} `;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      void env.createEntity(name, t.id);
    },
  }));
}

function atCompletions(context: CompletionContext): CompletionResult | null {
  const env = context.state.field(envField, false);
  if (!env) return null;
  const m = context.matchBefore(/(?:^|[\s(“"'])@(@|-)?(\[[^\]\n]*|[\p{L}\p{N}][\p{L}\p{N}'’ .-]{0,40})?$/u);
  if (!m) return null;
  const atIdx = m.text.indexOf('@');
  const from = m.from + atIdx;
  const raw = m.text.slice(atIdx + 1);
  const create = raw.startsWith('@');
  const optOut = raw.startsWith('-');
  const typed = raw.replace(/^[@-]/, '').replace(/^\[/, '');
  const to = context.pos;
  if (!typed && !context.explicit && !m.text.endsWith('@')) return null;
  // Names can have spaces ("Jone Doe", "Council of Nicaea"). Keep the menu open while the
  // words could still be a name, but close it once a known name is finished and the
  // writer has moved on to ordinary prose ("@Scouch went home").
  if (/\s/.test(typed)) {
    const lower = typed.toLowerCase();
    const continuesKnown = !create && [...env.entities.values()].some((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase().startsWith(lower)));
    if (!continuesKnown) {
      const words = typed.trim().split(/\s+/);
      if (!create) {
        for (let k = 1; k <= words.length; k++) {
          if (k === words.length && !/\s$/.test(typed)) break;
          if (env.ctx.resolver.resolve(words.slice(0, k).join(' ')).status === 'ok') return null;
        }
      }
      if (words.length > 4 || typed.length > 48) return null;
    }
  }
  const options: Completion[] = [];
  if (!typed && !create && !optOut) {
    // The bare `@` menu: every marker in one place.
    options.push(
      { label: 'Link existing…', detail: 'keep typing a name', type: 'menu', boost: 99, apply: (view) => view.dispatch({ changes: { from, to, insert: '@' }, selection: { anchor: from + 1 } }) },
      {
        label: 'Create new…',
        detail: '@@Name',
        type: 'menu',
        boost: 98,
        apply: (view) => {
          view.dispatch({ changes: { from, to, insert: '@@' }, selection: { anchor: from + 2 } });
        },
      },
      {
        label: 'Add a fact',
        detail: '{field: value}',
        type: 'menu',
        boost: 97,
        apply: (view) => {
          view.dispatch({ changes: { from, to, insert: '{' }, selection: { anchor: from + 1 } });
          setTimeout(() => startCompletion(view), 0);
        },
      },
      {
        label: 'Relationship',
        detail: '@A >relation> @B',
        type: 'menu',
        boost: 96,
        apply: (view) => {
          view.dispatch({ changes: { from, to, insert: '>' }, selection: { anchor: from + 1 } });
          setTimeout(() => startCompletion(view), 0);
        },
      },
      {
        label: 'Mark important',
        detail: '!key',
        type: 'menu',
        boost: 94,
        apply: (view) => {
          view.dispatch({ changes: { from, to, insert: '!key' }, selection: { anchor: from + 4 } });
        },
      },
      {
        label: 'Topic',
        detail: '#topic',
        type: 'menu',
        boost: 95,
        apply: (view) => {
          view.dispatch({ changes: { from, to, insert: '#' }, selection: { anchor: from + 1 } });
          setTimeout(() => startCompletion(view), 0);
        },
      },
    );
  }

  const q = normalizeName(typed);
  const prefix = create ? '@@' : optOut ? '@-' : '@';
  if (!create) {
    const scored: Array<{ e: EntityChip; score: number; via?: string }> = [];
    for (const e of env.entities.values()) {
      if (e.type === env.topicType && !q) continue;
      let best = 0;
      let via: string | undefined;
      for (const n of [e.name, ...e.aliases]) {
        const k = normalizeName(n);
        let s = 0;
        if (!q) s = 1;
        else if (k.startsWith(q)) s = 100 - k.length / 10;
        else if (k.split(' ').some((w) => w.startsWith(q))) s = 80 - k.length / 10;
        else if (k.includes(q)) s = 50;
        if (s > best) {
          best = s;
          via = n === e.name ? undefined : n;
        }
      }
      if (best > 0) scored.push({ e, score: best, via });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { e, score, via } of scored.slice(0, 40)) {
      options.push({
        label: e.name,
        displayLabel: e.name,
        detail: via ? `${e.typeName} · “${via}”` : e.typeName,
        type: 'entity',
        boost: Math.round(score / 10),
        apply: (view) => {
          const insert = `${formatTag(e.name).replace(/^@/, prefix)} `;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
        },
      });
    }
  }
  const exact = typed && env.ctx.resolver.resolve(typed.trim()).status === 'ok' && [...env.entities.values()].some((e) => normalizeName(e.name) === q);
  if (typed.trim() && !exact && !optOut) options.push(...createOptions(env, typed.trim(), from, to));

  return { from, to, options, filter: false };
}

function fieldCompletions(context: CompletionContext): CompletionResult | null {
  const env = context.state.field(envField, false);
  if (!env) return null;
  const m = context.matchBefore(/\{[\p{L}_ ]*$/u);
  if (!m) return null;
  const b = blockAt(context.state, context.pos);
  const blockFrom = b ? b.from : context.state.doc.lineAt(context.pos).from;
  const text = context.state.sliceDoc(blockFrom, context.pos);
  const picker = factPickerFields(text, text.length, env.ctx.resolver, env.ctx.entityType, new Map(env.templates.map((t) => [t.id, t])));
  const options: Completion[] = [];
  if (picker) {
    for (const f of picker.fields) {
      options.push({
        label: f.key,
        displayLabel: f.label,
        detail: `${picker.entityName} · ${f.kind === 'list' ? `list of ${f.of}` : f.kind}`,
        type: 'field',
        apply: (view, _c, from, to) => {
          const insert = `{${f.key}: }`;
          const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
          view.dispatch({ changes: { from: from - 1, to: end, insert }, selection: { anchor: from - 1 + insert.length - 1 } });
        },
      });
    }
  }
  options.push({
    label: 'year',
    displayLabel: 'Event date',
    detail: 'dates this block on timelines',
    type: 'field',
    boost: -5,
    apply: (view, _c, from, to) => {
      const insert = '{year: }';
      const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
      view.dispatch({ changes: { from: from - 1, to: end, insert }, selection: { anchor: from - 1 + insert.length - 1 } });
    },
  });
  if (!picker) {
    options.unshift({ label: 'No tagged entity before the cursor', detail: 'tag someone first, or type {Name.field: value}', type: 'info', apply: () => undefined, boost: 99 });
  }
  return { from: m.from + 1, to: context.pos, options, validFor: /^[\p{L}_ ]*$/u };
}

function relationCompletions(context: CompletionContext): CompletionResult | null {
  const env = context.state.field(envField, false);
  if (!env) return null;
  const m = context.matchBefore(/(?:^|\s)>[\p{L}_]*$/u);
  if (!m) return null;
  const from = (m.text.startsWith('>') ? m.from : m.from + 1) + 1;
  const options: Completion[] = env.relationTypes.map((r) => ({
    label: r.id,
    displayLabel: r.label,
    detail: `inverse: ${r.inverse.toLowerCase()} · ${r.category}`,
    type: 'relation',
    apply: (view, _c, f, to) => {
      const insert = `>${r.id}> @`;
      view.dispatch({ changes: { from: f - 1, to, insert }, selection: { anchor: f - 1 + insert.length } });
      setTimeout(() => startCompletion(view), 0);
    },
  }));
  return { from, to: context.pos, options, validFor: /^[\p{L}_]*$/u };
}

function topicCompletions(context: CompletionContext): CompletionResult | null {
  const env = context.state.field(envField, false);
  if (!env) return null;
  const m = context.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_-]*$/u);
  if (!m) return null;
  const line = context.state.doc.lineAt(context.pos);
  if (/^#{1,6}$/.test(context.state.sliceDoc(line.from, context.pos).trim())) return null; // typing a heading
  const from = m.text.startsWith('#') ? m.from : m.from + 1;
  const typed = m.text.slice(m.text.indexOf('#') + 1);
  const topics = [...env.entities.values()].filter((e) => e.type === env.topicType);
  const options: Completion[] = topics.map((t) => ({
    label: `#${t.name.replace(/\s+/g, '-').toLowerCase()}`,
    displayLabel: t.name,
    detail: 'topic',
    type: 'topic',
  }));
  if (typed && !topics.some((t) => normalizeName(t.name) === normalizeName(typed))) {
    options.push({ label: `#${typed}`, displayLabel: `New topic “${typed.replace(/-/g, ' ')}”`, type: 'create', boost: -5 });
  }
  return { from, to: context.pos, options, validFor: /^#[\p{L}\p{N}_-]*$/u };
}

/** `{` is inserted by closeBrackets, which doesn't start completion by itself. */
const openFactPicker = EditorView.updateListener.of((u) => {
  if (!u.docChanged || !u.transactions.some((tr) => tr.isUserEvent('input.type'))) return;
  let brace = false;
  u.changes.iterChanges((_a, _b, _c, _d, ins) => {
    if (ins.toString() === '{}' || ins.toString() === '{') brace = true;
  });
  if (brace) setTimeout(() => startCompletion(u.view), 0);
});

// ------------------------------------------------------------------ bundle

export function writingExtensions(opts: { stripe?: boolean } = {}): Extension[] {
  return [
    envField,
    analysisField,
    decorationsPlugin,
    protectIds,
    opts.stripe === false ? [] : stripeGutter,
    currentBlockReporter,
    clickHandlers,
    openFactPicker,
    autocompletion({
      override: [atCompletions, fieldCompletions, relationCompletions, topicCompletions],
      icons: false,
      activateOnTyping: true,
      closeOnBlur: true,
      optionClass: (c) => `cm-opt-${c.type ?? 'x'}`,
    }),
  ];
}

export { typeLabel };
