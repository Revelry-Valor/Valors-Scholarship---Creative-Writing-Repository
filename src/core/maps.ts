// Interactive maps and snapshots.
// A map is a saved view: an image (stored as text in maps/<id>.txt so it syncs like
// everything else) with pins, regions and routes drawn on it, each optionally linked
// to a page and limited to a span of years. A snapshot is the project at one year:
// what existed then, and what happened.

import { parseDate } from './dates';
import { plainText } from './markup';
import type { Vault } from './vault';

export interface MapMarker {
  id: string;
  /** 0..1 across and down the image. */
  x: number;
  y: number;
  entity?: string;
  label?: string;
  from?: number;
  to?: number;
}

export interface MapShape {
  id: string;
  points: Array<[number, number]>;
  entity?: string;
  label?: string;
  color?: string;
  from?: number;
  to?: number;
}

export interface Span {
  start?: number;
  end?: number;
}

const START = /^(born|birth|founded|established|built|created|begun|began|start|reign_start|crowned|discovered|invented)$/;
const END = /^(died|death|dissolved|destroyed|fell|ended|end|abandoned|reign_end|conquered)$/;

/** When each page begins and ends, from its date facts (on the page or in any paragraph). */
export function entitySpans(v: Vault): Record<string, Span> {
  const out: Record<string, Span> = {};
  const note = (id: string, key: string, value: unknown) => {
    const isStart = START.test(key);
    const isEnd = END.test(key);
    if (!isStart && !isEnd) return;
    const d = typeof value === 'number' ? { sort: value } : parseDate(String(value ?? ''));
    if (!d) return;
    const s = (out[id] ??= {});
    if (isStart && (s.start === undefined || d.sort < s.start)) s.start = d.sort;
    if (isEnd && (s.end === undefined || d.sort > s.end)) s.end = d.sort;
  };
  for (const e of v.entities.values()) for (const [k, val] of Object.entries(e.fields ?? {})) note(e.id, k, val);
  for (const b of v.blocks.values()) for (const fa of b.fields) note(fa.entityId, fa.field, fa.sort ?? fa.valueText);
  return out;
}

function isPerson(v: Vault, type: string) {
  const lineage = v.templates.get(type)?.lineage ?? [type];
  return lineage.some((t) => /person|character|father|ruler/.test(t));
}

/** Does a page exist in a given year? People without a death date are assumed to live 90 years. */
export function existsIn(v: Vault, id: string, span: Span | undefined, year: number): boolean {
  if (!span || (span.start === undefined && span.end === undefined)) return true;
  if (span.start !== undefined && year < Math.floor(span.start)) return false;
  if (span.end !== undefined && year > Math.floor(span.end)) return false;
  if (span.end === undefined && span.start !== undefined) {
    const e = v.entities.get(id);
    if (e && isPerson(v, e.type) && year - span.start > 90) return false;
  }
  return true;
}

export interface Snapshot {
  year: number;
  /** Pages that existed that year (only pages with dates are listed). */
  existing: Array<{ id: string; name: string; type: string; typeName: string; color: string; start?: number; end?: number; age?: number }>;
  began: string[];
  ended: string[];
  /** Dated paragraphs and facts in the year (or window). */
  events: Array<{ sort: number; text: string; blockId?: string; entityIds: string[] }>;
  range: { min?: number; max?: number };
}

/** The project at one year: who and what existed, what began or ended, what happened. */
export function snapshot(v: Vault, year: number, window = 0): Snapshot {
  const spans = entitySpans(v);
  const existing: Snapshot['existing'] = [];
  const began: string[] = [];
  const ended: string[] = [];
  let min: number | undefined;
  let max: number | undefined;
  const widen = (n?: number) => {
    if (n === undefined) return;
    min = min === undefined ? n : Math.min(min, n);
    max = max === undefined ? n : Math.max(max, n);
  };
  for (const [id, s] of Object.entries(spans)) {
    const e = v.entities.get(id);
    if (!e) continue;
    widen(s.start);
    widen(s.end);
    if (s.start !== undefined && Math.floor(s.start) === year) began.push(id);
    if (s.end !== undefined && Math.floor(s.end) === year) ended.push(id);
    if (!existsIn(v, id, s, year)) continue;
    const chip = v.chip(e);
    existing.push({ id, name: e.name, type: e.type, typeName: chip.typeName, color: chip.color, start: s.start, end: s.end, age: s.start !== undefined && isPerson(v, e.type) ? Math.floor(year - s.start) : undefined });
  }
  const events: Snapshot['events'] = [];
  for (const b of v.blocks.values()) {
    if (b.eventDate?.sort === undefined || b.kind === 'heading') continue;
    widen(b.eventDate.sort);
    if (Math.abs(Math.floor(b.eventDate.sort) - year) > window) continue;
    events.push({ sort: b.eventDate.sort, text: plainText(b.text, v.names), blockId: b.id, entityIds: b.filedTo.map((f) => f.entityId) });
  }
  events.sort((a, b) => a.sort - b.sort);
  existing.sort((a, b) => a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
  return { year, existing, began, ended, events, range: { min, max } };
}

/** Is a map item visible in a year? Its own years win; otherwise its page's. */
export function itemVisible(item: { from?: number; to?: number; entity?: string }, span: Span | undefined, year: number | undefined): boolean {
  if (year === undefined) return true;
  const from = item.from ?? span?.start;
  const to = item.to ?? span?.end;
  if (from !== undefined && year < Math.floor(from)) return false;
  if (to !== undefined && year > Math.floor(to)) return false;
  return true;
}
