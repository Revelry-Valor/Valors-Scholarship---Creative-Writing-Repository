// Research lookup: read through imported texts (and your writing) for a question,
// e.g. "Which books did the Fathers receive as Scripture?". Results are whole
// paragraphs with the relevant words highlighted, grouped by source, and for the
// canon question a table of book × author with what each author says about it.

import { plainText } from './markup';
import { findScriptureRefs, refCovers, type ScriptureRef } from './scripture';
import { compileWords, findWords, type TriggerTheme } from './triggers';
import type { ScanScope, Vault } from './vault';
import type { BlockRecord, DocKind } from './types';

export interface LookupQuery {
  /** Words and "exact phrases"; stem* matches endings; -word excludes. Verses ("Rom 3", "John 1:1") match by reference. */
  text: string;
  /** Add a theme's trigger words (a theme id), or 'canon' for the canon-of-scripture study. */
  concept?: string;
  scope?: ScanScope;
  /** Every term must appear (default: any term). */
  matchAll?: boolean;
  limit?: number;
}

export interface LookupHit {
  blockId: string;
  text: string;
  spans: Array<[number, number]>;
  terms: string[];
  score: number;
  source: { kind: DocKind; id: string; title: string; author?: string; collection?: string; project?: string };
  /** The paragraphs just before and after, for context. */
  before?: string;
  after?: string;
}

export interface LookupResult {
  hits: LookupHit[];
  total: number;
  terms: string[];
  canon?: CanonTable;
}

// ---------------------------------------------------------------- query terms

interface Term {
  label: string;
  re: RegExp;
}

export function parseTerms(text: string): { include: string[]; exclude: string[]; refs: ScriptureRef[] } {
  const refs = findScriptureRefs(text);
  let rest = text;
  for (const r of [...refs].reverse()) rest = rest.slice(0, r.from) + ' ' + rest.slice(r.to);
  const include: string[] = [];
  const exclude: string[] = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  for (let m; (m = re.exec(rest)); ) {
    const neg = m[1] || m[3];
    const t = (m[2] ?? m[4]).trim().toLowerCase().replace(/^[,;.]+|[,;.]+$/g, '');
    if (!t || /^(or|and)$/i.test(t)) continue;
    (neg ? exclude : include).push(t);
  }
  return { include, exclude, refs };
}

function termRegexes(words: string[]): Term[] {
  return words.map((w) => ({ label: w, re: compileWords([w])! })).filter((t) => t.re);
}

// ---------------------------------------------------------------- canon study

export type Stance = 'accepted' | 'disputed' | 'read' | 'rejected' | 'cited' | 'mentioned';

export const STANCES: Array<{ id: Stance; label: string; mark: string }> = [
  { id: 'accepted', label: 'Received as Scripture', mark: '✓' },
  { id: 'disputed', label: 'Disputed or doubted', mark: '?' },
  { id: 'read', label: 'Read, but not in the canon', mark: '◐' },
  { id: 'rejected', label: 'Rejected or spurious', mark: '✗' },
  { id: 'cited', label: 'Quoted or cited', mark: '“' },
  { id: 'mentioned', label: 'Mentioned', mark: '·' },
];

interface CanonWork {
  id: string;
  label: string;
  group: 'Law and history' | 'Wisdom and poetry' | 'Prophets' | 'Gospels and Acts' | 'Paul' | 'Catholic letters and Revelation' | 'Deuterocanon' | 'Other early writings';
  /** Book ids from the scripture table, so citations count too. */
  books?: string[];
  alts: string[];
}

// "!Word" = case-sensitive single name; "re:…" = a regular expression; other entries are case-insensitive phrases.
const W = (id: string, label: string, group: CanonWork['group'], alts: string, books?: string[]): CanonWork => ({ id, label, group, alts: alts.split('|').map((a) => a.trim()).filter(Boolean), books });

export const CANON_WORKS: CanonWork[] = [
  W('pentateuch', 'Law of Moses (Pentateuch)', 'Law and history', 'pentateuch|five books of moses|books of moses|the law of moses'),
  W('Gen', 'Genesis', 'Law and history', '!Genesis', ['Gen']),
  W('Exod', 'Exodus', 'Law and history', '!Exodus', ['Exod']),
  W('Lev', 'Leviticus', 'Law and history', '!Leviticus', ['Lev']),
  W('Num', 'Numbers', 'Law and history', 'book of numbers', ['Num']),
  W('Deut', 'Deuteronomy', 'Law and history', '!Deuteronomy', ['Deut']),
  W('Josh', 'Joshua', 'Law and history', 'book of joshua|!Joshua', ['Josh']),
  W('Judg', 'Judges', 'Law and history', 'book of judges|!Judges', ['Judg']),
  W('Ruth', 'Ruth', 'Law and history', 'book of ruth|!Ruth', ['Ruth']),
  W('Sam', '1–2 Samuel (1–2 Kingdoms)', 'Law and history', 'books of samuel|!Samuel|first and second kingdoms|books of kingdoms', ['1Sam', '2Sam']),
  W('Kgs', '1–2 Kings (3–4 Kingdoms)', 'Law and history', 'books of kings|third and fourth kingdoms', ['1Kgs', '2Kgs']),
  W('Chr', '1–2 Chronicles (Paralipomena)', 'Law and history', '!Chronicles|paralipomena|paralipomenon', ['1Chr', '2Chr']),
  W('Ezra', 'Ezra and Nehemiah (Esdras)', 'Law and history', '!Ezra|!Nehemiah|!Esdras', ['Ezra', 'Neh']),
  W('Esth', 'Esther', 'Law and history', '!Esther', ['Esth']),
  W('Job', 'Job', 'Wisdom and poetry', 'book of job|!Job', ['Job']),
  W('Ps', 'Psalms', 'Wisdom and poetry', '!Psalms|!Psalter|book of psalms', ['Ps']),
  W('Prov', 'Proverbs', 'Wisdom and poetry', '!Proverbs', ['Prov']),
  W('Eccl', 'Ecclesiastes', 'Wisdom and poetry', '!Ecclesiastes|!Qoheleth', ['Eccl']),
  W('Song', 'Song of Songs', 'Wisdom and poetry', 'song of songs|song of solomon|!Canticles|canticle of canticles', ['Song']),
  W('Isa', 'Isaiah', 'Prophets', '!Isaiah|!Esaias', ['Isa']),
  W('Jer', 'Jeremiah (with Lamentations)', 'Prophets', '!Jeremiah|!Jeremias|!Lamentations', ['Jer', 'Lam']),
  W('Ezek', 'Ezekiel', 'Prophets', '!Ezekiel', ['Ezek']),
  W('Dan', 'Daniel', 'Prophets', 'book of daniel|!Daniel', ['Dan']),
  W('twelve', 'The Twelve (minor prophets)', 'Prophets', 'twelve prophets|minor prophets|book of the twelve|the twelve prophets', ['Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal']),
  W('Matt', 'Matthew', 'Gospels and Acts', "gospel of matthew|gospel according to matthew|matthew's gospel|!Matthew", ['Matt']),
  W('Mark', 'Mark', 'Gospels and Acts', "gospel of mark|gospel according to mark|mark's gospel|re:(?<=matthew,?\\s+(?:and\\s+)?)mark", ['Mark']),
  W('Luke', 'Luke', 'Gospels and Acts', "gospel of luke|gospel according to luke|luke's gospel|!Luke", ['Luke']),
  W('John', 'John (Gospel)', 'Gospels and Acts', "gospel of john|gospel according to john|john's gospel|fourth gospel|fourth of the gospels is that of john|re:(?<=luke,?\\s+(?:and\\s+)?)john", ['John']),
  W('gospels', 'The four Gospels', 'Gospels and Acts', 'four gospels|fourfold gospel|the gospels|quaternion of the gospels'),
  W('Acts', 'Acts', 'Gospels and Acts', 'acts of the apostles|!Acts', ['Acts']),
  W('pauline', "Paul's letters", 'Paul', "epistles of paul|paul's epistles|letters of paul|pauline epistles|fourteen epistles|thirteen epistles|epistles of the apostle"),
  W('Rom', 'Romans', 'Paul', 'epistle to the romans|!Romans', ['Rom']),
  W('Cor', '1–2 Corinthians', 'Paul', 'epistles? to the corinthians|!Corinthians', ['1Cor', '2Cor']),
  W('Gal', 'Galatians', 'Paul', '!Galatians', ['Gal']),
  W('Eph', 'Ephesians', 'Paul', '!Ephesians', ['Eph']),
  W('Phil', 'Philippians', 'Paul', '!Philippians', ['Phil']),
  W('Col', 'Colossians', 'Paul', '!Colossians', ['Col']),
  W('Thess', '1–2 Thessalonians', 'Paul', '!Thessalonians', ['1Thess', '2Thess']),
  W('Tim', '1–2 Timothy', 'Paul', 'epistles? to timothy|letters? to timothy', ['1Tim', '2Tim']),
  W('Titus', 'Titus', 'Paul', 'epistle to titus|letter to titus', ['Titus']),
  W('Phlm', 'Philemon', 'Paul', '!Philemon', ['Phlm']),
  W('Heb', 'Hebrews', 'Catholic letters and Revelation', 'epistle to the hebrews|letter to the hebrews|!Hebrews', ['Heb']),
  W('Jas', 'James', 'Catholic letters and Revelation', 'epistle of james|epistle called james|letter of james|that of james|!James', ['Jas']),
  W('1Pet', '1 Peter', 'Catholic letters and Revelation', 'first epistle of peter|first of peter|former epistle of peter|epistle of peter|1 peter|i peter', ['1Pet']),
  W('2Pet', '2 Peter', 'Catholic letters and Revelation', 'second epistle of peter|second of peter|2 peter|ii peter', ['2Pet']),
  W('1John', '1 John', 'Catholic letters and Revelation', 'first epistle of john|former epistle of john|epistle of john|1 john|i john', ['1John']),
  W('23John', '2–3 John', 'Catholic letters and Revelation', 'second and third (epistles )?of john|second and third epistles|2 john|3 john|ii john|iii john', ['2John', '3John']),
  W('Jude', 'Jude', 'Catholic letters and Revelation', 'epistle of jude|that of jude|!Jude', ['Jude']),
  W('Rev', 'Revelation (Apocalypse of John)', 'Catholic letters and Revelation', 'apocalypses? of john|revelation of john|!Revelation|!Apocalypse', ['Rev']),
  W('Wis', 'Wisdom of Solomon', 'Deuterocanon', 'wisdom of solomon|book of wisdom', ['Wis']),
  W('Sir', 'Sirach (Ecclesiasticus)', 'Deuterocanon', '!Sirach|!Ecclesiasticus|wisdom of (jesus )?(the son of )?sirach|ben sira', ['Sir']),
  W('Tob', 'Tobit', 'Deuterocanon', '!Tobit|!Tobias', ['Tob']),
  W('Jdt', 'Judith', 'Deuterocanon', '!Judith', ['Jdt']),
  W('Macc', 'Maccabees', 'Deuterocanon', '!Maccabees', ['1Macc', '2Macc']),
  W('Bar', 'Baruch', 'Deuterocanon', '!Baruch', ['Bar']),
  W('Hermas', 'Shepherd of Hermas', 'Other early writings', 'shepherd of hermas|!Shepherd|!Hermas'),
  W('Didache', 'Didache', 'Other early writings', '!Didache|teaching of the (twelve )?apostles|so-called teachings of the apostles'),
  W('Barn', 'Epistle of Barnabas', 'Other early writings', 'epistle of barnabas|epistle ascribed to barnabas|!Barnabas'),
  W('1Clem', '1 Clement', 'Other early writings', "epistle of clement|clement's epistle|letter of clement|1 clement"),
  W('ApocPet', 'Apocalypse of Peter', 'Other early writings', 'apocalypse of peter|revelation of peter|re:(?<=apocalypses of john and )peter'),
  W('GosPet', 'Gospel of Peter', 'Other early writings', 'gospel of peter|gospel according to peter'),
  W('GosThom', 'Gospel of Thomas', 'Other early writings', 'gospel of thomas|gospel according to thomas'),
  W('GosHeb', 'Gospel of the Hebrews', 'Other early writings', 'gospel of the hebrews|gospel according to the hebrews'),
  W('ActsPaul', 'Acts of Paul', 'Other early writings', 'acts of paul'),
  W('Enoch', 'Enoch', 'Other early writings', 'book of enoch|!Enoch'),
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORK_PATTERNS = CANON_WORKS.map((w) => {
  const ci: string[] = [];
  const cs: string[] = [];
  for (const a of w.alts) {
    if (a.startsWith('re:')) ci.push(a.slice(3));
    else if (a.startsWith('!')) cs.push(escape(a.slice(1)));
    else ci.push(a.replace(/\s+/g, '\\s+').replace(/'/g, "['’]"));
  }
  return {
    work: w,
    ci: ci.length ? new RegExp(`(?<![\\p{L}])(?:${ci.join('|')})(?![\\p{L}])`, 'giu') : null,
    cs: cs.length ? new RegExp(`(?<![\\p{L}])(?:${cs.join('|')})(?![\\p{L}])`, 'gu') : null,
  };
});

interface Cue {
  re: RegExp;
  stance: Exclude<Stance, 'cited' | 'mentioned'>;
}
// Order matters only for ties; the nearest cue to the book name wins.
const CUES: Cue[] = [
  { re: /\b(some (of us )?(are )?not willing|not (received|accepted|acknowledged|admitted) by all|(received|recognized|recognised|accepted|acknowledged) by (some|many)|some (reject|doubt|question|do not (receive|accept|admit))|doubted|doubtful|disputed|contested|questioned|antilegomena|not universally|by some it is|still in dispute|in doubt)\b/gi, stance: 'disputed' },
  { re: /\b(to be read|for reading|read (by|for) (instruction|edification|those)|useful (to|for) read\w*|ecclesiastical books|appointed by the fathers)\b/gi, stance: 'read' },
  { re: /\b(spurious|rejected?|rejects|not (indeed )?(received|accepted|admitted|reckoned|counted|numbered|canonical|scripture|included in the canon)|besides these|uncanonical|non-canonical|apocryph\w*|heretic\w*|forg(ed|ery)|falsely ascribed|fictitious|notha|excluded|outside the canon|cast out|not to be read)\b/gi, stance: 'rejected' },
  { re: /\b(we receive|are counted|counted in|books of the (new|old) testament|fountains of salvation|let no (man|one) add|in these alone|doctrine of godliness|received|accepted|acknowledged|canonical|in the canon|homologoumena|divine scriptures?|holy scriptures?|sacred scriptures?|inspired|scriptures?|read (publicly )?in the churches|recognized|recognised|undisputed|genuine|authentic|the word of god|numbered among)\b/gi, stance: 'accepted' },
];

export interface CanonMention {
  work: string;
  blockId: string;
  from: number;
  to: number;
  stance: Stance;
  /** The words that decided the stance. */
  cue?: [number, number];
}

function sentenceBounds(text: string, at: number): [number, number] {
  let a = at;
  while (a > 0 && !/[.!?;]/.test(text[a - 1])) a--;
  let b = at;
  while (b < text.length && !/[.!?;]/.test(text[b])) b++;
  return [a, b];
}

/** Which early writings a paragraph names, and what it says about each. */
export function canonMentions(blockId: string, text: string, citations: Array<{ book: string; from: number; to: number }> = []): CanonMention[] {
  const found: Array<{ work: CanonWork; from: number; to: number }> = [];
  for (const p of WORK_PATTERNS) {
    for (const re of [p.ci, p.cs]) {
      if (!re) continue;
      re.lastIndex = 0;
      for (let m; (m = re.exec(text)); ) found.push({ work: p.work, from: m.index, to: m.index + m[0].length });
    }
  }
  // Longest match wins where names overlap ("Apocalypse of Peter" over "Apocalypse").
  found.sort((a, b) => b.to - b.from - (a.to - a.from));
  const kept: typeof found = [];
  for (const f of found) if (!kept.some((k) => f.from < k.to && f.to > k.from)) kept.push(f);
  // Citations ("Heb 11:1") count as use of the book.
  const cited = new Set<string>();
  for (const c of citations) {
    const w = CANON_WORKS.find((x) => x.books?.includes(c.book));
    if (w && !kept.some((k) => k.from <= c.from && k.to >= c.to)) {
      cited.add(w.id);
      kept.push({ work: w, from: c.from, to: c.to });
    }
  }
  const out: CanonMention[] = [];
  for (const k of kept.sort((a, b) => a.from - b.from)) {
    const isCitation = citations.some((c) => c.from === k.from);
    let [sa, sb] = sentenceBounds(text, k.from);
    // No verdict in the sentence: a list is often summed up in the next one
    // ("These then belong among the accepted writings").
    const hasCue = () => CUES.some((c) => ((c.re.lastIndex = 0), c.re.test(text.slice(sa, sb))));
    for (let step = 0; step < 4 && !hasCue() && sb < text.length - 1; step++) sb = sentenceBounds(text, sb + 1)[1];
    for (let step = 0; step < 6 && !hasCue() && sa > 1; step++) sa = sentenceBounds(text, sa - 2)[0];
    const sentence = text.slice(sa, sb);
    const cues: Array<{ stance: Cue['stance']; from: number; to: number }> = [];
    for (const c of CUES) {
      c.re.lastIndex = 0;
      for (let m; (m = c.re.exec(sentence)); ) {
        const from = sa + m.index;
        const to = from + m[0].length;
        if (from < k.to && to > k.from) continue;
        cues.push({ stance: c.stance, from, to });
      }
    }
    // "not included in the canon" contains "in the canon": the longer phrase decides.
    const live = cues.filter((c) => !cues.some((o) => o !== c && o.from <= c.from && o.to >= c.to && o.to - o.from > c.to - c.from));
    let best: { stance: Cue['stance']; d: number; span: [number, number] } | null = null;
    for (const c of live) {
      const d = c.from >= k.to ? c.from - k.to : k.from - c.to;
      if (!best || d < best.d || (d === best.d && c.stance !== 'accepted')) best = { stance: c.stance, d, span: [c.from, c.to] };
    }
    out.push({ work: k.work.id, blockId, from: k.from, to: k.to, stance: best ? best.stance : isCitation || cited.has(k.work.id) ? 'cited' : 'mentioned', cue: best?.span });
  }
  return out;
}

export interface CanonTable {
  works: Array<{ id: string; label: string; group: string }>;
  columns: Array<{ key: string; label: string }>;
  /** cells[workId][columnKey] */
  cells: Record<string, Record<string, { stances: Partial<Record<Stance, number>>; blockIds: string[] }>>;
}

const RANK: Record<Stance, number> = { rejected: 5, disputed: 4, read: 3, accepted: 2, cited: 1, mentioned: 0 };
/** The strongest thing a column says about a work. */
export function cellStance(c: { stances: Partial<Record<Stance, number>> }): Stance {
  return (Object.keys(c.stances) as Stance[]).sort((a, b) => (c.stances[b]! - c.stances[a]!) || RANK[b] - RANK[a])[0] ?? 'mentioned';
}

// ---------------------------------------------------------------- lookup

function inScope(v: Vault, rel: string, scope: ScanScope): boolean {
  const st = v.files.get(rel);
  if (!st) return false;
  if (scope.all) return true;
  if (scope.doc) return st.kind === scope.doc.kind && st.ownerId === scope.doc.id;
  if (scope.ids) return st.kind === 'library' && scope.ids.includes(st.ownerId);
  if (scope.collection !== undefined) return st.kind === 'library' && v.library.get(st.ownerId)?.collection === scope.collection;
  if (scope.library && st.kind === 'library') return true;
  if (scope.writing && st.kind !== 'library') return true;
  return false;
}

function conceptWords(themes: TriggerTheme[], concept?: string): string[] {
  if (!concept) return [];
  if (concept === 'canon') {
    const canon = themes.find((t) => t.id === 'canon')?.words ?? [];
    return [...canon, 'scripture*', 'received', 'disputed', 'spurious', 'rejected', 'acknowledged', 'epistle*', 'gospel*'];
  }
  return themes.find((t) => t.id === concept)?.words ?? [];
}

export function lookup(v: Vault, q: LookupQuery, project?: string): LookupResult {
  const scope = q.scope ?? { library: true };
  const { include, exclude, refs } = parseTerms(q.text);
  const concept = conceptWords(v.themes, q.concept);
  const terms = termRegexes([...include, ...concept]);
  const conceptSet = new Set(concept);
  const userTerms = terms.filter((t) => !conceptSet.has(t.label));
  const excl = exclude.length ? compileWords(exclude) : null;
  const canonMode = q.concept === 'canon';
  const hits: LookupHit[] = [];
  const mentions: CanonMention[] = [];
  const colOf = new Map<string, { key: string; label: string }>();

  for (const [rel, st] of v.files) {
    if (!inScope(v, rel, scope)) continue;
    const lib = st.kind === 'library' ? v.library.get(st.ownerId) : undefined;
    const ids = st.blocks.map((b) => b.id).filter((x): x is string => !!x);
    ids.forEach((id, i) => {
      const b = v.blocks.get(id);
      if (!b || b.kind === 'heading' || !b.text.trim()) return;
      const text = b.text;
      if (excl && findWords(excl, text).length) return;
      const spans: Array<[number, number]> = [];
      const matched = new Set<string>();
      let count = 0;
      for (const t of terms) {
        const hs = findWords(t.re, text);
        if (!hs.length) continue;
        matched.add(t.label);
        count += hs.length;
        for (const h of hs) spans.push([h.from, h.to]);
      }
      let refHit = false;
      for (const r of refs) {
        for (const s of b.scripture) {
          if (s.book === r.book && (refCovers(r, s.book, s.chapter, s.verseStart) || refCovers(s, r.book, r.chapter, r.verseStart))) {
            refHit = true;
            const at = text.indexOf(s.label);
            if (at >= 0) spans.push([at, at + s.label.length]);
          }
        }
        // A Bible verse is itself the passage.
        const verse = /^\[([^\]]+)\]/.exec(text);
        if (verse && lib?.kind === 'bible') {
          const own = findScriptureRefs(verse[1])[0];
          if (own && refCovers(r, own.book, own.chapter, own.verseStart)) refHit = true;
        }
      }
      if (!matched.size && !refHit) return;
      if (q.matchAll && (userTerms.some((t) => !matched.has(t.label)) || (refs.length && !refHit))) return;
      if (userTerms.length && concept.length && !userTerms.some((t) => matched.has(t.label)) && !refHit) return;

      let canonHere: CanonMention[] = [];
      if (canonMode) {
        const cites = findScriptureRefs(text).map((r) => ({ book: r.book, from: r.from, to: r.to }));
        canonHere = canonMentions(id, text, cites);
        // The canon study wants paragraphs that name a writing and say something about it.
        if (!canonHere.some((m) => m.stance !== 'mentioned' && m.stance !== 'cited') && matched.size < 3) return;
        for (const m of canonHere) {
          spans.push([m.from, m.to]);
          if (m.cue) spans.push(m.cue);
        }
      }

      const title = v.sourceTitle(b);
      const pageAuthor = lib?.page ? v.entities.get(lib.page)?.fields.author : undefined;
      const author = lib?.author ?? (typeof pageAuthor === 'string' ? pageAuthor.replace(/^@+\[?|\]$/g, '') : undefined);
      const colKey = `${project ?? ''}|${author ?? title}`;
      if (canonMode && canonHere.length) {
        if (!colOf.has(colKey)) colOf.set(colKey, { key: colKey, label: `${author ?? title}${project ? ` (${project})` : ''}` });
        for (const m of canonHere) mentions.push({ ...m, blockId: `${colKey}\u0000${m.blockId}` });
      }
      const merged = mergeSpans(spans);
      hits.push({
        blockId: id,
        text,
        spans: merged,
        terms: [...matched],
        score: matched.size * 2 + Math.min(count, 10) * 0.2 + (refHit ? 3 : 0) + (canonHere.length ? 2 : 0),
        source: { kind: b.owner.kind, id: b.owner.id, title, author, collection: lib?.collection, project },
        before: i > 0 ? v.blocks.get(ids[i - 1])?.text : undefined,
        after: i < ids.length - 1 ? v.blocks.get(ids[i + 1])?.text : undefined,
      });
    });
  }

  const total = hits.length;
  const limit = q.limit ?? 400;
  // Best paragraphs first, but keep a source's paragraphs in reading order.
  const bestBySource = new Map<string, number>();
  for (const h of hits) {
    const k = `${h.source.project ?? ''}|${h.source.kind}:${h.source.id}`;
    bestBySource.set(k, Math.max(bestBySource.get(k) ?? 0, h.score));
  }
  const order = (h: LookupHit) => `${h.source.project ?? ''}|${h.source.kind}:${h.source.id}`;
  const pos = (h: LookupHit) => (h.source.project ? 0 : v.blocks.get(h.blockId)?.position ?? 0);
  const ranked = [...hits].sort((a, b) => b.score - a.score).slice(0, limit);
  ranked.sort((a, b) => bestBySource.get(order(b))! - bestBySource.get(order(a))! || order(a).localeCompare(order(b)) || pos(a) - pos(b));

  const result: LookupResult = { hits: ranked, total, terms: terms.map((t) => t.label) };
  if (canonMode) result.canon = buildCanonTable(mentions, [...colOf.values()]);
  return result;
}

function buildCanonTable(mentions: CanonMention[], columns: Array<{ key: string; label: string }>): CanonTable {
  const cells: CanonTable['cells'] = {};
  for (const m of mentions) {
    const [colKey, blockId] = m.blockId.split('\u0000');
    const row = (cells[m.work] ??= {});
    const cell = (row[colKey] ??= { stances: {}, blockIds: [] });
    cell.stances[m.stance] = (cell.stances[m.stance] ?? 0) + 1;
    if (!cell.blockIds.includes(blockId)) cell.blockIds.push(blockId);
  }
  const works = CANON_WORKS.filter((w) => cells[w.id]).map((w) => ({ id: w.id, label: w.label, group: w.group }));
  return { works, columns: columns.sort((a, b) => a.label.localeCompare(b.label)), cells };
}

function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** A quotation paragraph, with its source, for pasting into your writing. */
export function quoteFor(v: Vault, blockId: string): string {
  const b: BlockRecord = v.getBlock(blockId);
  let text = plainText(b.text, v.names).replace(/\s+/g, ' ').trim();
  const verse = /^\[([^\]]+)\]\s*/.exec(text);
  let cite = v.sourceTitle(b);
  if (verse) {
    text = text.slice(verse[0].length);
    const lib = v.library.get(b.owner.id);
    const ref = findScriptureRefs(verse[1])[0];
    cite = `${ref?.label ?? verse[1]}${lib?.translation ? ` (${lib.translation})` : ''}`;
  } else if (b.owner.kind === 'library') {
    const lib = v.library.get(b.owner.id);
    if (lib?.author) cite = `${lib.author}, *${lib.title}*`;
    else cite = `*${cite}*`;
  }
  return `> “${text}” — ${cite}`;
}
