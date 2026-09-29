// The active scan (spec 7 and 12.1): finds things worth filing that are not filed yet.
// It never changes anything itself. Every result is a suggestion you accept or dismiss.
//
//   mention    a known name or alias written without @          "Scouch" → Apple Scouch
//   ambiguous  a name that fits several pages                     "John" → which John?
//   keyword    an entity's keyword                                "homoousios" → Nicene Christology
//   theme      trigger words from a theme                         canon, received, disputed → Canon of Scripture
//   scripture  a verse from a book that has its own page          Rom 3:23 → Romans
//   major      a thesis, verdict, definition or strong claim      → mark ★ important
//   activity   someone had/gave/preached/wrote a kind of work        → file to their Sermons (Lectures…) section
//   new-name   a capitalised name used again and again            "Tertullian" is not in your project

import { startsWithOrdinal } from './ordinals';
import { normalizeName, tokenize } from './markup';
import type { NameTable } from './names';
import { compileWords, findWords, majorScore, type CompiledTheme } from './triggers';
import { BOOKS } from './scripture';
import type { DocKind } from './types';

export type SuggestionKind = 'mention' | 'ambiguous' | 'keyword' | 'theme' | 'scripture' | 'major' | 'new-name' | 'activity';

export const SUGGESTION_KINDS: Array<{ id: SuggestionKind; label: string; hint: string }> = [
  { id: 'mention', label: 'Names without @', hint: 'A known name or alias written as plain text' },
  { id: 'ambiguous', label: 'Which one?', hint: 'A name that fits more than one page' },
  { id: 'keyword', label: 'Keywords', hint: "Words from a page's keyword list" },
  { id: 'theme', label: 'Trigger words', hint: 'Words from your trigger-word themes' },
  { id: 'scripture', label: 'Scripture books', hint: 'A verse from a book that has its own page' },
  { id: 'major', label: 'Major statements', hint: 'Theses, verdicts, definitions and strong claims' },
  { id: 'new-name', label: 'New names', hint: 'A capitalised name used more than once that has no page' },
  { id: 'activity', label: 'Sermons, books, talks…', hint: 'Someone had, gave, preached or wrote something: file it under that kind on their page' },
];

export type ScanDetectors = Record<SuggestionKind, boolean>;

export const DEFAULT_DETECTORS: ScanDetectors = { mention: true, ambiguous: true, keyword: true, theme: true, scripture: true, major: true, 'new-name': true, activity: true };

export interface ScanBlock {
  id: string;
  text: string;
  owner: { kind: DocKind; id: string };
  /** 'bible' for imported Bibles: no statement or theme scan on the verses themselves. */
  docKind?: 'bible' | 'text' | 'entry' | 'entity';
  filedTo: string[];
  marks: string[];
  scripture: Array<{ book: string; label: string }>;
  heading?: boolean;
}

export interface ScanEntity {
  id: string;
  name: string;
  keywords: string[];
}

export interface Suggestion {
  /** Stable while the paragraph says the same thing: block | kind | target. */
  id: string;
  kind: SuggestionKind;
  blockId: string;
  from: number;
  to: number;
  /** The words that triggered it. */
  match: string;
  /** Pages it would be filed to (several for 'ambiguous'). */
  entityIds: string[];
  /** Theme id for 'theme'. */
  themeId?: string;
  /** Page to create (a theme without a page yet, or a new name). */
  create?: string;
  /** Section of the page to file to ('activity': "Sermons"). */
  section?: string;
  /** How many times it occurs in the paragraph (or document, for new names). */
  count: number;
  /** Every place in the paragraph to highlight. */
  spans: Array<[number, number]>;
  score: number;
  why: string;
}

export interface ScanContext {
  names: NameTable;
  entities: Map<string, ScanEntity>;
  themes: CompiledTheme[];
  detectors: ScanDetectors;
  stop: Set<string>;
  /** Resolve a page name exactly (theme targets, scripture books). */
  findPage(name: string): string | undefined;
}

// Capitalised words that are almost never worth a page of their own.
const COMMON = new Set(
  `the a an and but or nor for so yet if then than when while where which who whom whose what why how this that these those there here it its he she they we you i me him her them us our your his their my
  in on at by to of from with without into onto upon over under after before during since until about above below between among through against within
  not no yes all some any each every many much more most other another such same one two three first second third last next
  mr mrs ms dr st saint sir lady lord god lord's christ jesus spirit holy father son church scripture scriptures gospel gospels apostle apostles bible amen
  monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
  chapter book part section letter epistle homily sermon volume vol ed note notes see cf ibid also however therefore thus hence moreover furthermore indeed perhaps
  old new testament ad bc bce ce`
    .split(/\s+/)
    .filter(Boolean),
);
const BOOK_WORDS = new Set(BOOKS.flatMap((b) => [b.name, ...b.abbr]).map((n) => n.toLowerCase()));

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();

/** Ranges of existing markup (tags, facts, scripture…) that the scan must not touch. */
function markupRanges(text: string, names: NameTable): Array<[number, number]> {
  return tokenize(text, names)
    .filter((t) => t.kind !== 'mark' && t.kind !== 'pin')
    .map((t) => [t.from, t.to] as [number, number]);
}

const inside = (ranges: Array<[number, number]>, from: number, to: number) => ranges.some(([a, b]) => from < b && to > a);

function atSentenceStart(text: string, i: number): boolean {
  const before = text.slice(Math.max(0, i - 4), i);
  return i === 0 || /(^|[.!?:;]["'”’)\]]?\s+|^\s*["“‘(]?)$/.test(before) || /\n\s*$/.test(before);
}

const keywordCache = new WeakMap<ScanContext, Array<[ScanEntity, RegExp]>>();
function keywordPatterns(ctx: ScanContext): Array<[ScanEntity, RegExp]> {
  let list = keywordCache.get(ctx);
  if (!list) {
    list = [];
    for (const e of ctx.entities.values()) {
      const re = e.keywords.length ? compileWords(e.keywords) : null;
      if (re) list.push([e, re]);
    }
    keywordCache.set(ctx, list);
  }
  return list;
}

function key(blockId: string, kind: SuggestionKind, target: string) {
  return `${blockId}|${kind}|${target}`;
}

/** Suggestions for one paragraph. New names need the whole document: see scanDocument. */
export function scanBlock(b: ScanBlock, ctx: ScanContext): Suggestion[] {
  if (!b.text.trim()) return [];
  const out = new Map<string, Suggestion>();
  const ranges = markupRanges(b.text, ctx.names);
  const filed = new Set(b.filedTo);
  if (b.owner.kind === 'entity') filed.add(b.owner.id);
  const add = (s: Omit<Suggestion, 'id' | 'count' | 'spans'> & { target: string; spans?: Array<[number, number]> }) => {
    const id = key(b.id, s.kind, s.target);
    const cur = out.get(id);
    if (cur) {
      cur.count++;
      if (s.to > s.from) cur.spans.push([s.from, s.to]);
      return;
    }
    const { target: _t, spans, ...rest } = s;
    out.set(id, { ...rest, id, count: 1, spans: spans ?? (s.to > s.from ? [[s.from, s.to]] : []) });
  };
  const d = ctx.detectors;
  const text = b.text;

  // Names and aliases written without @.
  if (d.mention || d.ambiguous) {
    WORD_RE.lastIndex = 0;
    for (let m; (m = WORD_RE.exec(text)); ) {
      const i = m.index;
      let match = ctx.names.matchPrefix(text.slice(i));
      // Lower-case text only counts when the name itself is lower-case ("the Vine Doctor" is fine).
      if (match && !/\p{Lu}/u.test(match) && !startsWithOrdinal(match) && /\p{Lu}/u.test(ctx.entities.get((ctx.names.candidates(match)[0] ?? ''))?.name ?? '')) match = null;
      if (!match && !isUpper(text[i])) continue;
      let partial = false;
      if (!match) {
        const word = m[0].replace(/['’]s$/i, '');
        const low = word.toLowerCase();
        if (word.length < 3 || COMMON.has(low) || ctx.stop.has(low)) continue;
        if (ctx.names.resolve(word).status === 'missing') continue;
        match = word;
        partial = true;
      }
      const to = i + match.length;
      if (inside(ranges, i, to)) continue;
      if (ctx.stop.has(normalizeName(match))) continue;
      WORD_RE.lastIndex = Math.max(WORD_RE.lastIndex, to);
      const r = ctx.names.resolve(match);
      if (r.status === 'ok') {
        if (!d.mention || filed.has(r.id)) continue;
        const e = ctx.entities.get(r.id);
        add({
          kind: 'mention',
          target: r.id,
          blockId: b.id,
          from: i,
          to,
          match,
          entityIds: [r.id],
          score: partial ? 0.6 : 0.9,
          why: partial ? `“${match}” is part of the name ${e?.name ?? ''}` : `“${match}” is ${e && normalizeName(e.name) !== normalizeName(match) ? `another name for ${e.name}` : 'a page in your project'}`,
        });
      } else if (r.status === 'ambiguous') {
        if (!d.ambiguous || r.ids.some((id) => filed.has(id))) continue;
        add({ kind: 'ambiguous', target: normalizeName(match), blockId: b.id, from: i, to, match, entityIds: r.ids, score: 0.5, why: `“${match}” could be ${r.ids.length} different pages` });
      }
    }
  }

  // Keywords that belong to one page.
  if (d.keyword) {
    for (const [e, re] of keywordPatterns(ctx)) {
      if (filed.has(e.id)) continue;
      for (const h of findWords(re, text)) {
        if (inside(ranges, h.from, h.to)) continue;
        add({ kind: 'keyword', target: e.id, blockId: b.id, from: h.from, to: h.to, match: h.word, entityIds: [e.id], score: 0.5, why: `“${h.word}” is a keyword of ${e.name}` });
      }
    }
  }

  // Trigger-word themes.
  if (d.theme && b.docKind !== 'bible' && !b.heading) {
    for (const t of ctx.themes) {
      const hits = findWords(t.re, text).filter((h) => !inside(ranges, h.from, h.to));
      const distinct = [...new Set(hits.map((h) => h.word.toLowerCase().replace(/\s+/g, ' ')))];
      if (distinct.length < (t.theme.min ?? 2)) continue;
      const page = t.theme.entity ?? t.theme.label;
      const id = ctx.findPage(page);
      if (id && filed.has(id)) continue;
      const first = hits[0];
      add({
        kind: 'theme',
        target: t.theme.id,
        blockId: b.id,
        from: first.from,
        to: first.to,
        match: distinct.slice(0, 6).join(', '),
        entityIds: id ? [id] : [],
        themeId: t.theme.id,
        create: id ? undefined : page,
        score: Math.min(0.85, 0.3 + distinct.length * 0.12),
        spans: hits.map((h) => [h.from, h.to] as [number, number]),
        why: `${t.theme.label}: ${distinct.slice(0, 5).map((x) => `“${x}”`).join(', ')}${distinct.length > 5 ? '…' : ''}`,
      });
      const s = out.get(key(b.id, 'theme', t.theme.id));
      if (s) s.count = hits.length;
    }
  }

  // A verse from a book that has its own page.
  if (d.scripture && b.docKind !== 'bible') {
    for (const ref of b.scripture) {
      const book = BOOKS.find((x) => x.id === ref.book);
      if (!book) continue;
      const id = ctx.findPage(book.name);
      if (!id || filed.has(id)) continue;
      const at = text.indexOf(ref.label);
      add({ kind: 'scripture', target: id, blockId: b.id, from: Math.max(0, at), to: Math.max(0, at) + ref.label.length, match: ref.label, entityIds: [id], score: 0.7, why: `cites ${ref.label}` });
    }
  }

  // Someone had / gave / preached a sermon, wrote a book, held a debate…: file it to that
  // person's page under a section named for the kind of work, so the list builds itself.
  if (d.activity && !b.heading) {
    const tags = tokenize(text, ctx.names).filter((t) => t.kind === 'tag' && !t.bare && !t.optOut) as Array<{ from: number; to: number; name: string; section?: string }>;
    ACTIVITY_RE.lastIndex = 0;
    for (let m; (m = ACTIVITY_RE.exec(text)); ) {
      if (inside(ranges, m.index, m.index + m[0].length)) continue;
      // The doer is the nearest tag before the verb, in the same sentence.
      const before = tags.filter((t) => t.to <= m!.index && !/[.!?]\s/.test(text.slice(t.to, m!.index)) && m!.index - t.to <= 80);
      const actor = before[before.length - 1];
      if (!actor) continue;
      const r = ctx.names.resolve(actor.name);
      if (r.status !== 'ok') continue;
      const section = sectionName(m[2]);
      if (actor.section && normalizeName(actor.section) === normalizeName(section)) continue;
      const e = ctx.entities.get(r.id);
      add({
        kind: 'activity',
        target: `${r.id}:${normalizeName(section)}`,
        blockId: b.id,
        from: m.index,
        to: m.index + m[0].length,
        match: m[0],
        entityIds: [r.id],
        section,
        score: 0.75,
        why: `${e?.name ?? actor.name}: “${m[0].trim()}” — file this under ${e?.name ?? actor.name}’s ${section}?`,
      });
    }
  }

  // Theses, verdicts and strong claims.
  if (d.major && b.docKind !== 'bible' && !b.heading && !b.marks.includes('key')) {
    const { score, why, spans } = majorScore(text);
    if (score >= 3) add({ kind: 'major', target: 'key', blockId: b.id, from: 0, to: 0, match: '', spans, entityIds: [], score: Math.min(0.9, 0.3 + score * 0.08), why: `Looks like ${why.slice(0, 2).join(' and ')}` });
  }

  return [...out.values()];
}

const WORKS =
  'sermons?|lectures?|debates?|talks?|homil(?:y|ies)|podcasts?|episodes?|videos?|books?|articles?|letters?|epistles?|interviews?|class(?:es)?|courses?|series|speech(?:es)?|presentations?|conferences?|livestreams?|streams?|broadcasts?|stud(?:y|ies)|bible stud(?:y|ies)|commentar(?:y|ies)|treatises?|messages?|teachings?|seminars?|workshops?|essays?|papers?|reviews?|responses?|rebuttals?|hymns?|poems?|songs?|prayers?|creeds?|councils?|synods?|campaigns?|battles?|expeditions?|journeys?|missions?';
const ACTIVITY_RE = new RegExp(
  `\\b(had|gave|give|gives|preached|preaches|delivered|delivers|held|holds|hosted|hosts|led|leads|taught|teaches|wrote|writes|published|publishes|recorded|records|released|releases|presented|presents|did|does|conducted|conducts|spoke at|spoke in|debated in|called|convened|fought|made|composed|issued)\\s+(?:(?:a|an|the|his|her|their|its|another|one|two|three|several|many|some|new|short|long|public|famous|special|first|second|last|final)\\s+){0,3}(${WORKS})\\b`,
  'gi',
);

/** "sermon" → "Sermons", "bible study" → "Bible studies", "series" → "Series". */
export function sectionName(kind: string): string {
  let k = kind.toLowerCase().trim();
  if (!/(s|ies|ches|series)$/.test(k) || k === 'class' || /ss$/.test(k)) {
    if (/(ch|sh|ss|x)$/.test(k)) k += 'es';
    else if (/[^aeiou]y$/.test(k)) k = `${k.slice(0, -1)}ies`;
    else if (k !== 'series') k += 's';
  }
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Capitalised names used again and again in one document that have no page. */
export function scanNewNames(blocks: ScanBlock[], ctx: ScanContext, minCount = 2): Suggestion[] {
  if (!ctx.detectors['new-name']) return [];
  const seen = new Map<string, { name: string; count: number; mid: number; blockId: string; from: number; to: number }>();
  for (const b of blocks) {
    if (b.docKind === 'bible') continue;
    const ranges = markupRanges(b.text, ctx.names);
    const text = b.text;
    // Runs of capitalised words, allowing "of"/"the" inside ("Gregory of Nyssa").
    const RUN = /\p{Lu}[\p{L}'’-]+(?:\s+(?:(?:of|the|de|von|van|da|di)\s+)?\p{Lu}[\p{L}'’-]+){0,3}/gu;
    for (let m; (m = RUN.exec(text)); ) {
      let name = m[0].replace(/['’]s$/i, '');
      let from = m.index;
      const words = name.split(/\s+/);
      // Drop a sentence-opening common word ("The Didache" → "Didache").
      while (words.length && COMMON.has(words[0].toLowerCase())) {
        from += words[0].length + 1;
        words.shift();
      }
      while (words.length && COMMON.has(words[words.length - 1].toLowerCase())) words.pop();
      name = words.join(' ');
      if (name.length < 3 || words.every((x) => COMMON.has(x.toLowerCase()) || /^(of|the|de|von|van|da|di)$/.test(x))) continue;
      if (inside(ranges, from, from + name.length)) continue;
      const low = name.toLowerCase();
      if (ctx.stop.has(low) || BOOK_WORDS.has(low) || /^[IVXLCDM]+$/.test(name)) continue;
      if (ctx.names.resolve(name).status !== 'missing' || ctx.names.candidates(name).length) continue;
      const k = normalizeName(name);
      const cur = seen.get(k) ?? { name, count: 0, mid: 0, blockId: b.id, from, to: from + name.length };
      cur.count++;
      if (!atSentenceStart(text, from)) cur.mid++;
      seen.set(k, cur);
    }
  }
  const out: Suggestion[] = [];
  for (const [k, s] of seen) {
    if (s.count < minCount || s.mid < 1) continue;
    out.push({
      id: key(s.blockId, 'new-name', k),
      kind: 'new-name',
      blockId: s.blockId,
      from: s.from,
      to: s.to,
      match: s.name,
      entityIds: [],
      create: s.name,
      count: s.count,
      spans: [[s.from, s.to]],
      score: Math.min(0.8, 0.3 + s.count * 0.1),
      why: `“${s.name}” appears ${s.count} times and has no page`,
    });
  }
  return out;
}

export function scanDocument(blocks: ScanBlock[], ctx: ScanContext, opts: { newNameMin?: number } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  for (const b of blocks) out.push(...scanBlock(b, ctx));
  out.push(...scanNewNames(blocks, ctx, opts.newNameMin ?? 2));
  return out;
}
