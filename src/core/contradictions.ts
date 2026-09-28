// Contradiction finder (offline, rule-based). It reads what the project already
// knows and lists places where two things cannot both be true, each with the
// paragraphs involved so you can decide. It never changes anything.
//
//   facts        one page, one fact, different values          born 1280 / born 1290
//   dates        a date that cannot fit                         died before born · wrote after death · parent younger than child
//   relations    two links that pull opposite ways              allied with / enemy of · teacher of each other
//   statements   the same subject, verb and object, yes and no  "Scouch accepted the Shepherd" / "Scouch rejected the Shepherd"
//   canon        one author, one writing, two verdicts          Eusebius: Revelation received / disputed

import { normalizeName, tokenize, type TagToken } from './markup';
import { canonMentions, CANON_WORKS, type Stance } from './lookup';
import { findScriptureRefs } from './scripture';
import type { Vault } from './vault';
import type { BlockRecord, DocKind } from './types';

export type ContradictionKind = 'facts' | 'dates' | 'relations' | 'statements' | 'canon';

export const CONTRADICTION_KINDS: Array<{ id: ContradictionKind; label: string; hint: string }> = [
  { id: 'facts', label: 'Facts that differ', hint: 'The same fact about a page has different values' },
  { id: 'dates', label: 'Impossible dates', hint: 'Born after died, events after death, parents younger than children' },
  { id: 'relations', label: 'Opposite links', hint: 'Allies and enemies at once, teachers of each other' },
  { id: 'statements', label: 'Opposite statements', hint: 'Yes in one paragraph, no in another' },
  { id: 'canon', label: 'Two verdicts on a book', hint: 'An author receives and rejects the same writing' },
];

export interface Side {
  blockId?: string;
  text: string;
  source?: { kind: DocKind; id: string; title: string };
  /** Words to highlight in the paragraph. */
  spans?: Array<[number, number]>;
}

export interface Contradiction {
  id: string;
  kind: ContradictionKind;
  title: string;
  detail: string;
  entityIds: string[];
  a: Side;
  b: Side;
}

const START_FIELDS = /^(born|birth|founded|established|begun|began|start|built|created)$/;
const END_FIELDS = /^(died|death|dissolved|destroyed|fell|ended|end|abandoned)$/;

function side(v: Vault, b: BlockRecord | undefined, fallback: string, spans?: Array<[number, number]>): Side {
  if (!b) return { text: fallback };
  return { blockId: b.id, text: b.text, source: { kind: b.owner.kind, id: b.owner.id, title: v.sourceTitle(b) }, spans };
}

function spanOf(text: string, needle: string): Array<[number, number]> | undefined {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  return i >= 0 ? [[i, i + needle.length]] : undefined;
}

const year = (n: number) => (n < 0 ? `${-Math.floor(n)} BC` : String(Math.floor(n)));

// ---------------------------------------------------------------- statements

// Verb pairs that cannot both hold for the same subject and object.
const OPPOSITES: Array<[RegExp, RegExp, string]> = [
  [/\b(accept(?:s|ed)?|receiv(?:es|ed)|acknowledg(?:es|ed)|affirm(?:s|ed)?|approv(?:es|ed)|embrac(?:es|ed))\b/i, /\b(reject(?:s|ed)?|den(?:y|ies|ied)|condemn(?:s|ed)?|refut(?:es|ed)|repudiat(?:es|ed)|renounc(?:es|ed))\b/i, 'accepts / rejects'],
  [/\b(support(?:s|ed)?|defend(?:s|ed)?|agree(?:s|d)? with|sid(?:es|ed) with|allied with)\b/i, /\b(oppos(?:es|ed)|attack(?:s|ed)?|disagree(?:s|d)? with|fought|betray(?:s|ed)?|turned against)\b/i, 'supports / opposes'],
  [/\b(lov(?:es|ed)|admir(?:es|ed)|trust(?:s|ed)?|praised?)\b/i, /\b(hat(?:es|ed)|despis(?:es|ed)|distrust(?:s|ed)?|mistrust(?:s|ed)?|scorn(?:s|ed)?)\b/i, 'loves / hates'],
  [/\b(met|knew|visited)\b/i, /\b(never met|never knew|never visited)\b/i, 'met / never met'],
  [/\b(was (?:a )?(?:bishop|priest|king|queen|emperor|member) of)\b/i, /\b(was never (?:a )?(?:bishop|priest|king|queen|emperor|member) of)\b/i, 'was / was never'],
];
const NEG = /\b(not|never|no longer|did not|didn't|does not|doesn't|refused to|failed to)\b/i;

interface Triple {
  subject: string;
  object: string;
  objectLabel: string;
  pair: number;
  side: 0 | 1;
  blockId: string;
  span: [number, number];
}

/** Very small statement reader: [tagged subject] [verb] … [tagged object or named writing] in one sentence. */
function triples(v: Vault, b: BlockRecord): Triple[] {
  const out: Triple[] = [];
  const text = b.text;
  const tags = tokenize(text, v.names).filter((t): t is TagToken => t.kind === 'tag' && !t.bare && !t.optOut);
  const resolved = tags
    .map((t) => ({ t, r: v.names.resolve(t.name) }))
    .filter((x) => x.r.status === 'ok')
    .map((x) => ({ from: x.t.from, to: x.t.to, id: (x.r as { id: string }).id }));
  const works = canonMentions(b.id, text).map((m) => ({ from: m.from, to: m.to, id: `work:${m.work}`, label: CANON_WORKS.find((w) => w.id === m.work)?.label ?? m.work }));
  // Sentences.
  const re = /[^.!?;]+[.!?;]?/g;
  for (let m; (m = re.exec(text)); ) {
    const sa = m.index;
    const sb = sa + m[0].length;
    const subj = resolved.find((x) => x.from >= sa && x.to <= sb);
    if (!subj) continue;
    const objects = [...resolved.filter((x) => x.from > subj.to && x.to <= sb && x.id !== subj.id).map((x) => ({ ...x, label: v.entities.get(x.id)?.name ?? x.id })), ...works.filter((x) => x.from > subj.to && x.to <= sb)];
    if (!objects.length) continue;
    const obj = objects.sort((a, b2) => a.from - b2.from)[0];
    const between = text.slice(subj.to, obj.from);
    OPPOSITES.forEach(([yes, no], pi) => {
      const y = yes.exec(between);
      const n = no.exec(between);
      if (!y && !n) return;
      const negated = NEG.test(between);
      let s: 0 | 1 = n ? 1 : 0;
      if (negated && !n) s = 1;
      const hit = n ?? y!;
      const at = subj.to + hit.index;
      out.push({ subject: subj.id, object: obj.id, objectLabel: obj.label, pair: pi, side: s, blockId: b.id, span: [at, at + hit[0].length] });
    });
  }
  return out;
}

// ---------------------------------------------------------------- the finder

export function findContradictions(v: Vault, dismissed: Set<string> = new Set()): Contradiction[] {
  const out: Contradiction[] = [];
  const push = (c: Contradiction) => {
    if (!dismissed.has(c.id) && !out.some((x) => x.id === c.id)) out.push(c);
  };
  const blocks = [...v.blocks.values()].filter((b) => v.meta.get(b.id)?.status !== 'deleted');
  const name = (id: string) => v.entities.get(id)?.name ?? id;

  // Facts: every value of every fact, from the profile and from paragraphs.
  type Val = { text: string; sort?: number; blockId?: string };
  const facts = new Map<string, Map<string, Val[]>>();
  const addVal = (e: string, f: string, val: Val) => {
    let m = facts.get(e);
    if (!m) facts.set(e, (m = new Map()));
    (m.get(f) ?? m.set(f, []).get(f)!).push(val);
  };
  for (const e of v.entities.values()) {
    for (const [k, raw] of Object.entries(e.fields ?? {})) {
      if (raw === null || raw === undefined || raw === '' || Array.isArray(raw)) continue;
      addVal(e.id, k, { text: String(raw).replace(/^@+/, ''), sort: typeof raw === 'number' ? raw : undefined });
    }
  }
  for (const b of blocks) for (const fa of b.fields) addVal(fa.entityId, fa.field, { text: fa.valueText.replace(/^@+/, ''), sort: fa.sort, blockId: b.id });

  for (const [eid, fields] of facts) {
    const e = v.entities.get(eid);
    if (!e) continue;
    const tpl = v.template(e.type);
    for (const [key, vals] of fields) {
      const def = tpl.fields.find((f) => f.key === key);
      if (def?.kind === 'list') continue;
      const norm = (x: Val) => (x.sort !== undefined ? String(Math.floor(x.sort)) : normalizeName(x.text));
      const distinct = [...new Map(vals.map((x) => [norm(x), x])).values()];
      if (distinct.length < 2) continue;
      const [a, b] = distinct;
      push({
        id: `facts|${eid}|${key}|${norm(a)}|${norm(b)}`,
        kind: 'facts',
        title: `${e.name}: ${def?.label ?? key} is ${a.text} and ${b.text}`,
        detail: `${distinct.length} different values for ${def?.label.toLowerCase() ?? key}. Keep the one you trust, or mark the others as reported by their sources.`,
        entityIds: [eid],
        a: side(v, a.blockId ? v.blocks.get(a.blockId) : undefined, `On ${e.name}'s page: ${def?.label ?? key} = ${a.text}`, a.blockId ? spanOf(v.blocks.get(a.blockId)!.text, a.text) : undefined),
        b: side(v, b.blockId ? v.blocks.get(b.blockId) : undefined, `On ${e.name}'s page: ${def?.label ?? key} = ${b.text}`, b.blockId ? spanOf(v.blocks.get(b.blockId)!.text, b.text) : undefined),
      });
    }
  }

  // Dates.
  const range = new Map<string, { start?: Val & { field: string }; end?: Val & { field: string } }>();
  for (const [eid, fields] of facts) {
    const r: { start?: Val & { field: string }; end?: Val & { field: string } } = {};
    for (const [k, vals] of fields) {
      const dated = vals.filter((x) => x.sort !== undefined);
      if (!dated.length) continue;
      if (START_FIELDS.test(k)) {
        const x = dated.reduce((p, c) => (c.sort! < p.sort! ? c : p));
        r.start = { ...x, field: k };
      }
      if (END_FIELDS.test(k)) {
        const x = dated.reduce((p, c) => (c.sort! > p.sort! ? c : p));
        r.end = { ...x, field: k };
      }
    }
    range.set(eid, r);
    if (r.start && r.end && r.end.sort! < r.start.sort!) {
      const e = v.entities.get(eid);
      push({
        id: `dates|order|${eid}`,
        kind: 'dates',
        title: `${e?.name ?? eid}: ${r.end.field} ${year(r.end.sort!)} is before ${r.start.field} ${year(r.start.sort!)}`,
        detail: 'An end date comes before the start date.',
        entityIds: [eid],
        a: side(v, r.start.blockId ? v.blocks.get(r.start.blockId) : undefined, `${r.start.field}: ${r.start.text}`),
        b: side(v, r.end.blockId ? v.blocks.get(r.end.blockId) : undefined, `${r.end.field}: ${r.end.text}`),
      });
    }
  }
  // Something the page did, dated after its end (or long before its start).
  // Years written in the text count too ("wrote a letter in 1300").
  const YEAR_RE = /\b(?:in|by|during|around|about|c\.|circa)\s+(?:the year\s+)?(\d{3,4})\b(?!\s*(?:BC|B\.C\.|BCE))/i;
  for (const b of blocks) {
    if (b.owner.kind === 'library') continue;
    let when = b.eventDate?.sort !== undefined ? { sort: b.eventDate.sort, text: b.eventDate.text } : undefined;
    if (!when) {
      const m = YEAR_RE.exec(b.text);
      if (m) when = { sort: Number(m[1]), text: m[0] };
    }
    if (!when) continue;
    const inline = b.filedTo.filter((f) => f.via === 'inline');
    // Only the first tagged subject acts in the sentence ("@Scouch wrote … in 1320").
    const subject = inline[0];
    if (!subject) continue;
    const r = range.get(subject.entityId);
    if (!r) continue;
    const d = when.sort;
    const deathWords = /\b(died|death|buried|funeral|posthumous|after (his|her|their) death|memorial|remembered|venerated|relics)\b/i;
    if (r.end && d > r.end.sort! + 1 && !deathWords.test(b.text) && !b.fields.some((f) => f.entityId === subject.entityId && (START_FIELDS.test(f.field) || END_FIELDS.test(f.field)))) {
      push({
        id: `dates|after|${b.id}|${subject.entityId}`,
        kind: 'dates',
        title: `${name(subject.entityId)} acts in ${year(d)}, after ${r.end.field} ${year(r.end.sort!)}`,
        detail: 'A dated paragraph about this page falls after its end date.',
        entityIds: [subject.entityId],
        a: side(v, b, '', spanOf(b.text, when.text)),
        b: side(v, r.end.blockId ? v.blocks.get(r.end.blockId) : undefined, `${name(subject.entityId)} — ${r.end.field}: ${r.end.text}`),
      });
    }
    if (r.start && d < r.start.sort! - 1) {
      push({
        id: `dates|before|${b.id}|${subject.entityId}`,
        kind: 'dates',
        title: `${name(subject.entityId)} acts in ${year(d)}, before ${r.start.field} ${year(r.start.sort!)}`,
        detail: 'A dated paragraph about this page falls before its start date.',
        entityIds: [subject.entityId],
        a: side(v, b, '', spanOf(b.text, when.text)),
        b: side(v, r.start.blockId ? v.blocks.get(r.start.blockId) : undefined, `${name(subject.entityId)} — ${r.start.field}: ${r.start.text}`),
      });
    }
  }
  // Parents born after their children; teachers much younger than students.
  const generational: Array<{ field: string; older: 'value' | 'self'; label: string; slack: number }> = [
    { field: 'mother', older: 'value', label: 'mother', slack: 10 },
    { field: 'father', older: 'value', label: 'father', slack: 10 },
    { field: 'parents', older: 'value', label: 'parent', slack: 10 },
    { field: 'children', older: 'self', label: 'child', slack: 10 },
  ];
  for (const b of blocks) {
    for (const fa of b.fields) {
      const g = generational.find((x) => x.field === fa.field);
      if (!g || !fa.entityRef) continue;
      const self = range.get(fa.entityId)?.start;
      const other = range.get(fa.entityRef)?.start;
      if (!self || !other) continue;
      const olderBorn = g.older === 'value' ? other.sort! : self.sort!;
      const youngerBorn = g.older === 'value' ? self.sort! : other.sort!;
      if (olderBorn + g.slack > youngerBorn) {
        const older = g.older === 'value' ? fa.entityRef : fa.entityId;
        const younger = g.older === 'value' ? fa.entityId : fa.entityRef;
        push({
          id: `dates|gen|${older}|${younger}`,
          kind: 'dates',
          title: `${name(older)} (born ${year(olderBorn)}) is a parent of ${name(younger)} (born ${year(youngerBorn)})`,
          detail: `A parent born ${olderBorn > youngerBorn ? 'after' : 'less than ten years before'} the child.`,
          entityIds: [older, younger],
          a: side(v, b, ''),
          b: side(v, (g.older === 'value' ? other : self).blockId ? v.blocks.get((g.older === 'value' ? other : self).blockId!) : undefined, `${name(older)} — born ${year(olderBorn)}`),
        });
      }
    }
  }

  // Relations.
  type Rel = { subject: string; object: string; type: string; blockId: string };
  const rels: Rel[] = [];
  for (const b of blocks) for (const r of b.relations) rels.push({ subject: r.subject, object: r.object, type: r.type, blockId: r.blockId });
  const cat = (t: string) => v.relationTypes.get(t)?.category;
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const byPair = new Map<string, Rel[]>();
  for (const r of rels) (byPair.get(pairKey(r.subject, r.object)) ?? byPair.set(pairKey(r.subject, r.object), []).get(pairKey(r.subject, r.object))!).push(r);
  for (const [pk, list] of byPair) {
    const agree = list.find((r) => cat(r.type) === 'agreement' || cat(r.type) === 'friendship');
    const conflict = list.find((r) => cat(r.type) === 'conflict' && r.type !== 'responds_to');
    if (agree && conflict) {
      push({
        id: `relations|${pk}|${agree.type}|${conflict.type}`,
        kind: 'relations',
        title: `${name(agree.subject)} ${v.relationTypes.get(agree.type)?.label.toLowerCase()} ${name(agree.object)}, and ${name(conflict.subject)} ${v.relationTypes.get(conflict.type)?.label.toLowerCase()} ${name(conflict.object)}`,
        detail: 'Friendly and hostile links between the same two. Fine if things changed over time: add dates to each paragraph so the timeline shows it.',
        entityIds: pk.split('|'),
        a: side(v, v.blocks.get(agree.blockId), ''),
        b: side(v, v.blocks.get(conflict.blockId), ''),
      });
    }
    // Teacher of each other / parent of each other.
    const dir = (r: Rel) => {
      if (r.type === 'teacher_of' || r.type === 'parent_of') return { up: r.subject, down: r.object, kind: r.type };
      if (r.type === 'student_of') return { up: r.object, down: r.subject, kind: 'teacher_of' };
      if (r.type === 'child_of') return { up: r.object, down: r.subject, kind: 'parent_of' };
      return null;
    };
    const dirs = list.map((r) => ({ r, d: dir(r) })).filter((x) => x.d);
    for (const x of dirs)
      for (const y of dirs)
        if (x.d!.kind === y.d!.kind && x.d!.up === y.d!.down && x.d!.down === y.d!.up && x.r.blockId < y.r.blockId) {
          push({
            id: `relations|cycle|${pk}|${x.d!.kind}`,
            kind: 'relations',
            title: `${name(x.d!.up)} and ${name(x.d!.down)} are each other's ${x.d!.kind === 'teacher_of' ? 'teacher' : 'parent'}`,
            detail: 'The link points both ways.',
            entityIds: pk.split('|'),
            a: side(v, v.blocks.get(x.r.blockId), ''),
            b: side(v, v.blocks.get(y.r.blockId), ''),
          });
        }
  }

  // Statements.
  const byKey = new Map<string, Triple[]>();
  for (const b of blocks) {
    if (b.owner.kind === 'library') continue;
    for (const t of triples(v, b)) (byKey.get(`${t.subject}|${t.object}|${t.pair}`) ?? byKey.set(`${t.subject}|${t.object}|${t.pair}`, []).get(`${t.subject}|${t.object}|${t.pair}`)!).push(t);
  }
  for (const [k, list] of byKey) {
    const yes = list.find((t) => t.side === 0);
    const no = list.find((t) => t.side === 1);
    if (!yes || !no || yes.blockId === no.blockId) continue;
    const [pairLabel] = [OPPOSITES[yes.pair][2]];
    push({
      id: `statements|${k}`,
      kind: 'statements',
      title: `${name(yes.subject)} ${pairLabel} ${yes.objectLabel}`,
      detail: 'One paragraph says yes, another says no. If both are reports (what a source claims), say whose view each is.',
      entityIds: [yes.subject, ...(yes.object.startsWith('work:') ? [] : [yes.object])],
      a: side(v, v.blocks.get(yes.blockId), '', [yes.span]),
      b: side(v, v.blocks.get(no.blockId), '', [no.span]),
    });
  }

  // Canon: one author (library work) or one of your pages, two verdicts on one writing.
  const verdicts = new Map<string, Array<{ stance: Stance; blockId: string; span: [number, number] }>>();
  for (const b of blocks) {
    const lib = b.owner.kind === 'library' ? v.library.get(b.owner.id) : undefined;
    const who = lib?.author ?? (b.owner.kind === 'library' ? lib?.title : undefined);
    if (!who) continue;
    const cites = findScriptureRefs(b.text).map((r) => ({ book: r.book, from: r.from, to: r.to }));
    for (const m of canonMentions(b.id, b.text, cites)) {
      if (m.stance !== 'accepted' && m.stance !== 'rejected' && m.stance !== 'disputed') continue;
      const key = `${who}|${m.work}`;
      (verdicts.get(key) ?? verdicts.set(key, []).get(key)!).push({ stance: m.stance, blockId: b.id, span: [m.from, m.to] });
    }
  }
  for (const [key, list] of verdicts) {
    const acc = list.find((x) => x.stance === 'accepted');
    const rej = list.find((x) => x.stance === 'rejected') ?? list.find((x) => x.stance === 'disputed');
    if (!acc || !rej || acc.blockId === rej.blockId) continue;
    const [who, work] = key.split('|');
    const label = CANON_WORKS.find((w) => w.id === work)?.label ?? work;
    push({
      id: `canon|${key}`,
      kind: 'canon',
      title: `${who}: ${label} both received and ${rej.stance}`,
      detail: 'The same author seems to say two things about this writing. Check the wording; they may be reporting what others think.',
      entityIds: [],
      a: side(v, v.blocks.get(acc.blockId), '', [acc.span]),
      b: side(v, v.blocks.get(rej.blockId), '', [rej.span]),
    });
  }

  const order: ContradictionKind[] = ['dates', 'facts', 'relations', 'statements', 'canon'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title));
}
