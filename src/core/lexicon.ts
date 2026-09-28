// Lexicons (spec 6.4): Greek, Hebrew or any other word lists you import, looked up
// while you write. Files can be large (a full Greek lexicon has ~10,000 entries with
// long definitions); they are stored as plain TSV in lexicons/ and indexed on first use.
//
// Accepted formats, detected automatically:
//   TSV / CSV with a header row (lemma, Greek, Hebrew, word, Strong's, translit, gloss, definition…)
//   TSV / CSV without a header (columns guessed from their contents)
//   STEPBible-style tables (TBESG / TBESH: Strong's, lemma, transliteration, gloss, meaning)
//   JSON: an array of entries, or an object keyed by Strong's number or headword
//   plain lines: "λόγος — word, speech" · "logos: word" · "G3056 = word"

export interface LexEntry {
  lemma: string;
  strong?: string;
  translit?: string;
  gloss?: string;
  def?: string;
  morph?: string;
}

export interface LexiconMeta {
  id: string;
  name: string;
  language: 'greek' | 'hebrew' | 'latin' | 'other';
  count: number;
  file: string;
}

// ---------------------------------------------------------------- normalising

const GREEK = /[Ͱ-Ͽἀ-῿]/;
const HEBREW = /[֐-׿]/;

/** Accent-, breathing-, vowel-point- and case-insensitive key. */
export function lexKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[֑-ׇ]/g, '') // Hebrew points and accents
    .replace(/\p{M}/gu, '') // Greek accents, breathings, Latin diacritics
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[’'ʼ·.,;:!?()[\]{}"“”«»]/g, '')
    .trim();
}

export function normalizeStrong(s: string): string | undefined {
  const m = /^\s*([GH])\s*0*(\d{1,5})([a-z]?)\b/i.exec(s);
  return m ? `${m[1].toUpperCase()}${m[2]}${m[3] ?? ''}` : undefined;
}

export function languageOf(entries: LexEntry[]): LexiconMeta['language'] {
  let g = 0;
  let h = 0;
  for (const e of entries.slice(0, 500)) {
    if (GREEK.test(e.lemma)) g++;
    else if (HEBREW.test(e.lemma)) h++;
  }
  if (!g && !h) return entries.some((e) => /^[a-z]+$/i.test(e.lemma)) ? 'latin' : 'other';
  return g >= h ? 'greek' : 'hebrew';
}

/** Words in a text that a lexicon could explain: Greek or Hebrew words, and Strong's numbers. */
export function lexicalWords(text: string): Array<{ word: string; from: number; to: number }> {
  const out: Array<{ word: string; from: number; to: number }> = [];
  const re = /[Ͱ-Ͽἀ-῿֐-׿][Ͱ-Ͽἀ-῿֐-׿̀-ͯ'’ʼ]*|\b[GH]\d{1,5}\b/g;
  for (let m; (m = re.exec(text)); ) out.push({ word: m[0], from: m.index, to: m.index + m[0].length });
  return out;
}

// ---------------------------------------------------------------- parsing

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Role = keyof LexEntry | 'skip';

function roleFromHeader(h: string): Role {
  const x = h.toLowerCase().replace(/[^a-z]/g, '');
  if (/kjv/.test(x)) return 'gloss';
  if (/def|meaning|description|derivation|explanation/.test(x)) return 'def';
  if (/^(e|d|u)?strongs?(number|no|num)?$|^strong|^snum|^number$|^id$/.test(x)) return 'strong';
  if (/translit|xlit|roman|pronun|transcription/.test(x)) return 'translit';
  if (/morph|parsing|pos$|partofspeech|grammar/.test(x)) return 'morph';
  if (/^gloss|short|brief|kjv|english$/.test(x)) return 'gloss';
  if (/def|meaning|description|sense|usage|derivation|explanation|entry$|text$/.test(x)) return 'def';
  if (/lemma|greek|hebrew|aramaic|word|headword|lexeme|original|unicode|term/.test(x)) return 'lemma';
  return 'skip';
}

function splitRow(line: string, sep: string): string[] {
  if (sep !== ',') return line.split(sep);
  const cells: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === ',' && !q) {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

function fromTable(lines: string[], sep: string): LexEntry[] | null {
  // STEPBible files start with pages of notes; the table starts at the first row with a Strong's number.
  let start = 0;
  let header: string[] | null = null;
  for (let i = 0; i < Math.min(lines.length, 400); i++) {
    const cells = splitRow(lines[i], sep);
    if (cells.length < 2) continue;
    const roles = cells.map(roleFromHeader);
    if (roles.includes('lemma') && roles.filter((r) => r !== 'skip').length >= 2 && !cells.some((c) => GREEK.test(c) || HEBREW.test(c))) {
      header = cells;
      start = i + 1;
      break;
    }
    if (cells.some((c) => normalizeStrong(c)) && cells.some((c) => GREEK.test(c) || HEBREW.test(c))) {
      start = i;
      break;
    }
  }
  const rows = lines.slice(start).map((l) => splitRow(l, sep)).filter((r) => r.length >= 2);
  if (rows.length < 3) return null;
  let roles: Role[];
  if (header) roles = header.map(roleFromHeader);
  else {
    // Guess from the contents of the first rows.
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const sample = rows.slice(0, 200);
    const score = (i: number, test: (s: string) => boolean) => sample.filter((r) => r[i] && test(r[i])).length;
    const avgLen = (i: number) => sample.reduce((n, r) => n + (r[i]?.length ?? 0), 0) / sample.length;
    roles = new Array(width).fill('skip');
    const cols = [...Array(width).keys()];
    const strongCol = cols.find((i) => score(i, (s) => !!normalizeStrong(s)) > sample.length * 0.6);
    if (strongCol !== undefined) roles[strongCol] = 'strong';
    const lemmaCol = cols.filter((i) => roles[i] === 'skip').sort((a, b) => score(b, (s) => GREEK.test(s) || HEBREW.test(s)) - score(a, (s) => GREEK.test(s) || HEBREW.test(s)))[0];
    if (lemmaCol !== undefined && score(lemmaCol, (s) => GREEK.test(s) || HEBREW.test(s)) > sample.length * 0.5) roles[lemmaCol] = 'lemma';
    else if (lemmaCol !== undefined) roles[cols.find((i) => roles[i] === 'skip') ?? 0] = 'lemma';
    const rest = cols.filter((i) => roles[i] === 'skip').sort((a, b) => avgLen(b) - avgLen(a));
    if (rest[0] !== undefined) roles[rest[0]] = 'def';
    const shortLatin = rest.slice(1).filter((i) => score(i, (s) => /^[\p{Script=Latin}\s'’.-]+$/u.test(s)) > sample.length * 0.6);
    // The Latin column right after the headword is usually the transliteration, the next one the gloss.
    const lemmaAt = roles.indexOf('lemma');
    shortLatin.sort((a, b) => (a > lemmaAt ? a : a + 1000) - (b > lemmaAt ? b : b + 1000));
    if (shortLatin[0] !== undefined) roles[shortLatin[0]] = 'translit';
    if (shortLatin[1] !== undefined) roles[shortLatin[1]] = 'gloss';
  }
  if (!roles.includes('lemma')) return null;
  const out: LexEntry[] = [];
  for (const r of rows) {
    const e: LexEntry = { lemma: '' };
    roles.forEach((role, i) => {
      const v = clean(r[i]);
      if (!v || role === 'skip') return;
      if (role === 'strong') e.strong = normalizeStrong(v) ?? v;
      else if (role === 'def' && e.def) e.def += ` ${v}`;
      else if (!e[role as keyof LexEntry]) (e as unknown as Record<string, string>)[role] = v;
    });
    // STEPBible lemmas look like "λόγος, -ου, ὁ": keep the headword, move the rest to the gloss line.
    const head = /^([^,;]+)[,;]\s*(.+)$/.exec(e.lemma);
    if (head && (GREEK.test(head[1]) || HEBREW.test(head[1]))) {
      e.lemma = head[1].trim();
      e.morph = e.morph ? `${head[2]} · ${e.morph}` : head[2];
    }
    if (e.lemma) out.push(e);
  }
  return out.length ? out : null;
}

function fromJson(text: string): LexEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Some lexicons ship as "var strongsGreekDictionary = {...};"
    const m = /=\s*(\{[\s\S]*\})\s*;?\s*(module\.exports.*)?$/.exec(text);
    if (!m) return null;
    try {
      data = JSON.parse(m[1]);
    } catch {
      return null;
    }
  }
  const toEntry = (o: Record<string, unknown>, key?: string): LexEntry | null => {
    const e: LexEntry = { lemma: '' };
    for (const [k, v] of Object.entries(o)) {
      if (v === null || typeof v === 'object') continue;
      const role = roleFromHeader(k);
      const val = clean(v);
      if (!val || role === 'skip') continue;
      if (role === 'def' && e.def) e.def += ` ${val}`;
      else if (role === 'gloss' && e.gloss) e.gloss += `; ${val}`;
      else if (!(e as unknown as Record<string, string>)[role]) (e as unknown as Record<string, string>)[role] = role === 'strong' ? normalizeStrong(val) ?? val : val;
    }
    if (key && !e.strong && normalizeStrong(key)) e.strong = normalizeStrong(key);
    if (!e.lemma && key && !normalizeStrong(key)) e.lemma = key;
    return e.lemma ? e : null;
  };
  const out: LexEntry[] = [];
  if (Array.isArray(data)) {
    for (const x of data) if (x && typeof x === 'object') out.push(...[toEntry(x as Record<string, unknown>)].filter((e): e is LexEntry => !!e));
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const e = toEntry(v as Record<string, unknown>, k);
        if (e) out.push(e);
      } else if (typeof v === 'string') out.push({ lemma: k, def: clean(v) });
    }
  }
  return out.length ? out : null;
}

function fromLines(lines: string[]): LexEntry[] | null {
  const out: LexEntry[] = [];
  for (const l of lines) {
    const m = /^\s*(.+?)\s*(?:—|–| - |:|=|\t)\s*(.+)$/.exec(l);
    if (!m) continue;
    let head = m[1].trim();
    const e: LexEntry = { lemma: head, def: clean(m[2]) };
    const strong = normalizeStrong(head);
    if (strong && head.length <= 7) {
      e.strong = strong;
      e.lemma = strong;
    }
    // "λόγος (logos)" → translit in brackets
    const tr = /^(.+?)\s*\(([^)]+)\)$/.exec(head);
    if (tr) {
      head = tr[1];
      e.lemma = head;
      e.translit = tr[2];
    }
    // A short first clause is the gloss.
    const first = e.def!.split(/[;.]/)[0];
    if (first.length <= 40) e.gloss = first.trim();
    out.push(e);
  }
  return out.length >= Math.max(3, lines.length * 0.4) ? out : null;
}

export function parseLexicon(text: string): LexEntry[] {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) throw new Error('The file is empty.');
  if (t.startsWith('[') || t.startsWith('{') || /^(var|const|let)\s+\w+\s*=/.test(t)) {
    const j = fromJson(t);
    if (j) return j;
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l));
  const tabs = lines.slice(0, 200).filter((l) => l.includes('\t')).length;
  const commas = lines.slice(0, 200).filter((l) => l.split(',').length >= 3).length;
  const table = tabs > lines.slice(0, 200).length * 0.5 ? fromTable(lines, '\t') : commas > lines.slice(0, 200).length * 0.5 ? fromTable(lines, ',') : null;
  const got = table ?? fromLines(lines);
  if (!got) throw new Error('No entries found. Use a table with a headword column (Greek, Hebrew or other) and a definition column, JSON, or lines like “λόγος — word”.');
  return got;
}

// ---------------------------------------------------------------- storage (TSV)

const esc = (s?: string) => (s ?? '').replace(/[\t\n\r]+/g, ' ');

export function toTsv(meta: Omit<LexiconMeta, 'file' | 'id'>, entries: LexEntry[]): string {
  const head = `#lexicon\t${esc(meta.name)}\t${meta.language}\t${entries.length}\nlemma\tstrong\ttranslit\tgloss\tmorph\tdefinition\n`;
  return head + entries.map((e) => [e.lemma, e.strong, e.translit, e.gloss, e.morph, e.def].map(esc).join('\t')).join('\n') + '\n';
}

export function readTsvMeta(first: string): { name: string; language: LexiconMeta['language']; count: number } | null {
  const c = first.split('\t');
  if (c[0] !== '#lexicon') return null;
  return { name: c[1] || 'Lexicon', language: (['greek', 'hebrew', 'latin'].includes(c[2]) ? c[2] : 'other') as LexiconMeta['language'], count: Number(c[3]) || 0 };
}

export function fromTsv(text: string): LexEntry[] {
  const lines = text.split('\n');
  const out: LexEntry[] = [];
  for (const l of lines.slice(2)) {
    if (!l) continue;
    const [lemma, strong, translit, gloss, morph, def] = l.split('\t');
    out.push({ lemma, strong: strong || undefined, translit: translit || undefined, gloss: gloss || undefined, morph: morph || undefined, def: def || undefined });
  }
  return out;
}

// ---------------------------------------------------------------- index

export interface LexHit extends LexEntry {
  lexicon: string;
  lexiconName: string;
  /** exact headword, exact transliteration/Strong's, prefix, or found in the English */
  match: 'exact' | 'strong' | 'translit' | 'prefix' | 'english';
}

export class LexiconIndex {
  private byKey = new Map<string, number[]>();
  private keys: string[] = [];
  constructor(
    readonly meta: LexiconMeta,
    readonly entries: LexEntry[],
  ) {
    const add = (k: string, i: number) => {
      if (!k) return;
      const list = this.byKey.get(k);
      if (list) {
        if (list[list.length - 1] !== i) list.push(i);
      } else this.byKey.set(k, [i]);
    };
    entries.forEach((e, i) => {
      add(lexKey(e.lemma), i);
      if (e.strong) add(e.strong.toLowerCase(), i);
      if (e.translit) add(lexKey(e.translit), i);
    });
    this.keys = [...this.byKey.keys()].sort();
  }

  private hit(i: number, match: LexHit['match']): LexHit {
    return { ...this.entries[i], lexicon: this.meta.id, lexiconName: this.meta.name, match };
  }

  lookup(q: string, limit = 20, english = true): LexHit[] {
    const raw = q.trim();
    if (!raw) return [];
    const out: LexHit[] = [];
    const seen = new Set<number>();
    const push = (i: number, m: LexHit['match']) => {
      if (seen.has(i) || out.length >= limit) return;
      seen.add(i);
      out.push(this.hit(i, m));
    };
    const strong = normalizeStrong(raw);
    if (strong) for (const i of this.byKey.get(strong.toLowerCase()) ?? []) push(i, 'strong');
    const k = lexKey(raw);
    for (const i of this.byKey.get(k) ?? []) push(i, GREEK.test(raw) || HEBREW.test(raw) ? 'exact' : 'translit');
    // Prefix (binary search in the sorted keys).
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < k) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < this.keys.length && this.keys[j].startsWith(k) && out.length < limit; j++) for (const i of this.byKey.get(this.keys[j])!) push(i, 'prefix');
    // Inflected forms: try shorter stems of a Greek or Hebrew word ("λόγου" → "λογο…").
    if (!out.length && (GREEK.test(raw) || HEBREW.test(raw)) && k.length > 3) {
      for (let cut = 1; cut <= Math.min(3, k.length - 3) && !out.length; cut++) {
        const stem = k.slice(0, -cut);
        let a = 0;
        let b = this.keys.length;
        while (a < b) {
          const mid = (a + b) >> 1;
          if (this.keys[mid] < stem) a = mid + 1;
          else b = mid;
        }
        for (let j = a; j < this.keys.length && this.keys[j].startsWith(stem) && out.length < Math.min(limit, 5); j++) for (const i of this.byKey.get(this.keys[j])!) push(i, 'prefix');
      }
    }
    // English: in the glosses, then the definitions.
    if (english && out.length < limit && /^[\p{Script=Latin}\s'-]{3,}$/u.test(raw)) {
      const re = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      this.entries.forEach((e, i) => {
        if (out.length < limit && e.gloss && re.test(e.gloss)) push(i, 'english');
      });
      this.entries.forEach((e, i) => {
        if (out.length < limit && e.def && re.test(e.def)) push(i, 'english');
      });
    }
    return out;
  }
}
