// The data behind trees, radial charts and timelines. Nothing here is stored:
// every view is drawn from what you wrote (relationships, two-way facts, dates).

import { parseDate } from './dates';
import { plainText } from './markup';
import type { Vault } from './vault';
import type { EntityChip } from './types';

export type EdgeCategory = 'family' | 'spouse' | 'friendship' | 'teaching' | 'agreement' | 'conflict' | 'political' | 'tech' | 'reference' | 'other';

export interface GraphNode extends EntityChip {
  born?: string;
  died?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Normalised kind: parent (from = parent), spouse, sibling, friend, teacher, leads_to, or a relationship type id. */
  kind: string;
  label: string;
  category: EdgeCategory;
  /** Block that states it, or undefined when it was set on a profile. */
  blockId?: string;
  sourceText?: string;
}

// Two-way facts become canonical edges: which end is "from", and what it means.
const FIELD_EDGES: Record<string, { kind: string; reverse?: boolean; category: EdgeCategory; label: string }> = {
  father: { kind: 'parent', reverse: true, category: 'family', label: 'parent of' },
  mother: { kind: 'parent', reverse: true, category: 'family', label: 'parent of' },
  parents: { kind: 'parent', reverse: true, category: 'family', label: 'parent of' },
  sons: { kind: 'parent', category: 'family', label: 'parent of' },
  daughters: { kind: 'parent', category: 'family', label: 'parent of' },
  children: { kind: 'parent', category: 'family', label: 'parent of' },
  grandfather: { kind: 'grandparent', reverse: true, category: 'family', label: 'grandparent of' },
  grandmother: { kind: 'grandparent', reverse: true, category: 'family', label: 'grandparent of' },
  grandparents: { kind: 'grandparent', reverse: true, category: 'family', label: 'grandparent of' },
  grandchildren: { kind: 'grandparent', category: 'family', label: 'grandparent of' },
  spouse: { kind: 'spouse', category: 'spouse', label: 'married to' },
  siblings: { kind: 'sibling', category: 'family', label: 'sibling of' },
  friends: { kind: 'friend', category: 'friendship', label: 'friend of' },
  teachers: { kind: 'teacher', reverse: true, category: 'teaching', label: 'teacher of' },
  students: { kind: 'teacher', category: 'teaching', label: 'teacher of' },
  requires: { kind: 'leads_to', reverse: true, category: 'tech', label: 'leads to' },
  leads_to: { kind: 'leads_to', category: 'tech', label: 'leads to' },
  allies: { kind: 'ally', category: 'agreement', label: 'allied with' },
  enemies: { kind: 'enemy', category: 'conflict', label: 'enemy of' },
  rivals: { kind: 'rival', category: 'conflict', label: 'rival of' },
  overlord: { kind: 'overlord', reverse: true, category: 'political', label: 'overlord of' },
  vassals: { kind: 'overlord', category: 'political', label: 'overlord of' },
  eats: { kind: 'eats', category: 'other', label: 'eats' },
  eaten_by: { kind: 'eats', reverse: true, category: 'other', label: 'eats' },
};

// Relationship types (from relations.yaml) mapped onto the same canonical kinds.
const RELATION_KINDS: Record<string, { kind: string; reverse?: boolean }> = {
  parent_of: { kind: 'parent' },
  child_of: { kind: 'parent', reverse: true },
  married_to: { kind: 'spouse' },
  sibling_of: { kind: 'sibling' },
  friend_of: { kind: 'friend' },
  teacher_of: { kind: 'teacher' },
  student_of: { kind: 'teacher', reverse: true },
  allied_with: { kind: 'ally' },
  enemy_of: { kind: 'enemy' },
};

const CATEGORY_OF: Record<string, EdgeCategory> = {
  family: 'family',
  conflict: 'conflict',
  agreement: 'agreement',
  teaching: 'teaching',
  political: 'political',
  friendship: 'friendship',
  ownership: 'other',
  reference: 'reference',
  place: 'other',
};

/** born/died-style dates written in blocks ({born: 1280}), by entity. */
function writtenDates(v: Vault): Map<string, { born?: string; died?: string }> {
  const out = new Map<string, { born?: string; died?: string }>();
  for (const b of v.blocks.values()) {
    for (const fa of b.fields) {
      const d = out.get(fa.entityId) ?? {};
      if (!d.born && (fa.field === 'born' || fa.field === 'founded' || fa.field === 'discovered')) d.born = fa.valueText;
      if (!d.died && fa.field === 'died') d.died = fa.valueText;
      out.set(fa.entityId, d);
    }
  }
  return out;
}

function nodeOf(v: Vault, id: string, written: Map<string, { born?: string; died?: string }>): GraphNode {
  const e = v.entities.get(id)!;
  const chip = v.chip(e);
  const f = e.fields ?? {};
  const text = (x: unknown) => (x === undefined || x === null ? undefined : typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : String(x));
  const w = written.get(id);
  return { ...chip, born: text(f.born ?? f.founded ?? f.discovered) ?? w?.born, died: text(f.died) ?? w?.died };
}

export function buildGraph(v: Vault): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (e: GraphEdge) => {
    if (!v.entities.has(e.from) || !v.entities.has(e.to) || e.from === e.to) return;
    const symmetric = ['spouse', 'sibling', 'friend', 'ally', 'enemy', 'rival'].includes(e.kind);
    const key = symmetric ? `${e.kind}|${[e.from, e.to].sort().join('|')}` : `${e.kind}|${e.from}|${e.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };

  const fieldEdge = (owner: string, key: string, target: string, blockId?: string, sourceText?: string) => {
    const spec = FIELD_EDGES[key];
    if (spec) {
      const [from, to] = spec.reverse ? [target, owner] : [owner, target];
      add({ from, to, kind: spec.kind, label: spec.label, category: spec.category, blockId, sourceText });
      return;
    }
    // Any other link between two entities (ruler, capital, inventor…) is still a line on a chart.
    const def = v.template(v.entities.get(owner)?.type ?? '').fields.find((fd) => fd.key === key);
    add({ from: owner, to: target, kind: `field:${key}`, label: (def?.label ?? key).toLowerCase(), category: 'other', blockId, sourceText });
  };

  for (const e of v.entities.values()) {
    for (const [key, raw] of Object.entries(e.fields ?? {})) {
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (typeof item !== 'string') continue;
        for (const part of item.split(/\s*[,;]\s*/)) {
          const r = v.names.resolve(part.replace(/^@+/, ''));
          if (r.status === 'ok') fieldEdge(e.id, key, r.id);
        }
      }
    }
  }
  for (const b of v.blocks.values()) {
    const text = plainText(b.text, v.names);
    for (const fa of b.fields) if (fa.entityRef) fieldEdge(fa.entityId, fa.field, fa.entityRef, b.id, text);
    for (const r of b.relations) {
      const def = v.relationTypes.get(r.type);
      const canon = RELATION_KINDS[r.type];
      if (canon) {
        const [from, to] = canon.reverse ? [r.object, r.subject] : [r.subject, r.object];
        const spec = Object.values(FIELD_EDGES).find((x) => x.kind === canon.kind)!;
        add({ from, to, kind: canon.kind, label: spec.label, category: spec.category, blockId: b.id, sourceText: text });
      } else {
        add({ from: r.subject, to: r.object, kind: r.type, label: (def?.label ?? r.type).toLowerCase(), category: CATEGORY_OF[def?.category ?? ''] ?? 'other', blockId: b.id, sourceText: text });
      }
    }
  }
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  const written = writtenDates(v);
  const nodes = [...v.entities.values()].map((e) => nodeOf(v, e.id, written));
  return { nodes: nodes.sort((a, b) => (used.has(b.id) ? 1 : 0) - (used.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name)), edges };
}

export interface TimelineEvent {
  sort: number;
  end?: number;
  approximate: boolean;
  label: string;
  text: string;
  entityIds: string[];
  blockId?: string;
  kind: 'fact' | 'event' | 'life';
}

/** Every dated thing in the project: dated facts, dated paragraphs, and life spans. */
export function buildTimeline(v: Vault): { events: TimelineEvent[]; nodes: GraphNode[] } {
  const events: TimelineEvent[] = [];
  const lives = new Map<string, { born?: ReturnType<typeof parseDate>; died?: ReturnType<typeof parseDate>; blockId?: string }>();
  const dateFact = (entityId: string, key: string, label: string, value: string, blockId?: string) => {
    const d = parseDate(value);
    if (!d) return;
    if (key === 'born' || key === 'died') {
      const life = lives.get(entityId) ?? {};
      if (!life[key]) life[key] = d;
      lives.set(entityId, life);
      return;
    }
    const name = v.entities.get(entityId)?.name ?? '';
    events.push({ sort: d.sort, end: d.end, approximate: d.approximate, label: `${name}: ${label.toLowerCase()}`, text: value, entityIds: [entityId], blockId, kind: 'fact' });
  };
  for (const e of v.entities.values()) {
    const tpl = v.template(e.type);
    for (const fd of tpl.fields) {
      if (fd.kind !== 'date') continue;
      const raw = e.fields?.[fd.key];
      const value = raw && typeof raw === 'object' && 'text' in (raw as object) ? String((raw as { text: unknown }).text) : raw !== undefined ? String(raw) : '';
      if (value) dateFact(e.id, fd.key, fd.label, value);
    }
  }
  for (const b of v.blocks.values()) {
    for (const fa of b.fields) {
      const def = v.template(v.entities.get(fa.entityId)?.type ?? '').fields.find((f) => f.key === fa.field);
      if (def?.kind === 'date') dateFact(fa.entityId, fa.field, def.label, fa.valueText, b.id);
    }
    if (b.eventDate?.sort !== undefined && b.kind !== 'heading') {
      const d = parseDate(b.eventDate.text);
      const text = plainText(b.text, v.names);
      events.push({
        sort: b.eventDate.sort,
        end: d?.end,
        approximate: d?.approximate ?? false,
        label: text.length > 80 ? `${text.slice(0, 78)}…` : text,
        text,
        entityIds: b.filedTo.map((f) => f.entityId),
        blockId: b.id,
        kind: 'event',
      });
    }
  }
  for (const [id, life] of lives) {
    const name = v.entities.get(id)?.name ?? '';
    if (life.born && life.died) events.push({ sort: life.born.sort, end: life.died.sort, approximate: life.born.approximate || life.died.approximate, label: name, text: `${life.born.text}–${life.died.text}`, entityIds: [id], kind: 'life' });
    else if (life.born) events.push({ sort: life.born.sort, approximate: life.born.approximate, label: `${name} born`, text: life.born.text, entityIds: [id], kind: 'fact' });
    else if (life.died) events.push({ sort: life.died.sort, approximate: life.died.approximate, label: `${name} died`, text: life.died.text, entityIds: [id], kind: 'fact' });
  }
  events.sort((a, b) => a.sort - b.sort);
  const ids = new Set(events.flatMap((e) => e.entityIds));
  const written = writtenDates(v);
  return { events, nodes: [...ids].filter((id) => v.entities.has(id)).map((id) => nodeOf(v, id, written)) };
}
