// Word-processor behaviour on top of plain Markdown: bold/italic/underline/highlight,
// paragraph styles, lists, and a live preview that hides the Markdown symbols
// everywhere except the line you are editing. The file on disk stays plain Markdown.

import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorSelection, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { startCompletion } from '@codemirror/autocomplete';
import { analysisField, envField } from './extensions';

// ------------------------------------------------------------------ inline styles

export type InlineStyle = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight';

const MARKERS: Record<InlineStyle, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
};

/** Wrap the selection in a style, or remove it if the selection already has it. */
export function toggleInline(view: EditorView, style: InlineStyle): boolean {
  const [open, close] = MARKERS[style];
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - open.length, range.from);
    const after = state.sliceDoc(range.to, range.to + close.length);
    // Already wrapped just outside the selection: unwrap.
    if (before === open && after === close && !(style === 'italic' && state.sliceDoc(range.from - 2, range.from) === '**' && state.sliceDoc(range.to, range.to + 2) === '**' && state.sliceDoc(range.from - 3, range.from) !== '***')) {
      return {
        changes: [
          { from: range.from - open.length, to: range.from },
          { from: range.to, to: range.to + close.length },
        ],
        range: EditorSelection.range(range.from - open.length, range.to - open.length),
      };
    }
    const text = state.sliceDoc(range.from, range.to);
    // Selection includes the markers: unwrap.
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) };
    }
    if (range.empty) {
      return { changes: { from: range.from, insert: open + close }, range: EditorSelection.cursor(range.from + open.length) };
    }
    return {
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: close },
      ],
      range: EditorSelection.range(range.from + open.length, range.to + open.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
  return true;
}

// ------------------------------------------------------------------ paragraph styles

export type ParagraphStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'number';

const PREFIX_RE = /^(#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

function linesInSelection(state: EditorState) {
  const seen = new Set<number>();
  const lines: Array<{ from: number; text: string; number: number }> = [];
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        lines.push({ from: line.from, text: line.text, number: line.number });
      }
      if (line.to + 1 > r.to) break;
      pos = line.to + 1;
    }
  }
  return lines.sort((a, b) => a.number - b.number);
}

export function currentParagraphStyle(state: EditorState): ParagraphStyle {
  const text = state.doc.lineAt(state.selection.main.head).text;
  const h = /^(#{1,6})\s/.exec(text);
  if (h) return h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3';
  if (/^>\s?/.test(text)) return 'quote';
  if (/^[-*+]\s/.test(text)) return 'bullet';
  if (/^\d+[.)]\s/.test(text)) return 'number';
  return 'normal';
}

/** Set every selected line to a paragraph style. Choosing the current list style again turns it off. */
export function setParagraphStyle(view: EditorView, style: ParagraphStyle): boolean {
  const { state } = view;
  const lines = linesInSelection(state).filter((l, i, all) => l.text.trim() || all.length === 1);
  const allAlready = lines.every((l) => {
    if (style === 'bullet') return /^[-*+]\s/.test(l.text);
    if (style === 'number') return /^\d+[.)]\s/.test(l.text);
    if (style === 'quote') return /^>\s?/.test(l.text);
    return false;
  });
  const target: ParagraphStyle = allAlready ? 'normal' : style;
  let n = 0;
  const changes = lines.map((l) => {
    const m = PREFIX_RE.exec(l.text);
    const oldLen = m ? m[0].length : 0;
    let prefix = '';
    if (target === 'h1') prefix = '# ';
    else if (target === 'h2') prefix = '## ';
    else if (target === 'h3') prefix = '### ';
    else if (target === 'quote') prefix = '> ';
    else if (target === 'bullet') prefix = '- ';
    else if (target === 'number') prefix = `${++n}. `;
    return { from: l.from, to: l.from + oldLen, insert: prefix };
  });
  const changeSet = state.changes(changes);
  // A cursor at the start of the line moves past the new marker ("- |", not "|- ").
  view.dispatch({ changes: changeSet, selection: state.selection.map(changeSet, 1), userEvent: 'input.format', scrollIntoView: true });
  view.focus();
  return true;
}

/** Insert markup at the cursor (used by the toolbar's Insert buttons) and open its picker. */
export function insertMarkup(view: EditorView, kind: 'tag' | 'create' | 'topic' | 'fact' | 'relation' | 'note' | 'owner'): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const prev = state.sliceDoc(pos - 1, pos);
  const needsSpace = prev !== '' && !/\s|\(/.test(prev);
  const sp = needsSpace ? ' ' : '';
  let insert = '';
  let cursor = 0;
  switch (kind) {
    case 'tag':
      insert = `${sp}@`;
      break;
    case 'create':
      insert = `${sp}@@`;
      break;
    case 'topic':
      insert = `${sp}#`;
      break;
    case 'fact':
      insert = `${sp}{}`;
      cursor = -1;
      break;
    case 'relation':
      insert = `${sp}>`;
      break;
    case 'note':
      insert = `${sp}%%  %%`;
      cursor = -3;
      break;
    case 'owner': {
      // Turn the current line into a heading that owns the paragraphs beneath it.
      const line = state.doc.lineAt(pos);
      const text = line.text.replace(/^#{1,6}\s+/, '').replace(/\s@\s*$/, '');
      view.dispatch({ changes: { from: line.from, to: line.to, insert: `## ${text} @` }, userEvent: 'input.format' });
      view.focus();
      return true;
    }
  }
  const at = pos + insert.length + cursor;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: at }, userEvent: 'input.type', scrollIntoView: true });
  view.focus();
  setTimeout(() => startCompletion(view), 0);
  return true;
}

export const formatKeymap = keymap.of([
  { key: 'Mod-b', run: (v) => toggleInline(v, 'bold') },
  { key: 'Mod-i', run: (v) => toggleInline(v, 'italic') },
  { key: 'Mod-u', run: (v) => toggleInline(v, 'underline') },
  { key: 'Mod-Shift-x', run: (v) => toggleInline(v, 'strike') },
  { key: 'Mod-Shift-h', run: (v) => toggleInline(v, 'highlight') },
  { key: 'Mod-Alt-0', run: (v) => setParagraphStyle(v, 'normal') },
  { key: 'Mod-Alt-1', run: (v) => setParagraphStyle(v, 'h1') },
  { key: 'Mod-Alt-2', run: (v) => setParagraphStyle(v, 'h2') },
  { key: 'Mod-Alt-3', run: (v) => setParagraphStyle(v, 'h3') },
  { key: 'Mod-Shift-8', run: (v) => setParagraphStyle(v, 'bullet') },
  { key: 'Mod-Shift-7', run: (v) => setParagraphStyle(v, 'number') },
  { key: 'Mod-Shift-9', run: (v) => setParagraphStyle(v, 'quote') },
]);

/** Which inline styles are active at the cursor (for the toolbar's pressed state). */
export function activeInline(state: EditorState): Set<InlineStyle> {
  const out = new Set<InlineStyle>();
  const pos = state.selection.main.head;
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'StrongEmphasis') out.add('bold');
    if (n.name === 'Emphasis') out.add('italic');
    if (n.name === 'Strikethrough') out.add('strike');
  }
  const line = state.doc.lineAt(pos);
  const rel = pos - line.from;
  for (const [style, re] of [
    ['underline', /<u>(.*?)<\/u>/g],
    ['highlight', /==([^=\n]+)==/g],
  ] as const) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(line.text)); ) if (rel > m.index && rel < m.index + m[0].length) out.add(style);
  }
  return out;
}

// ------------------------------------------------------------------ live preview

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-bullet';
    s.textContent = '•';
    return s;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});

function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  if (!state.field(envField, false)) return out;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

function buildPreview(view: EditorView): DecorationSet {
  const { state } = view;
  const env = state.field(envField, false);
  const raw = env?.raw ?? false;
  const active = activeLines(state);
  const focused = view.hasFocus;
  const ranges: Range<Decoration>[] = [];
  const isActive = (pos: number) => focused && active.has(state.doc.lineAt(pos).number);

  // Paragraph layout: first lines (for indented paragraphs) and blank separator lines.
  for (const b of state.field(analysisField, false) ?? []) {
    if (b.kind === 'paragraph') ranges.push(Decoration.line({ class: 'cm-p' }).range(state.doc.lineAt(b.from).from));
    if (b.kind === 'list') {
      for (let p = b.from; p <= b.to; ) {
        const line = state.doc.lineAt(p);
        ranges.push(Decoration.line({ class: /^\s*\d+[.)]\s/.test(line.text) ? 'cm-li cm-li-num' : 'cm-li' }).range(line.from));
        p = line.to + 1;
      }
    }
  }
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (!line.text.trim() && !(focused && active.has(line.number))) ranges.push(Decoration.line({ class: 'cm-blank' }).range(line.from));
      pos = line.to + 1;
    }
  }
  if (raw) return Decoration.set(ranges, true);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (name === 'HeaderMark') {
          if (isActive(node.from)) return;
          const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          ranges.push(hide.range(node.from, end));
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'CodeMark') {
          const parent = node.node.parent;
          if (!parent || (name === 'CodeMark' && parent.name !== 'InlineCode')) return;
          const sel = state.selection.main;
          if (focused && sel.from <= parent.to && sel.to >= parent.from) return;
          ranges.push(hide.range(node.from, node.to));
        } else if (name === 'QuoteMark') {
          if (isActive(node.from)) return;
          const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          ranges.push(hide.range(node.from, end));
        } else if (name === 'ListMark') {
          const text = state.sliceDoc(node.from, node.to);
          if (/^[-*+]$/.test(text) && !isActive(node.from)) ranges.push(bullet.range(node.from, node.to));
        }
      },
    });
    // ==highlight== and <u>underline</u> aren't in the Markdown grammar; find them directly.
    const text = state.sliceDoc(from, to);
    for (const [re, cls, open, close] of [
      [/==([^=\n]+)==/g, 'cm-highlight', 2, 2],
      [/<u>(.*?)<\/u>/g, 'cm-underline', 3, 4],
    ] as const) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(text)); ) {
        const a = from + m.index;
        const b = a + m[0].length;
        ranges.push(Decoration.mark({ class: cls }).range(a + open, b - close));
        const sel = state.selection.main;
        if (focused && sel.from <= b && sel.to >= a) continue;
        ranges.push(hide.range(a, a + open));
        ranges.push(hide.range(b - close, b));
      }
    }
  }
  return Decoration.set(ranges, true);
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildPreview(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || u.transactions.some((t) => t.reconfigured) || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildPreview(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function formattingExtensions(): Extension[] {
  return [formatKeymap, previewPlugin];
}

// ------------------------------------------------------------------ paragraphs like a word processor
//
// Markdown separates paragraphs with a blank line. Enter makes a new paragraph
// (the blank line is drawn as paragraph spacing), Shift+Enter a line break inside
// one, and Backspace at the start of a paragraph joins it to the one above.

function inListOrQuote(text: string) {
  return /^\s*([-*+]|\d+[.)])\s/.test(text) || /^\s*>/.test(text);
}

function inCode(state: EditorState, pos: number) {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
  }
  return false;
}

export function newParagraph(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length > 1) return false;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  if (!line.text.trim() || inListOrQuote(line.text) || inCode(state, sel.head)) return false;
  const rest = state.sliceDoc(sel.to, line.to);
  // At the very end of the paragraph (only the hidden id after the cursor), open a new one below it.
  const after = /^\s*(\^b-[a-z0-9]+)?\s*$/.test(rest) ? line.to : sel.to;
  const from = after === line.to ? line.to : sel.from;
  const insert = '\n\n';
  view.dispatch({
    changes: { from, to: after === line.to ? line.to : sel.to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paragraph',
  });
  return true;
}

/** Enter in a list or quote: continue it, keeping each item's hidden id on its own item. */
export function listEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (!inListOrQuote(line.text)) return false;
  const rest = state.sliceDoc(sel.head, line.to);
  if (!/^\s*(\^b-[a-z0-9]+)?\s*$/.test(rest)) return false; // splitting mid-item: default behaviour
  const visible = line.text.replace(/\s\^b-[a-z0-9]+\s*$/, '');
  if (/^\s*([-*+]|\d+[.)]|>)\s*$/.test(visible)) {
    // Enter on an empty item leaves the list.
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '\n' }, selection: { anchor: line.from + 1 }, userEvent: 'join' });
    return true;
  }
  const m = /^(\s*)(?:([-*+])|(\d+)([.)])|(>))\s?/.exec(line.text)!;
  const marker = m[2] ? `${m[2]} ` : m[3] ? `${Number(m[3]) + 1}${m[4]} ` : '> ';
  const insert = `\n${m[1]}${marker}`;
  // Insert after the hidden id so the finished item keeps it.
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, scrollIntoView: true, userEvent: 'input.list' });
  return true;
}

export function lineBreak(view: EditorView): boolean {
  const { head } = view.state.selection.main;
  view.dispatch({ changes: { from: head, insert: '\n' }, selection: { anchor: head + 1 }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

type DocBlock = { from: number; to: number; text: string; id?: string };

function joinParagraphs(view: EditorView, a: DocBlock, b: DocBlock): boolean {
  // "A ^id1\n\nB ^id2" → "AB ^id1": the joined paragraph keeps the first one's identity.
  const aTextEnd = a.from + a.text.length;
  const bTextEnd = b.from + b.text.length;
  const changes = [{ from: aTextEnd, to: b.from, insert: '' }];
  if (a.id) changes.push({ from: bTextEnd, to: b.to, insert: ` ^${a.id}` });
  view.dispatch({ changes, selection: { anchor: aTextEnd }, scrollIntoView: true, userEvent: 'join' });
  return true;
}

function blocksAround(state: EditorState, pos: number): { prev?: DocBlock; cur?: DocBlock; next?: DocBlock } {
  const blocks = (state.field(analysisField, false) ?? []) as DocBlock[];
  const i = blocks.findIndex((b) => pos >= b.from && pos <= b.to);
  return { prev: blocks[i - 1], cur: blocks[i], next: blocks[i + 1] };
}

export function joinBackward(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.from || line.number < 3) return false;
  if (state.doc.line(line.number - 1).text.trim() !== '') return false;
  const { prev, cur } = blocksAround(state, sel.head);
  if (!prev || !cur || cur.from !== line.from) return false;
  if (inListOrQuote(cur.text) || /^#{1,6}\s/.test(cur.text) || /^#{1,6}\s/.test(prev.text)) return false;
  return joinParagraphs(view, prev, cur);
}

export function joinForward(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const { cur, next } = blocksAround(state, sel.head);
  if (!cur || !next) return false;
  if (sel.head !== cur.from + cur.text.length && sel.head !== cur.to) return false;
  if (state.doc.lineAt(cur.to).number + 2 !== state.doc.lineAt(next.from).number) return false;
  if (inListOrQuote(next.text) || /^#{1,6}\s/.test(next.text) || /^#{1,6}\s/.test(cur.text)) return false;
  return joinParagraphs(view, cur, next);
}

/** Bound after the autocomplete keys, so Enter still picks a menu option first. */
export const paragraphKeys = [
  { key: 'Enter', run: (v: EditorView) => listEnter(v) || newParagraph(v) },
  { key: 'Shift-Enter', run: lineBreak },
  { key: 'Backspace', run: joinBackward },
  { key: 'Delete', run: joinForward },
];
