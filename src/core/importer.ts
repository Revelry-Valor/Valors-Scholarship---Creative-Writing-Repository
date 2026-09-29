// Library import (spec 12.1): turn outside text into read-only source documents.
// Bibles are recognised in several common formats and stored one book per file,
// one verse per paragraph; other texts are split into paragraphs with headings.

import { BOOKS, findScriptureRefs, type BookDef } from './scripture';
import { isTranscriptFile, parseSubtitles, toParagraphs, transcriptText } from './transcript';

export interface ImportOptions {
  title: string;
  text: string;
  kind?: 'auto' | 'bible' | 'text';
  author?: string;
  date?: string;
  translation?: string;
  /** Original file name: subtitle files (.srt, .vtt) become timed transcripts. */
  filename?: string;
}

export interface ImportedFile {
  /** File name (without .md) inside the collection folder. */
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ImportResult {
  kind: 'bible' | 'text';
  /** Folder name under library/. */
  collection: string;
  files: ImportedFile[];
  paragraphs: number;
}

export interface Verse {
  book: BookDef;
  chapter: number;
  verse: number;
  text: string;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- book names

const BY_NAME = new Map<string, BookDef>();
for (const b of BOOKS) {
  const names = [b.name, b.id, ...b.abbr.map((a) => (b.number ? `${b.number} ${a}` : a)), ...b.abbr.map((a) => (b.number ? `${b.number}${a}` : a))];
  for (const n of names) BY_NAME.set(n.toLowerCase().replace(/\s+/g, ' '), b);
}
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };

export function bookFromName(name: string): BookDef | undefined {
  let n = name.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  n = n.replace(/^(i{1,3}|iv)\s+/, (m) => `${ROMAN[m.trim()]} `).replace(/^(first|second|third)\s+/, (m) => `${{ first: 1, second: 2, third: 3 }[m.trim() as 'first']} `);
  n = n.replace(/^the (book|gospel|epistle|letter) of (st\.? )?/, '').replace(/^psalm$/, 'psalms');
  return BY_NAME.get(n) ?? BY_NAME.get(n.replace(/\s+/g, ''));
}

// ---------------------------------------------------------------- Bible parsers

function fromJson(text: string): Verse[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const out: Verse[] = [];
  const push = (bookName: string, chapter: number, verse: number, t: unknown) => {
    const book = bookFromName(bookName);
    if (book && typeof t === 'string' && t.trim()) out.push({ book, chapter, verse, text: clean(t) });
  };
  const root = (data as { books?: unknown; verses?: unknown })?.books ?? (data as { verses?: unknown })?.verses ?? data;
  if (!Array.isArray(root)) return null;
  for (const item of root as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue;
    // [{ book, chapter, verse, text }]
    if ('verse' in item && ('text' in item || 'content' in item)) {
      push(String(item.book ?? item.book_name ?? item.name ?? ''), Number(item.chapter), Number(item.verse), item.text ?? item.content);
      continue;
    }
    // [{ name|abbrev, chapters: [[verse, …], …] }]  or  chapters: [{ chapter, verses: [{verse,text}] }]
    const name = String(item.name ?? item.book ?? item.abbrev ?? '');
    const chapters = item.chapters as unknown[];
    if (!Array.isArray(chapters)) continue;
    chapters.forEach((ch, ci) => {
      if (Array.isArray(ch)) ch.forEach((v, vi) => push(name, ci + 1, vi + 1, v));
      else if (ch && typeof ch === 'object') {
        const c = ch as { chapter?: number; verses?: Array<{ verse?: number; text?: string } | string> };
        (c.verses ?? []).forEach((v, vi) => (typeof v === 'string' ? push(name, c.chapter ?? ci + 1, vi + 1, v) : push(name, c.chapter ?? ci + 1, v.verse ?? vi + 1, v.text)));
      }
    });
  }
  return out.length ? out : null;
}

function fromTable(text: string): Verse[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 5) return null;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].split(',').length >= 4 ? ',' : lines[0].split('|').length >= 4 ? '|' : null;
  if (!sep) return null;
  const split = (l: string) => {
    if (sep !== ',') return l.split(sep);
    // CSV with quoted text
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (q && l[i + 1] === '"') {
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
  };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  let cols = { book: head.findIndex((h) => /book/.test(h)), chapter: head.findIndex((h) => /chap/.test(h)), verse: head.findIndex((h) => /^v(erse)?$|verse/.test(h)), text: head.findIndex((h) => /text|content|scripture/.test(h)) };
  let start = 1;
  if (cols.book < 0 || cols.chapter < 0 || cols.verse < 0 || cols.text < 0) {
    // No header: book, chapter, verse, text
    const first = split(lines[0]);
    if (first.length >= 4 && /^\d+$/.test(first[1].trim()) && /^\d+$/.test(first[2].trim())) {
      cols = { book: 0, chapter: 1, verse: 2, text: 3 };
      start = 0;
    } else return null;
  }
  const out: Verse[] = [];
  for (const l of lines.slice(start)) {
    const c = split(l);
    const book = bookFromName(c[cols.book] ?? '') ?? BOOKS[Number(c[cols.book]) - 1];
    const t = cols.text === c.length - 1 || sep !== ',' ? c.slice(cols.text).join(sep === ',' ? ',' : sep) : c[cols.text];
    if (book && t) out.push({ book, chapter: Number(c[cols.chapter]), verse: Number(c[cols.verse]), text: clean(t) });
  }
  return out.length > lines.length * 0.6 ? out : null;
}

function fromRefLines(text: string): Verse[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: Verse[] = [];
  for (const l of lines) {
    const ref = findScriptureRefs(l)[0];
    if (!ref || ref.verseStart === undefined || l.slice(0, ref.from).trim()) continue;
    const book = BOOKS.find((b) => b.id === ref.book)!;
    const t = l.slice(ref.to).replace(/^[\s:.\-–—]+/, '');
    if (t) out.push({ book, chapter: ref.chapter, verse: ref.verseStart, text: clean(t) });
  }
  return out.length >= Math.max(5, lines.length * 0.5) ? out : null;
}

function fromNumbered(text: string): Verse[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let book: BookDef | undefined;
  let chapter = 0;
  const out: Verse[] = [];
  let numbered = 0;
  for (const l of lines) {
    const chap = /^(?:chapter|ch\.?|psalm)\s+(\d+)\b/i.exec(l);
    if (chap) {
      chapter = Number(chap[1]);
      continue;
    }
    const withBook = /^(.{2,40}?)\s+(\d{1,3})$/.exec(l);
    if (withBook && bookFromName(withBook[1])) {
      book = bookFromName(withBook[1]);
      chapter = Number(withBook[2]);
      continue;
    }
    if (bookFromName(l)) {
      book = bookFromName(l);
      chapter = 1;
      continue;
    }
    const v = /^(\d{1,3})[\s.:)\]]+(.+)$/.exec(l);
    if (v && book && chapter) {
      numbered++;
      out.push({ book, chapter, verse: Number(v[1]), text: clean(v[2]) });
    } else if (out.length && !v) {
      // continuation of the previous verse
      out[out.length - 1].text += ` ${clean(l)}`;
    }
  }
  return numbered >= 5 ? out : null;
}

export function parseBible(text: string): Verse[] | null {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return fromJson(t);
  return fromTable(t) ?? fromRefLines(t) ?? fromNumbered(t);
}

// ---------------------------------------------------------------- output

function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

function bibleFiles(verses: Verse[], translation: string): ImportedFile[] {
  const byBook = new Map<string, Verse[]>();
  for (const v of verses) {
    if (!byBook.has(v.book.id)) byBook.set(v.book.id, []);
    byBook.get(v.book.id)!.push(v);
  }
  const files: ImportedFile[] = [];
  for (const [id, list] of byBook) {
    const book = list[0].book;
    const order = BOOKS.findIndex((b) => b.id === id) + 1;
    list.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
    const parts: string[] = [];
    let ch = 0;
    for (const v of list) {
      if (v.chapter !== ch) {
        ch = v.chapter;
        parts.push(`## ${book.name} ${ch}`);
      }
      // Each verse is its own paragraph, addressed by its reference.
      parts.push(`[${book.id} ${v.chapter}:${v.verse}] ${v.text.replace(/\^b-/g, '^ b-')}`);
    }
    files.push({
      name: `${String(order).padStart(2, '0')} ${book.name}`,
      frontmatter: { title: `${book.name} (${translation})`, kind: 'bible', translation, book: id, readonly: true },
      body: `${parts.join('\n\n')}\n`,
    });
  }
  return files;
}

const HEADING_RE = /^(?:(?:chapter|book|part|section|letter|epistle|homily|sermon|oration|canto|article|question)\s+[\divxlcdm]+\b.*|[IVXLCDM]+\.?\s*$|[IVXLCDM]+\.\s+\S.*)$/i;

function textBody(text: string): { body: string; paragraphs: number } {
  const norm = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const hasBlankLines = /\n\s*\n/.test(norm);
  const chunks = hasBlankLines ? norm.split(/\n\s*\n/) : norm.split('\n');
  const out: string[] = [];
  for (const raw of chunks) {
    const c = hasBlankLines ? raw.replace(/\s*\n\s*/g, ' ').trim() : raw.trim();
    if (!c) continue;
    if (/^#{1,6}\s/.test(c)) {
      out.push(c);
      continue;
    }
    const isHeading = c.length <= 70 && (HEADING_RE.test(c) || (c === c.toUpperCase() && /[A-Z]{3}/.test(c) && !/[.!?]$/.test(c)));
    // Protect our own markers in outside text; the source stays readable as written.
    out.push(isHeading ? `## ${c}` : c.replace(/\^b-/g, '^ b-'));
  }
  return { body: `${out.join('\n\n')}\n`, paragraphs: out.length };
}

export function importText(opts: ImportOptions): ImportResult {
  const title = safeName(opts.title);
  // Subtitles and timed transcripts: one paragraph per stretch of speech, with its time.
  if (isTranscriptFile(opts.filename ?? '', opts.text)) {
    const segs = parseSubtitles(opts.text);
    if (segs) opts = { ...opts, kind: 'text', text: transcriptText(toParagraphs(segs)) };
  }
  const verses = opts.kind === 'text' ? null : parseBible(opts.text);
  if ((opts.kind === 'bible' || opts.kind === 'auto' || !opts.kind) && verses && verses.length >= 5) {
    const translation = (opts.translation || title).trim();
    return { kind: 'bible', collection: safeName(translation), files: bibleFiles(verses, translation), paragraphs: verses.length };
  }
  if (opts.kind === 'bible') throw new Error('No verses found. Supported: lines starting with a reference (Gen 1:1 …), CSV/TSV with book, chapter, verse and text columns, JSON Bibles, or book and chapter headings with numbered verses.');
  const { body, paragraphs } = textBody(opts.text);
  const fm: Record<string, unknown> = { title, kind: 'text', readonly: true };
  if (opts.author) fm.author = opts.author;
  if (opts.date) fm.date = opts.date;
  return { kind: 'text', collection: '', files: [{ name: title, frontmatter: fm, body }], paragraphs };
}
