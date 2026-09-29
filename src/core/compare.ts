// Three research views built from what is already indexed:
//   extraction tables  one row per page, one column per fact (or count, date, word)
//   parallel accounts  several sources side by side, lined up by verse, by page or in order
//   claims & evidence  paragraphs marked !claim, with the paragraphs that support or oppose them

import { plainText } from './markup';
import { lookup } from './lookup';
import { BOOKS, findScriptureRefs } from './scripture';
import { compileWords, findWords } from './triggers';
import type { Vault } from './vault';
import type { BlockRecord, DocKind, ViewDef } from './types';

// ---------------------------------------------------------------- extraction tables

export const COMPUTED_COLUMNS: Array<{ key: string; label: string; hint: string }> = [
  { key: '@type', label: 'Type', hint: 'The kind of page' },
  { key: '@aliases', label: 'Also called', hint: 'Other names' },
  { key: '@mentions', label: 'Paragraphs', hint: 'How many paragraphs are filed to it' },
  { key: '@sources', label: 'Documents', hint: 'How many documents mention it' },
  { key: '@first', label: 'First date', hint: 'Earliest date in its paragraphs or facts' },
  { key: '@last', label: 'Last date', hint: 'Latest date in its paragraphs or facts' },
  { key: '@relations', label: 'Links', hint: 'How many relationships it has' },
  { key: '@keywords', label: 'Keywords', hint: 'Its keyword list' },
  { key: '@summary', label: 'Summary', hint: 'Its one-line summary' },
];

export interface TableCell {
  text: string;
  sort?: number;
  disputed?: boolean;
  /** Where a value came from: the profile's fact box, or blocks. */
  blockIds?: string[];
  entityIds?: string[];
}

export interface EntityTable {
  columns: Array<{ key: string; label: string; numeric: boolean }>;
  rows: Array<{ id: string; name: string; type: string; typeName: string; color: string; cells: Record<string, TableCell> }>;
}

function typeMatches(v: Vault, type: string, wanted?: string[]): boolean {
  if (!wanted?.length) return true;
  const lineage = v.templates.get(type)?.lineage ?? [type];
  return wanted.some((w) => lineage.includes(w));
}

/** One row per page of the chosen types; columns are facts, counts and word counts ("#baptism"). */
export function entityTable(v: Vault, def: Pick<ViewDef, 'types' | 'fields'>): EntityTable {
  const entities = [...v.entities.values()].filter((e) => typeMatches(v, e.type, def.types));
  // Default columns: the facts of the chosen types, then counts.
  let keys = def.fields?.length ? def.fields : [];
  if (!keys.length) {
    const seen: string[] = [];
    for (const e of entities) for (const f of v.template(e.type).fields) if (!seen.includes(f.key)) seen.push(f.key);
    keys = [...(def.types?.length === 1 ? [] : ['@type']), ...seen.slice(0, 7), '@mentions', '@first'];
  }
  const labelOf = (k: string) => {
    if (k.startsWith('#')) return `“${k.slice(1)}”`;
    const c = COMPUTED_COLUMNS.find((x) => x.key === k);
    if (c) return c.label;
    for (const e of entities) {
      const f = v.template(e.type).fields.find((x) => x.key === k);
      if (f) return f.label;
    }
    return k;
  };

  // One pass over the blocks.
  const assigned = new Map<string, Map<string, Array<{ text: string; sort?: number; blockId: string; entityRef?: string }>>>();
  const filed = new Map<string, BlockRecord[]>();
  const rels = new Map<string, number>();
  for (const b of v.blocks.values()) {
    for (const fa of b.fields) {
      let m = assigned.get(fa.entityId);
      if (!m) assigned.set(fa.entityId, (m = new Map()));
      const list = m.get(fa.field) ?? [];
      list.push({ text: fa.valueText.replace(/^@+/, '').replace(/^\[|\]$/g, ''), sort: fa.sort, blockId: b.id, entityRef: fa.entityRef });
      m.set(fa.field, list);
    }
    if (b.kind !== 'heading') for (const f of b.filedTo) (filed.get(f.entityId) ?? filed.set(f.entityId, []).get(f.entityId)!).push(b);
    for (const r of b.relations) {
      rels.set(r.subject, (rels.get(r.subject) ?? 0) + 1);
      rels.set(r.object, (rels.get(r.object) ?? 0) + 1);
    }
  }
  const termRe = new Map(keys.filter((k) => k.startsWith('#')).map((k) => [k, compileWords([k.slice(1)])]));

  const rows: EntityTable['rows'] = entities.map((e) => {
    const chip = v.chip(e);
    const cells: Record<string, TableCell> = {};
    const blocks = filed.get(e.id) ?? [];
    const dates: number[] = [];
    for (const b of blocks) if (b.eventDate?.sort !== undefined) dates.push(b.eventDate.sort);
    for (const list of assigned.get(e.id)?.values() ?? []) for (const x of list) if (x.sort !== undefined) dates.push(x.sort);
    for (const k of keys) {
      if (k === '@type') cells[k] = { text: chip.typeName };
      else if (k === '@aliases') cells[k] = { text: e.aliases.join(', ') };
      else if (k === '@keywords') cells[k] = { text: (e.keywords ?? []).join(', ') };
      else if (k === '@summary') cells[k] = { text: e.summary ?? '' };
      else if (k === '@mentions') cells[k] = { text: String(blocks.length), sort: blocks.length };
      else if (k === '@sources') {
        const n = new Set(blocks.map((b) => b.file)).size;
        cells[k] = { text: String(n), sort: n };
      } else if (k === '@relations') cells[k] = { text: String(rels.get(e.id) ?? 0), sort: rels.get(e.id) ?? 0 };
      else if (k === '@first' || k === '@last') {
        const d = dates.length ? (k === '@first' ? Math.min(...dates) : Math.max(...dates)) : undefined;
        cells[k] = d === undefined ? { text: '' } : { text: d < 0 ? `${-Math.floor(d)} BC` : String(Math.floor(d)), sort: d };
      } else if (k.startsWith('#')) {
        const re = termRe.get(k);
        const hits = re ? blocks.filter((b) => findWords(re, plainText(b.text, v.names)).length) : [];
        cells[k] = { text: hits.length ? String(hits.length) : '', sort: hits.length, blockIds: hits.map((b) => b.id) };
      } else {
        const values: Array<{ text: string; sort?: number; blockId?: string; entityRef?: string }> = [];
        const raw = e.fields[k];
        const rawList = Array.isArray(raw) ? raw : raw !== undefined && raw !== null && raw !== '' ? [raw] : [];
        for (const r of rawList) {
          const text = String(r).replace(/^@+/, '').replace(/^\[|\]$/g, '');
          const ref = /^@/.test(String(r)) ? v.names.resolve(text) : undefined;
          values.push({ text, sort: typeof r === 'number' ? r : undefined, entityRef: ref?.status === 'ok' ? ref.id : undefined });
        }
        values.push(...(assigned.get(e.id)?.get(k) ?? []));
        const distinct = [...new Set(values.map((x) => x.text))];
        const isList = v.template(e.type).fields.find((f) => f.key === k)?.kind === 'list';
        cells[k] = {
          text: distinct.join(isList ? ', ' : ' / '),
          sort: values.find((x) => x.sort !== undefined)?.sort,
          disputed: !isList && distinct.length > 1,
          blockIds: values.map((x) => x.blockId).filter((x): x is string => !!x),
          entityIds: values.map((x) => x.entityRef).filter((x): x is string => !!x),
        };
      }
    }
    return { id: e.id, name: e.name, type: e.type, typeName: chip.typeName, color: chip.color, cells };
  });
  const numeric = (k: string) => k.startsWith('#') || ['@mentions', '@sources', '@relations', '@first', '@last'].includes(k) || rows.some((r) => r.cells[k]?.sort !== undefined);
  return { columns: keys.map((k) => ({ key: k, label: labelOf(k), numeric: numeric(k) })), rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function tableCsv(t: EntityTable): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [['Name', ...t.columns.map((c) => c.label)].map(q).join(','), ...t.rows.map((r) => [r.name, ...t.columns.map((c) => r.cells[c.key]?.text ?? '')].map(q).join(','))].join('\n');
}

// ---------------------------------------------------------------- parallel accounts

export interface ParallelColumn {
  source?: { kind: DocKind; id: string };
  query?: string;
  label?: string;
}

export interface ParallelCell {
  id: string;
  text: string;
  source: { kind: DocKind; id: string; title: string };
}

export interface ParallelResult {
  columns: Array<{ label: string }>;
  rows: Array<{ key: string; label: string; cells: ParallelCell[][] }>;
  truncated: boolean;
}

function columnBlocks(v: Vault, c: ParallelColumn): BlockRecord[] {
  if (c.query) return lookup(v, { text: c.query, scope: { all: true }, limit: 400 }).hits.map((h) => v.blocks.get(h.blockId)!).filter(Boolean);
  if (!c.source) return [];
  if (c.source.kind === 'entity') {
    const e = v.entities.get(c.source.id);
    if (!e) return [];
    const own = [...v.blocks.values()].filter((b) => b.file === e.file).sort((a, b) => a.position - b.position);
    const other = v.blocksFiledTo(e.id).filter((b) => b.file !== e.file);
    return [...own, ...other].filter((b) => b.kind !== 'heading');
  }
  const out: BlockRecord[] = [];
  for (const [rel, st] of v.files) {
    if (st.kind !== c.source.kind || st.ownerId !== c.source.id) continue;
    for (const pb of st.blocks) {
      const b = pb.id ? v.blocks.get(pb.id) : undefined;
      if (b && b.kind !== 'heading') out.push(b);
    }
    void rel;
  }
  return out;
}

export function columnLabel(v: Vault, c: ParallelColumn): string {
  if (c.label) return c.label;
  if (c.query) return `“${c.query}”`;
  if (!c.source) return '—';
  if (c.source.kind === 'entity') return v.entities.get(c.source.id)?.name ?? '—';
  if (c.source.kind === 'library') {
    const l = v.library.get(c.source.id);
    return l ? (l.author ? `${l.author}, ${l.title}` : l.title) : '—';
  }
  return v.entries.get(c.source.id)?.title ?? '—';
}

const BOOK_ORDER = new Map(BOOKS.map((b, i) => [b.id, i]));

/** Verse keys a paragraph speaks to: its own address for a Bible verse, or the verses it cites. */
function verseKeys(b: BlockRecord): Array<{ key: string; label: string; order: number }> {
  const own = /^\[([^\]]+)\]/.exec(b.text);
  const refs = own ? findScriptureRefs(own[1]).slice(0, 1) : b.scripture.map((s) => ({ ...s, book: s.book }));
  return refs.map((r) => {
    const verse = 'verseStart' in r && r.verseStart !== undefined ? r.verseStart : 0;
    const book = BOOKS.find((x) => x.id === r.book);
    return { key: `${r.book} ${r.chapter}:${verse}`, label: `${book?.name ?? r.book} ${r.chapter}${verse ? `:${verse}` : ''}`, order: (BOOK_ORDER.get(r.book) ?? 999) * 1e6 + r.chapter * 1e3 + verse };
  });
}

/** Line up several sources: by verse, by the pages the paragraphs are filed to, or simply in order. */
export function parallelView(v: Vault, def: Pick<ViewDef, 'columns' | 'align'>, limit = 400): ParallelResult {
  const cols = def.columns ?? [];
  const align = def.align ?? 'verse';
  const rows = new Map<string, { key: string; label: string; order: number; cells: ParallelCell[][] }>();
  const cell = (b: BlockRecord): ParallelCell => ({ id: b.id, text: b.text, source: { kind: b.owner.kind, id: b.owner.id, title: v.sourceTitle(b) } });
  cols.forEach((c, ci) => {
    columnBlocks(v, c).forEach((b, i) => {
      let keys: Array<{ key: string; label: string; order: number }>;
      if (align === 'verse') keys = verseKeys(b);
      else if (align === 'tag') keys = b.filedTo.map((f) => ({ key: f.entityId, label: v.entities.get(f.entityId)?.name ?? f.entityId, order: 0 }));
      else keys = [{ key: String(i), label: String(i + 1), order: i }];
      for (const k of keys) {
        let row = rows.get(k.key);
        if (!row) rows.set(k.key, (row = { ...k, cells: cols.map(() => []) }));
        if (!row.cells[ci].some((x) => x.id === b.id)) row.cells[ci].push(cell(b));
      }
    });
  });
  let list = [...rows.values()];
  // Rows found in more than one column first when lining up by page; verses and order keep their order.
  if (align === 'tag') list.sort((a, b) => b.cells.filter((c) => c.length).length - a.cells.filter((c) => c.length).length || a.label.localeCompare(b.label));
  else list.sort((a, b) => a.order - b.order);
  const truncated = list.length > limit;
  list = list.slice(0, limit);
  return { columns: cols.map((c) => ({ label: columnLabel(v, c) })), rows: list.map(({ key, label, cells }) => ({ key, label, cells })), truncated };
}

/** Word-level differences: ranges in `b` whose words are not in `a` in the same order. */
export function wordDiff(a: string, b: string): Array<[number, number]> {
  const tok = (s: string) => [...s.matchAll(/[\p{L}\p{N}'’]+/gu)].map((m) => ({ w: m[0].toLowerCase(), from: m.index!, to: m.index! + m[0].length }));
  const A = tok(a).slice(0, 400);
  const B = tok(b).slice(0, 400);
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i].w === B[j].w ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (j < B.length) {
    if (i < A.length && A[i].w === B[j].w) {
      i++;
      j++;
    } else if (i < A.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else {
      const last = out[out.length - 1];
      if (last && /^\s*$/.test(b.slice(last[1], B[j].from))) last[1] = B[j].to;
      else out.push([B[j].from, B[j].to]);
      j++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- claims & evidence

export type EvidenceStance = 'for' | 'against' | 'context';

export interface ClaimLedger {
  claims: Record<string, { evidence: Array<{ block: string; stance: EvidenceStance; note?: string }> }>;
}

export type ClaimStatus = 'unsupported' | 'supported' | 'contested' | 'challenged';

export interface ClaimView {
  id: string;
  text: string;
  source: { kind: DocKind; id: string; title: string };
  filedTo: Array<{ id: string; name: string; color: string }>;
  status: ClaimStatus;
  evidence: Array<{ id: string; text: string; stance: EvidenceStance; note?: string; source: { kind: DocKind; id: string; title: string }; missing?: boolean }>;
}

export function claimStatus(e: Array<{ stance: EvidenceStance }>): ClaimStatus {
  const f = e.filter((x) => x.stance === 'for').length;
  const a = e.filter((x) => x.stance === 'against').length;
  if (!f && !a) return 'unsupported';
  if (f && a) return 'contested';
  return f ? 'supported' : 'challenged';
}

export function claimViews(v: Vault, ledger: ClaimLedger): ClaimView[] {
  const src = (b: BlockRecord) => ({ kind: b.owner.kind, id: b.owner.id, title: v.sourceTitle(b) });
  const out: ClaimView[] = [];
  for (const b of v.blocks.values()) {
    if (!b.marks.includes('claim')) continue;
    const ev = (ledger.claims[b.id]?.evidence ?? []).map((x) => {
      const eb = v.blocks.get(x.block);
      return eb ? { id: eb.id, text: eb.text, stance: x.stance, note: x.note, source: src(eb) } : { id: x.block, text: '(this paragraph was deleted)', stance: x.stance, note: x.note, source: { kind: 'entry' as DocKind, id: '', title: '' }, missing: true };
    });
    out.push({
      id: b.id,
      text: b.text,
      source: src(b),
      filedTo: b.filedTo.map((f) => {
        const e = v.entities.get(f.entityId);
        return { id: f.entityId, name: e?.name ?? f.entityId, color: e ? v.chip(e).color : '#888' };
      }),
      status: claimStatus(ev),
      evidence: ev,
    });
  }
  return out.sort((a, b) => a.source.title.localeCompare(b.source.title) || (v.blocks.get(a.id)!.position - v.blocks.get(b.id)!.position));
}
