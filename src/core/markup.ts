// Inline markup tokenizer (spec section 4).
//
// Everything is plain text so files stay readable outside the program. The
// tokenizer is shared by the indexer (to file blocks) and by the editor (to draw
// chips, the context stripe and warning underlines), so both always agree.

import { findScriptureRefs, type ScriptureRef } from './scripture';
import { findDates, type FoundDate } from './dates';

export interface NameResolver {
  /**
   * The longest known entity name or alias that `text` starts with
   * (case-insensitive, and followed by a non-letter), or null.
   */
  matchPrefix(text: string): string | null;
  /** Resolve a typed name to an entity. */
  resolve(name: string): Resolution;
}

export type Resolution =
  | { status: 'ok'; id: string }
  | { status: 'ambiguous'; ids: string[] }
  | { status: 'missing' };

/** Paragraph marks: `!key` (important) and `!check` (needs verifying). */
export const MARK_KINDS = ['key', 'check', 'claim'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const CONFIDENCE_LEVELS = ['certain', 'probable', 'possible', 'disputed', 'legendary'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type Token =
  | TagToken
  | { kind: 'link'; from: number; to: number; name: string; display?: string }
  | FieldToken
  | { kind: 'relation'; from: number; to: number; type: string }
  | { kind: 'topic'; from: number; to: number; name: string }
  | { kind: 'pin'; from: number; to: number }
  | { kind: 'mark'; from: number; to: number; mark: MarkKind }
  | { kind: 'keyspan'; from: number; to: number; inner: string }
  | { kind: 'scripture'; from: number; to: number; ref: ScriptureRef }
  | { kind: 'date'; from: number; to: number; date: FoundDate }
  /** ![[Name]], ![[Document]] or ![[#b-id]]: a live quotation of a page, a document or one paragraph. */
  | { kind: 'embed'; from: number; to: number; target: string }
  | { kind: 'note'; from: number; to: number; closed: boolean }
  | { kind: 'blockId'; from: number; to: number; id: string }
  | { kind: 'code'; from: number; to: number }
  | { kind: 'unclosed'; from: number; to: number; what: string };

export interface TagToken {
  kind: 'tag';
  from: number;
  to: number;
  /** The entity name as typed (without @, brackets, display text or section). */
  name: string;
  /** `@@Name`: create a new entity. */
  create: boolean;
  /** `@-Name`: opt this block out of a section owner. */
  optOut: boolean;
  /** A bare `@` at the end of a heading: the heading text itself is the owner. */
  bare: boolean;
  /** Text shown in place of the name (`@Name|he`). */
  display?: string;
  /** Profile section this block should go to (`@Name::Writings`). */
  section?: string;
  /** Offsets of the name itself, for rename rewriting. */
  nameFrom: number;
  nameTo: number;
}

export interface FieldToken {
  kind: 'field';
  from: number;
  to: number;
  entity?: string;
  field: string;
  value: string;
  confidence?: Confidence;
}

const LETTER = /[\p{L}\p{N}]/u;
const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;
const UPPER = /\p{Lu}/u;
const PARTICLES = new Set(['of', 'the', 'de', 'la', 'le', 'von', 'van', 'der', 'da', 'di', 'du', 'al', 'el', 'bin', 'ibn', 'ben', 'y']);
const BLOCK_ID_RE = /[ \t]\^(b-[a-z0-9]+)[ \t]*$/gm;

export const BLOCK_ID_PATTERN = /^b-[a-z0-9]+$/;

function isLetter(ch: string | undefined): boolean {
  return !!ch && LETTER.test(ch);
}

function isBoundaryBefore(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return !LETTER.test(prev) && prev !== '_' && prev !== '\\' && prev !== '@';
}

/** Read one word starting at `i`. Returns its end offset (exclusive). */
function readWord(text: string, i: number): number {
  let j = i;
  while (j < text.length && WORD_CHAR.test(text[j])) j++;
  // Trailing possessives and dangling punctuation are not part of a name.
  let word = text.slice(i, j);
  const poss = word.match(/(['’]s|['’-]+)$/);
  if (poss && word.length > poss[0].length) j -= poss[0].length;
  return j;
}

/**
 * A run of capitalized words: "Apple Scouch", "Council of Nicaea".
 * Returns the end offsets after each accepted word, so callers can shrink it.
 */
function capitalizedRun(text: string, i: number): number[] {
  const ends: number[] = [];
  let end = readWord(text, i);
  if (end === i) return ends;
  ends.push(end);
  if (!UPPER.test(text[i])) return ends;
  for (;;) {
    let j = end;
    // Accept up to two lowercase particles if a capitalized word follows them.
    let particles = 0;
    let k = j;
    let ok = false;
    for (;;) {
      if (text[k] !== ' ' || !isLetter(text[k + 1])) break;
      const wEnd = readWord(text, k + 1);
      const word = text.slice(k + 1, wEnd);
      if (UPPER.test(word[0])) {
        end = wEnd;
        ok = true;
        break;
      }
      if (PARTICLES.has(word.toLowerCase()) && particles < 2) {
        particles++;
        k = wEnd;
        continue;
      }
      break;
    }
    if (!ok || end === j) break;
    ends.push(end);
  }
  return ends;
}

function readBracket(text: string, i: number, open: string, close: string): number {
  // i points at `open`; returns index of the matching `close` or -1.
  const j = text.indexOf(close, i + open.length);
  if (j === -1) return -1;
  const nl = text.indexOf('\n', i);
  if (nl !== -1 && nl < j) return -1;
  return j;
}

function readSectionOrDisplay(text: string, i: number): { value: string; end: number } | null {
  if (text[i] === '[') {
    const j = readBracket(text, i, '[', ']');
    if (j === -1) return null;
    return { value: text.slice(i + 1, j).trim(), end: j + 1 };
  }
  let j = i;
  while (j < text.length && /[\p{L}\p{N}_-]/u.test(text[j])) j++;
  if (j === i) return null;
  return { value: text.slice(i, j), end: j };
}

/** Normalize a typed name for comparison: case, whitespace and possessive. */
export function normalizeName(name: string): string {
  return name
    .replace(/['’]s$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokenize(text: string, resolver?: NameResolver): Token[] {
  const tokens: Token[] = [];
  // Block ids first, so nothing inside them is mistaken for markup.
  const idRanges: Array<[number, number]> = [];
  BLOCK_ID_RE.lastIndex = 0;
  for (let m; (m = BLOCK_ID_RE.exec(text)); ) {
    const from = m.index;
    tokens.push({ kind: 'blockId', from, to: from + m[0].length, id: m[1] });
    idRanges.push([from, from + m[0].length]);
  }
  const inIdRange = (i: number) => idRanges.find(([a, b]) => i >= a && i < b);

  let i = 0;
  while (i < text.length) {
    const r = inIdRange(i);
    if (r) {
      i = r[1];
      continue;
    }
    const ch = text[i];

    // Private note: %% ... %%
    if (ch === '%' && text[i + 1] === '%') {
      const j = text.indexOf('%%', i + 2);
      if (j === -1) {
        tokens.push({ kind: 'note', from: i, to: text.length, closed: false });
        tokens.push({ kind: 'unclosed', from: i, to: i + 2, what: 'private note (%%)' });
        break;
      }
      tokens.push({ kind: 'note', from: i, to: j + 2, closed: true });
      i = j + 2;
      continue;
    }

    // Inline code is never parsed.
    if (ch === '`') {
      let ticks = 1;
      while (text[i + ticks] === '`') ticks++;
      const fence = '`'.repeat(ticks);
      const j = text.indexOf(fence, i + ticks);
      if (j !== -1) {
        tokens.push({ kind: 'code', from: i, to: j + ticks });
        i = j + ticks;
        continue;
      }
      i += ticks;
      continue;
    }

    if (ch === '\\') {
      i += 2;
      continue;
    }

    // Tags: @Name  @@Name  @-Name  @[Long name|shown]  @Name|shown  @Name::Section  bare @
    if (ch === '@' && isBoundaryBefore(text, i)) {
      const tok = readTag(text, i, resolver);
      if (tok) {
        tokens.push(tok);
        i = tok.to;
        continue;
      }
    }

    // ![[…]] quotes a page, a document or a paragraph (#b-id), live
    if (ch === '!' && text.startsWith('![[', i)) {
      const j = readBracket(text, i + 1, '[[', ']]');
      if (j !== -1) {
        tokens.push({ kind: 'embed', from: i, to: j + 2, target: text.slice(i + 3, j).trim() });
        i = j + 2;
        continue;
      }
    }

    // [[Name]] or [[Name|shown]]
    if (ch === '[' && text[i + 1] === '[') {
      const j = readBracket(text, i, '[[', ']]');
      if (j !== -1) {
        const inner = text.slice(i + 2, j);
        const [name, display] = inner.split('|');
        tokens.push({ kind: 'link', from: i, to: j + 2, name: name.trim(), display: display?.trim() || undefined });
        i = j + 2;
        continue;
      }
      tokens.push({ kind: 'unclosed', from: i, to: i + 2, what: 'link ([[ ]])' });
      i += 2;
      continue;
    }

    // {field: value}
    if (ch === '{') {
      const j = readBracket(text, i, '{', '}');
      const inner = j === -1 ? '' : text.slice(i + 1, j);
      if (j !== -1 && inner.includes(':')) {
        tokens.push(parseField(inner, i, j + 1));
        i = j + 1;
        continue;
      }
      if (j === -1 && /^\{[\p{L}@][^{}\n]*:/u.test(text.slice(i))) {
        tokens.push({ kind: 'unclosed', from: i, to: i + 1, what: 'fact ({ })' });
      }
      i++;
      continue;
    }

    // >relation>
    if (ch === '>' && (i === 0 || /\s/.test(text[i - 1]))) {
      const m = /^>([\p{L}_][\p{L}\p{N}_]*)>(?=\s|$)/u.exec(text.slice(i));
      if (m) {
        tokens.push({ kind: 'relation', from: i, to: i + m[0].length, type: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // #topic
    if (ch === '#' && (i === 0 || /[\s(]/.test(text[i - 1])) && isLetter(text[i + 1])) {
      const m = /^#([\p{L}\p{N}][\p{L}\p{N}_-]*)/u.exec(text.slice(i));
      if (m) {
        const raw = m[1].replace(/-+$/, '');
        tokens.push({ kind: 'topic', from: i, to: i + 1 + raw.length, name: raw.replace(/[-_]+/g, ' ') });
        i += 1 + raw.length;
        continue;
      }
    }

    // !key / !check / !claim — mark the whole paragraph
    if (ch === '!' && text[i + 1] !== '!' && isBoundaryBefore(text, i)) {
      const m = /^!(key|check|claim)(?![\p{L}\p{N}_])/u.exec(text.slice(i));
      if (m) {
        tokens.push({ kind: 'mark', from: i, to: i + m[0].length, mark: m[1] as MarkKind });
        i += m[0].length;
        continue;
      }
    }

    // !!important phrase!!
    if (ch === '!' && text[i + 1] === '!' && text[i + 2] && !/[\s!]/.test(text[i + 2]) && (i === 0 || text[i - 1] !== '!')) {
      const close = text.indexOf('!!', i + 3);
      const nl = text.indexOf('\n', i);
      if (close !== -1 && (nl === -1 || close < nl) && !/\s/.test(text[close - 1])) {
        tokens.push({ kind: 'keyspan', from: i, to: close + 2, inner: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }

    // ^pin
    if (ch === '^' && text.startsWith('^pin', i) && !isLetter(text[i + 4]) && isBoundaryBefore(text, i)) {
      tokens.push({ kind: 'pin', from: i, to: i + 4 });
      i += 4;
      continue;
    }

    i++;
  }
  // Scripture references need no markup: find them in the text between other markup.
  for (const ref of findScriptureRefs(text)) {
    if (tokens.some((t) => t.from < ref.to && t.to > ref.from)) continue;
    tokens.push({ kind: 'scripture', from: ref.from, to: ref.to, ref });
  }
  // Dates written in prose ("May 4th 2026") date the paragraph.
  for (const d of findDates(text)) {
    if (tokens.some((t) => t.from < d.to && t.to > d.from)) continue;
    tokens.push({ kind: 'date', from: d.from, to: d.to, date: d });
  }
  return tokens.sort((a, b) => a.from - b.from);
}

function readTag(text: string, at: number, resolver?: NameResolver): TagToken | null {
  let i = at + 1;
  let create = false;
  let optOut = false;
  if (text[i] === '@') {
    create = true;
    i++;
  } else if (text[i] === '-' && (isLetter(text[i + 1]) || text[i + 1] === '[')) {
    optOut = true;
    i++;
  }

  // Bare "@": the heading self-tag form `## Apple Scouch @`.
  if (!create && !optOut && (i >= text.length || /\s/.test(text[i]))) {
    return { kind: 'tag', from: at, to: at + 1, name: '', create: false, optOut: false, bare: true, nameFrom: at + 1, nameTo: at + 1 };
  }

  let name: string;
  let nameFrom = i;
  let nameTo: number;
  let display: string | undefined;
  let end: number;

  if (text[i] === '[') {
    const j = readBracket(text, i, '[', ']');
    if (j === -1) return null;
    const inner = text.slice(i + 1, j);
    const bar = inner.indexOf('|');
    name = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    if (bar !== -1) display = inner.slice(bar + 1).trim() || undefined;
    nameFrom = i + 1;
    nameTo = i + 1 + (bar === -1 ? inner.length : bar);
    end = j + 1;
  } else {
    if (!isLetter(text[i])) return null;
    const rest = text.slice(i);
    const known = resolver?.matchPrefix(rest) ?? null;
    if (known) {
      nameTo = i + known.length;
    } else {
      const ends = capitalizedRun(text, i);
      if (ends.length === 0) return null;
      nameTo = ends[ends.length - 1];
      // Prefer the longest run that resolves ("@Pineapple Then" → Pineapple),
      // but when creating keep the whole run.
      if (resolver && !create && ends.length > 1) {
        for (let k = ends.length - 1; k >= 0; k--) {
          if (resolver.resolve(text.slice(i, ends[k])).status !== 'missing') {
            nameTo = ends[k];
            break;
          }
        }
      }
    }
    name = text.slice(i, nameTo);
    end = nameTo;
    if (text[end] === '|') {
      const d = readSectionOrDisplay(text, end + 1);
      if (d) {
        display = d.value;
        end = d.end;
      }
    }
  }

  let section: string | undefined;
  if (text[end] === ':' && text[end + 1] === ':') {
    const s = readSectionOrDisplay(text, end + 2);
    if (s) {
      section = s.value;
      end = s.end;
    }
  }

  return { kind: 'tag', from: at, to: end, name, create, optOut, bare: false, display, section, nameFrom, nameTo };
}

function parseField(inner: string, from: number, to: number): FieldToken {
  const colon = inner.indexOf(':');
  let key = inner.slice(0, colon).trim();
  let value = inner.slice(colon + 1).trim();
  let confidence: Confidence | undefined;
  const conf = /\s\?([a-z]+)$/.exec(value);
  if (conf && (CONFIDENCE_LEVELS as readonly string[]).includes(conf[1])) {
    confidence = conf[1] as Confidence;
    value = value.slice(0, conf.index).trim();
  }
  let entity: string | undefined;
  const dot = key.lastIndexOf('.');
  if (dot > 0) {
    entity = key.slice(0, dot).replace(/^@+/, '').replace(/^\[|\]$/g, '').trim();
    key = key.slice(dot + 1).trim();
  }
  return { kind: 'field', from, to, entity, field: normalizeFieldKey(key), value, confidence };
}

export function normalizeFieldKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

/** Heading level for a block's first line, or 0. */
export function headingLevel(text: string): number {
  const m = /^(#{1,6})\s/.exec(text);
  return m ? m[1].length : 0;
}

/** Heading text without its # marker, tags, and block id — the section name it declares. */
export function headingTitle(text: string, resolver?: NameResolver): string {
  const level = headingLevel(text);
  let body = text.slice(level ? level + 1 : 0);
  const tokens = tokenize(body, resolver);
  let out = '';
  let last = 0;
  for (const t of tokens) {
    if (t.kind === 'tag' || t.kind === 'blockId' || t.kind === 'note' || t.kind === 'pin') {
      out += body.slice(last, t.from);
      last = t.to;
    }
  }
  out += body.slice(last);
  return out.replace(/\s+/g, ' ').trim();
}

/** Plain, readable text for a block: chips become their display names, notes disappear. */
export function plainText(text: string, resolver?: NameResolver): string {
  const tokens = tokenize(text, resolver);
  let out = '';
  let last = 0;
  for (const t of tokens) {
    out += text.slice(last, t.from);
    switch (t.kind) {
      case 'tag':
        out += t.bare ? '' : t.display ?? t.name;
        break;
      case 'link':
        out += t.display ?? t.name;
        break;
      case 'topic':
        out += t.name;
        break;
      case 'field':
        out += t.value.replace(/^@+/, '');
        break;
      case 'relation':
        out += t.type.replace(/_/g, ' ');
        break;
      case 'code':
        out += text.slice(t.from, t.to);
        break;
      case 'keyspan':
        out += t.inner;
        break;
      case 'scripture':
      case 'date':
        out += text.slice(t.from, t.to);
        break;
      case 'embed':
        out += `“${t.target.replace(/^#/, '')}”`;
        break;
      default:
        break;
    }
    last = t.to;
  }
  out += text.slice(last);
  return out
    .replace(/^#{1,6}\s+/, '')
    .replace(/<\/?u>/g, '')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** Make a string safe to use inside a tag; long or unusual names use the bracket form. */
export function formatTag(name: string, opts: { create?: boolean; resolver?: NameResolver } = {}): string {
  const prefix = opts.create ? '@@' : '@';
  const ends = capitalizedRun(name, 0);
  const simple = ends.length > 0 && ends[ends.length - 1] === name.length && !/[\[\]|]/.test(name);
  return simple ? `${prefix}${name}` : `${prefix}[${name}]`;
}
