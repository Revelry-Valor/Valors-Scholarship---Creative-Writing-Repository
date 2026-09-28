// Views are pages assembled live from blocks and fields (spec 2, 8).
// Nothing here is stored: a profile is recomputed from the index each time.

import { parseDate } from './dates';
import { normalizeName, plainText } from './markup';
import type { Vault } from './vault';
import type { BlockRecord, BlockStatus, EntityChip, FieldKind, FiledVia, ResolvedTemplate } from './types';

export interface BlockView {
  id: string;
  text: string;
  kind: BlockRecord['kind'];
  source: { kind: 'entry' | 'entity'; id: string; title: string };
  /** How this block reached the page being viewed. */
  via?: FiledVia | 'link';
  section?: string;
  author?: string;
  created?: string;
  modified?: string;
  modifiedBy?: string;
  status?: BlockStatus;
  editCount: number;
  /** Number of pages the block appears on (home + profiles). */
  pages: number;
  eventDate?: { text: string; sort?: number };
  warnings: BlockRecord['warnings'];
  filedTo: Array<{ id: string; name: string; color: string }>;
}

export interface FactValue {
  text: string;
  sort?: number;
  entity?: EntityChip;
  /** 'profile' when set on the fact box, otherwise the block that set it. */
  source: 'profile' | string;
  sourceTitle?: string;
  /** Set when the value comes from the other side of a two-way field ("Anna's mother"). */
  via?: string;
}

export interface FactView {
  key: string;
  label: string;
  kind: FieldKind;
  of?: FieldKind;
  entityType?: string;
  values: FactValue[];
  disputed: boolean;
}

export interface RelationGroupView {
  label: string;
  category: string;
  items: Array<{ other: EntityChip; direction: 'out' | 'in'; type: string; topic?: EntityChip; block: BlockView }>;
}

export interface ProfileView {
  entity: EntityChip & { summary: string; keywords: string[]; file: string; created?: string };
  template: ResolvedTemplate;
  pinned?: BlockView;
  facts: FactView[];
  sections: Array<{ name: string; blocks: BlockView[] }>;
  mentions: BlockView[];
  references: BlockView[];
  relations: RelationGroupView[];
  timeline: Array<{ sort: number; label: string; text: string; blockId?: string }>;
  stats: { blocks: number; sources: number };
  /**
   * Paragraphs written elsewhere, for the document-style profile: one entry per section
   * (template order, then headings you added), each grouped by the document it came from
   * and kept in that document's reading order. `name` is '' for unsectioned mentions.
   */
  elsewhere: Array<{ name: string; groups: SourceGroup[] }>;
}

export interface SourceGroup {
  source: BlockView['source'];
  blocks: BlockView[];
}

export function blockView(v: Vault, b: BlockRecord, forEntity?: string): BlockView {
  const meta = v.meta.get(b.id);
  const filing = forEntity ? b.filedTo.find((f) => f.entityId === forEntity) : undefined;
  return {
    id: b.id,
    text: b.text,
    kind: b.kind,
    source: { kind: b.owner.kind, id: b.owner.id, title: v.sourceTitle(b) },
    via: filing?.via ?? (forEntity && b.links.includes(forEntity) ? 'link' : undefined),
    section: filing?.section,
    author: meta?.author,
    created: meta?.created,
    modified: meta?.modified,
    modifiedBy: meta?.modifiedBy,
    status: meta?.status,
    editCount: Math.max(0, (meta?.history.length ?? 1) - 1),
    pages: v.blockPages(b.id).length,
    eventDate: b.eventDate,
    warnings: b.warnings,
    filedTo: b.filedTo.map((f) => {
      const e = v.entities.get(f.entityId);
      return { id: f.entityId, name: e?.name ?? f.entityId, color: e ? v.chip(e).color : '#888' };
    }),
  };
}

function sortBlocks(v: Vault, blocks: BlockRecord[], manual?: string[]): BlockRecord[] {
  const created = (b: BlockRecord) => v.meta.get(b.id)?.created ?? '';
  const sorted = [...blocks].sort((a, b) => {
    const da = a.eventDate?.sort;
    const db = b.eventDate?.sort;
    if (da !== undefined && db !== undefined && da !== db) return da - db;
    if (da !== undefined && db === undefined) return -1;
    if (db !== undefined && da === undefined) return 1;
    // Same file: keep reading order. Otherwise, by when they were written.
    if (a.file === b.file) return a.position - b.position;
    return created(a).localeCompare(created(b)) || a.position - b.position;
  });
  if (!manual?.length) return sorted;
  const pos = new Map(manual.map((id, i) => [id, i]));
  return sorted.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}

function factValues(v: Vault, raw: unknown, kind: FieldKind, of?: FieldKind): FactValue[] {
  const one = (x: unknown): FactValue | null => {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'object' && !Array.isArray(x)) {
      const o = x as { text?: unknown; sort?: unknown };
      if (o.text !== undefined) return { text: String(o.text), sort: typeof o.sort === 'number' ? o.sort : undefined, source: 'profile' };
    }
    const text = String(x);
    const fv: FactValue = { text, source: 'profile' };
    const k = kind === 'list' ? of : kind;
    if (k === 'date') fv.sort = parseDate(text)?.sort;
    if (k === 'entity' || text.startsWith('@')) {
      const r = v.names.resolve(text.replace(/^@+/, ''));
      if (r.status === 'ok') fv.entity = v.chip(v.entities.get(r.id)!);
    }
    return fv;
  };
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(one).filter((x): x is FactValue => !!x);
}

interface FieldLink {
  from: string;
  to: string;
  field: string;
  label: string;
  inverse: string;
  source: 'profile' | string;
  sourceTitle?: string;
}

/** Every entity-to-entity link made through a two-way field, from profiles and from blocks. */
function fieldLinks(v: Vault): FieldLink[] {
  const out: FieldLink[] = [];
  const defOf = (entityId: string, key: string) => v.template(v.entities.get(entityId)?.type ?? '').fields.find((f) => f.key === key);
  for (const e of v.entities.values()) {
    for (const [key, raw] of Object.entries(e.fields ?? {})) {
      const def = defOf(e.id, key);
      if (!def?.inverse) continue;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (typeof item !== 'string') continue;
        for (const part of item.split(/\s*[,;]\s*/)) {
          const r = v.names.resolve(part.replace(/^@+/, ''));
          if (r.status === 'ok') out.push({ from: e.id, to: r.id, field: key, label: def.label, inverse: def.inverse, source: 'profile' });
        }
      }
    }
  }
  for (const b of v.blocks.values()) {
    for (const fa of b.fields) {
      if (!fa.entityRef) continue;
      const def = defOf(fa.entityId, fa.field);
      if (def?.inverse) out.push({ from: fa.entityId, to: fa.entityRef, field: fa.field, label: def.label, inverse: def.inverse, source: b.id, sourceTitle: v.sourceTitle(b) });
    }
  }
  return out;
}

export function buildProfile(v: Vault, entityId: string): ProfileView {
  const e = v.entities.get(entityId);
  if (!e) throw new Error(`No entity ${entityId}`);
  const tpl = v.template(e.type);
  const chip = v.chip(e);

  const filed = v.blocksFiledTo(entityId).filter((b) => b.kind !== 'heading' && v.meta.get(b.id)?.status !== 'deleted');

  // Fact box: values typed on the profile, plus values set by {field: value} in blocks.
  const links = fieldLinks(v);
  const facts: FactView[] = tpl.fields.map((fd) => {
    const values = factValues(v, e.fields[fd.key], fd.kind, fd.of);
    for (const b of v.blocks.values()) {
      for (const fa of b.fields) {
        if (fa.entityId !== entityId || fa.field !== fd.key) continue;
        values.push({
          text: fa.valueText.replace(/^@+/, ''),
          sort: fa.sort,
          entity: fa.entityRef ? v.chip(v.entities.get(fa.entityRef)!) : undefined,
          source: b.id,
          sourceTitle: v.sourceTitle(b),
        });
      }
    }
    // Two-way fields: someone else's {mother: @This} lists them here under Children.
    for (const link of links) {
      if (link.to !== entityId || link.inverse !== fd.key) continue;
      if (values.some((x) => x.entity?.id === link.from)) continue;
      const other = v.entities.get(link.from)!;
      values.push({ text: other.name, entity: v.chip(other), source: link.source, sourceTitle: link.sourceTitle, via: `${other.name}'s ${link.label.toLowerCase()}` });
    }
    const distinct = new Set(values.map((x) => (x.sort !== undefined ? String(x.sort) : normalizeName(x.text))));
    const isList = fd.kind === 'list';
    return { key: fd.key, label: fd.label, kind: fd.kind, of: fd.of, entityType: fd.entityType, values, disputed: !isList && distinct.size > 1 };
  });

  // Sections from the template; unsectioned blocks go to Mentions.
  const bySection = new Map<string, BlockRecord[]>(tpl.sections.map((s) => [s, []]));
  const mentions: BlockRecord[] = [];
  let pinned: BlockRecord | undefined;
  for (const b of filed) {
    if (b.pinned && !pinned) {
      pinned = b;
      continue;
    }
    const f = b.filedTo.find((x) => x.entityId === entityId)!;
    if (f.section && bySection.has(f.section)) bySection.get(f.section)!.push(b);
    else if (f.section) {
      // A section that isn't in the template (typo or removed): keep it visible.
      bySection.set(f.section, [b]);
    } else mentions.push(b);
  }

  const sections = [...bySection.entries()].map(([name, blocks]) => ({ name, blocks: sortBlocks(v, blocks, e.order?.[name]).map((b) => blockView(v, b, entityId)) }));

  // Document-style grouping for blocks written in other files.
  const firstWritten = new Map<string, string>();
  for (const b of v.blocks.values()) {
    const key = `${b.owner.kind}:${b.owner.id}`;
    const c = v.meta.get(b.id)?.created ?? '';
    if (!firstWritten.has(key) || c < firstWritten.get(key)!) firstWritten.set(key, c);
  }
  const bySectionElsewhere = new Map<string, BlockRecord[]>();
  for (const name of [...tpl.sections, '']) bySectionElsewhere.set(name, []);
  for (const b of filed) {
    if (b.file === e.file) continue;
    const f = b.filedTo.find((x) => x.entityId === entityId)!;
    const name = f.section ?? '';
    if (!bySectionElsewhere.has(name)) bySectionElsewhere.set(name, []);
    bySectionElsewhere.get(name)!.push(b);
  }
  const elsewhere = [...bySectionElsewhere.entries()]
    .filter(([, blocks]) => blocks.length)
    .sort(([a], [b]) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0))
    .map(([name, blocks]) => {
      const groups = new Map<string, BlockRecord[]>();
      for (const b of blocks) {
        const key = `${b.owner.kind}:${b.owner.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(b);
      }
      return {
        name,
        groups: [...groups.entries()]
          .sort(([a], [b]) => (firstWritten.get(a) ?? '').localeCompare(firstWritten.get(b) ?? ''))
          .map(([, list]) => {
            const views = list.sort((a, b) => a.position - b.position).map((b) => blockView(v, b, entityId));
            return { source: views[0].source, blocks: views };
          }),
      };
    });

  // Relationships, shown from both sides with the inverse label.
  const groups = new Map<string, RelationGroupView>();
  for (const r of v.relationsOf(entityId)) {
    const def = v.relationTypes.get(r.type);
    if (!def) continue;
    const out = r.subject === entityId;
    const otherId = out ? r.object : r.subject;
    const other = v.entities.get(otherId);
    if (!other || otherId === entityId) continue;
    const label = out ? def.label : def.inverse;
    const key = `${label}|${def.category}`;
    if (!groups.has(key)) groups.set(key, { label, category: def.category, items: [] });
    const topic = r.topic ? v.entities.get(r.topic) : undefined;
    groups.get(key)!.items.push({
      other: v.chip(other),
      direction: out ? 'out' : 'in',
      type: r.type,
      topic: topic ? v.chip(topic) : undefined,
      block: blockView(v, v.getBlock(r.blockId), entityId),
    });
  }

  // Timeline strip: dated facts and dated blocks.
  const timeline: ProfileView['timeline'] = [];
  for (const fct of facts) {
    if (fct.kind !== 'date') continue;
    for (const val of fct.values) if (val.sort !== undefined) timeline.push({ sort: val.sort, label: fct.label, text: val.text, blockId: val.source === 'profile' ? undefined : val.source });
  }
  for (const b of filed) {
    if (b.eventDate?.sort === undefined) continue;
    if (timeline.some((t) => t.blockId === b.id)) continue;
    const txt = plainText(b.text, v.names);
    timeline.push({ sort: b.eventDate.sort, label: '', text: txt.length > 90 ? `${txt.slice(0, 88)}…` : txt, blockId: b.id });
  }
  timeline.sort((a, b) => a.sort - b.sort);

  const sources = new Set(filed.map((b) => `${b.owner.kind}:${b.owner.id}`));

  return {
    entity: { ...chip, summary: e.summary, keywords: e.keywords, file: e.file, created: e.created },
    template: tpl,
    pinned: pinned ? blockView(v, pinned, entityId) : undefined,
    facts,
    sections,
    mentions: sortBlocks(v, mentions).map((b) => blockView(v, b, entityId)),
    references: v.blocksLinking(entityId).map((b) => blockView(v, b, entityId)),
    relations: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)),
    timeline,
    stats: { blocks: filed.length, sources: sources.size },
    elsewhere,
  };
}

// ---------------------------------------------------------------- search

export interface SwitchResult {
  kind: 'entry' | 'entity';
  id: string;
  title: string;
  detail: string;
  color?: string;
  matched?: string;
  score: number;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const wordStart = t.split(/[\s\-—–:]+/).some((w) => w.startsWith(q));
  if (wordStart) return 600 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 400 - idx - t.length / 10;
  // Subsequence
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j === -1) return 0;
    gaps += j - ti;
    ti = j + 1;
  }
  return Math.max(1, 200 - gaps * 5 - t.length / 10);
}

export function quickSwitch(v: Vault, query: string, limit = 30): SwitchResult[] {
  const out: SwitchResult[] = [];
  for (const e of v.entries.values()) {
    const s = fuzzyScore(query, e.title);
    if (s > 0) out.push({ kind: 'entry', id: e.id, title: e.title, detail: `Entry · ${e.file.replace(/^entries\//, '').replace(/\.md$/, '')}`, score: s + 1 });
  }
  for (const e of v.entities.values()) {
    let best = fuzzyScore(query, e.name);
    let matched: string | undefined;
    for (const a of e.aliases) {
      const s = fuzzyScore(query, a) - 5;
      if (s > best) {
        best = s;
        matched = a;
      }
    }
    if (best > 0) {
      const chip = v.chip(e);
      out.push({ kind: 'entity', id: e.id, title: e.name, detail: chip.typeName, color: chip.color, matched, score: best });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export interface SearchHit {
  block: BlockView;
  snippet: string;
}

export interface SearchFilters {
  entityId?: string;
  type?: string;
  kind?: 'entry' | 'entity';
}

export function searchBlocks(v: Vault, query: string, filters: SearchFilters = {}, limit = 200): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hits: Array<SearchHit & { score: number }> = [];
  for (const b of v.blocks.values()) {
    if (filters.kind && b.owner.kind !== filters.kind) continue;
    if (filters.entityId && !b.filedTo.some((f) => f.entityId === filters.entityId)) continue;
    if (filters.type && !b.filedTo.some((f) => v.entities.get(f.entityId)?.type === filters.type)) continue;
    const plain = plainText(b.text, v.names);
    const lower = plain.toLowerCase();
    if (terms.length && !terms.every((t) => lower.includes(t))) continue;
    if (!terms.length && !filters.entityId && !filters.type) continue;
    const first = terms.length ? lower.indexOf(terms[0]) : 0;
    const start = Math.max(0, first - 60);
    const snippet = (start > 0 ? '…' : '') + plain.slice(start, start + 220) + (start + 220 < plain.length ? '…' : '');
    hits.push({ block: blockView(v, b), snippet, score: terms.reduce((n, t) => n + lower.split(t).length - 1, 0) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...h }) => h);
}
