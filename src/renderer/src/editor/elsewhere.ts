// A profile is a document you write in, with the template's sections as headings.
// Paragraphs written in *other* documents are shown under their matching heading
// as live slots (rendered by React through portals), so the profile reads as one page.

import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { plainText } from '../../../core/markup';
import { analysisField } from './extensions';

export interface ElsewhereConfig {
  /** Section names with paragraphs from elsewhere; '' means "not in a section". */
  sections: string[];
  register: (key: string, el: HTMLElement, alive: boolean) => void;
}

export const setElsewhere = StateEffect.define<ElsewhereConfig>();

export const slotKey = (section: string) => `sec:${section.toLowerCase()}`;

class SlotWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly label: string | null,
    readonly register: ElsewhereConfig['register'],
  ) {
    super();
  }
  eq(o: SlotWidget) {
    return o.key === this.key && o.label === this.label;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'elsewhere-slot';
    wrap.contentEditable = 'false';
    if (this.label !== null) {
      const h = document.createElement('div');
      h.className = 'elsewhere-heading';
      h.textContent = this.label || 'Mentioned elsewhere';
      wrap.append(h);
    }
    const body = document.createElement('div');
    wrap.append(body);
    this.register(this.key, body, true);
    return wrap;
  }
  destroy(dom: HTMLElement) {
    this.register(this.key, dom.lastElementChild as HTMLElement, false);
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, cfg: ElsewhereConfig | null): DecorationSet {
  if (!cfg || !cfg.sections.length) return Decoration.none;
  const blocks = state.field(analysisField, false) ?? [];
  const headings = blocks.filter((b) => b.kind === 'heading').map((b) => ({ b, title: plainText(b.text).toLowerCase(), level: b.headingLevel ?? 2 }));
  const ranges: Range<Decoration>[] = [];
  const atEnd: string[] = [];
  for (const name of cfg.sections) {
    const hi = name ? headings.findIndex((h) => h.title === name.toLowerCase()) : -1;
    if (hi === -1) {
      atEnd.push(name);
      continue;
    }
    const h = headings[hi];
    // The section runs until the next heading of the same or a higher level.
    const next = headings.slice(hi + 1).find((x) => x.level <= h.level);
    const inSection = blocks.filter((b) => b.from >= h.b.from && (!next || b.from < next.b.from));
    const last = inSection[inSection.length - 1];
    const pos = state.doc.lineAt(last.to).to;
    ranges.push(Decoration.widget({ widget: new SlotWidget(slotKey(name), null, cfg.register), block: true, side: 1 }).range(pos));
  }
  // Sections whose heading isn't in the document (or unsectioned mentions) go at the end, labelled.
  atEnd.sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));
  for (const name of atEnd) {
    ranges.push(Decoration.widget({ widget: new SlotWidget(slotKey(name), name, cfg.register), block: true, side: 2 }).range(state.doc.length));
  }
  return Decoration.set(ranges, true);
}

const elsewhereField = StateField.define<{ cfg: ElsewhereConfig | null; decos: DecorationSet }>({
  create: () => ({ cfg: null, decos: Decoration.none }),
  update(v, tr) {
    let cfg = v.cfg;
    for (const e of tr.effects) if (e.is(setElsewhere)) cfg = e.value;
    if (cfg !== v.cfg || tr.docChanged) return { cfg, decos: build(tr.state, cfg) };
    return v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

export function elsewhereExtension(): Extension {
  return elsewhereField;
}
