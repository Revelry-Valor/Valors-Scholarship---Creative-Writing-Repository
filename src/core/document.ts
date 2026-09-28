// Markdown files are the source of truth (spec 13). This module splits a file
// into frontmatter and blocks, and writes them back.
//
// A block is one paragraph, heading, list item, quote or code fence. Every block
// ends with a permanent id, written as ` ^b-xxxxxx` at the end of its last line.

import YAML from 'yaml';
import type { BlockKind } from './types';
import { headingLevel } from './markup';

export interface ParsedBlock {
  /** Text without the trailing block id. */
  text: string;
  id?: string;
  kind: BlockKind;
  headingLevel?: number;
  /** Offsets of the full block (including id) within the body. */
  from: number;
  to: number;
}

export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Offset of the body within the full file. */
  bodyOffset: number;
  blocks: ParsedBlock[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const TRAILING_ID_RE = /[ \t]+\^(b-[a-z0-9]+)[ \t]*$/;
const LIST_ITEM_RE = /^(?:[-*+]|\d+[.)])\s/;

export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string; bodyOffset: number } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { frontmatter: {}, body: content, bodyOffset: 0 };
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
  } catch {
    frontmatter = {};
  }
  let bodyOffset = m[0].length;
  // One blank line after the frontmatter is layout, not content.
  if (content.slice(bodyOffset).startsWith('\n')) bodyOffset += 1;
  else if (content.slice(bodyOffset).startsWith('\r\n')) bodyOffset += 2;
  return { frontmatter, body: content.slice(bodyOffset), bodyOffset };
}

export function parseFile(content: string): ParsedFile {
  const { frontmatter, body, bodyOffset } = splitFrontmatter(content.replace(/\r\n/g, '\n'));
  return { frontmatter, body, bodyOffset, blocks: splitBlocks(body) };
}

function kindOf(firstLine: string): { kind: BlockKind; level?: number } {
  const level = headingLevel(firstLine);
  if (level) return { kind: 'heading', level };
  if (LIST_ITEM_RE.test(firstLine)) return { kind: 'list' };
  if (/^>\s?/.test(firstLine)) return { kind: 'quote' };
  if (/^(```|~~~)/.test(firstLine)) return { kind: 'code' };
  return { kind: 'paragraph' };
}

/**
 * Split a body into blocks. Rules:
 * - blank lines separate blocks;
 * - a heading line is always its own block;
 * - every list item is its own block (indented continuation lines stay with it);
 * - fenced code is one block, blank lines included.
 */
export function splitBlocks(body: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = body.split('\n');
  let offset = 0;
  let cur: { from: number; lines: string[]; kind: BlockKind; level?: number; fence?: string } | null = null;

  const flush = () => {
    if (!cur) return;
    const raw = cur.lines.join('\n');
    const to = cur.from + raw.length;
    const idm = TRAILING_ID_RE.exec(raw);
    const text = idm ? raw.slice(0, idm.index) : raw;
    blocks.push({ text, id: idm?.[1], kind: cur.kind, headingLevel: cur.level, from: cur.from, to });
    cur = null;
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineFrom = offset;
    offset += line.length + 1;

    if (cur?.fence) {
      cur.lines.push(line);
      if (line.trimStart().startsWith(cur.fence) && cur.lines.length > 1) {
        // Closing fence; an id may trail it.
        flush();
      }
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    const k = kindOf(line);
    if (k.kind === 'code') {
      flush();
      const fence = line.trimStart().slice(0, 3);
      cur = { from: lineFrom, lines: [line], kind: 'code', fence };
      continue;
    }
    if (k.kind === 'heading') {
      flush();
      cur = { from: lineFrom, lines: [line], kind: 'heading', level: k.level };
      flush();
      continue;
    }
    if (k.kind === 'list') {
      flush();
      cur = { from: lineFrom, lines: [line], kind: 'list' };
      continue;
    }
    if (cur && cur.kind === 'list' && /^\s+\S/.test(line)) {
      cur.lines.push(line);
      continue;
    }
    if (cur && (cur.kind === 'list' || (cur.kind === 'quote') !== (k.kind === 'quote'))) {
      flush();
    }
    if (!cur) cur = { from: lineFrom, lines: [line], kind: k.kind };
    else cur.lines.push(line);
  }
  flush();
  return blocks;
}

export function blockSource(b: { text: string; id?: string }): string {
  return b.id ? `${b.text} ^${b.id}` : b.text;
}

/** Join blocks back into a body. Consecutive list items stay on adjacent lines. */
export function joinBlocks(blocks: Array<{ text: string; id?: string; kind: BlockKind }>): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      out += prev.kind === 'list' && b.kind === 'list' ? '\n' : '\n\n';
    }
    out += blockSource(b);
  });
  return out ? out + '\n' : out;
}

export function stringifyFile(frontmatter: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) if (v !== undefined) clean[k] = v;
  const fm = Object.keys(clean).length ? `---\n${YAML.stringify(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n` : '';
  return fm + body.replace(/^\n+/, '');
}

/** Replace one block's text inside a body, keeping everything else byte-for-byte. */
export function replaceBlockInBody(body: string, id: string, newText: string): string | null {
  const blocks = splitBlocks(body);
  const b = blocks.find((x) => x.id === id);
  if (!b) return null;
  return body.slice(0, b.from) + blockSource({ text: newText, id }) + body.slice(b.to);
}

export function removeBlockFromBody(body: string, id: string): string | null {
  const blocks = splitBlocks(body);
  const idx = blocks.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  // Swallow the separator that followed the block (or preceded it, if last).
  if (idx < blocks.length - 1) return body.slice(0, blocks[idx].from) + body.slice(blocks[idx + 1].from);
  const from = idx > 0 ? blocks[idx - 1].to : 0;
  return body.slice(0, from) + (from > 0 ? '\n' : '');
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix: 'b' | 'e' | 'n', length = 6): string {
  let s = '';
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  const bytes = new Uint8Array(length);
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return `${prefix}-${s}`;
}

const INNER_ID_RE = /[ \t]\^(b-[a-z0-9]+)[ \t]*(?=\n)/g;

/**
 * Give every block without an id a new one, and replace ids that are duplicated
 * inside the body (e.g. after copy-paste) or already `taken` elsewhere.
 * When two paragraphs were merged, the merged block keeps the first one's id and
 * the stray inner id is removed.
 * Returns the edits as offset replacements so an editor can apply them without
 * disturbing the cursor.
 */
export function planBlockIds(
  body: string,
  taken: (id: string) => boolean = () => false,
): Array<{ from: number; to: number; insert: string; id: string }> {
  const edits: Array<{ from: number; to: number; insert: string; id: string }> = [];
  const seen = new Set<string>();
  for (const b of splitBlocks(body)) {
    if (b.kind === 'code' && !b.text.trim()) continue;
    const inner = b.kind === 'code' ? [] : [...b.text.matchAll(INNER_ID_RE)];
    for (const m of inner) edits.push({ from: b.from + m.index!, to: b.from + m.index! + m[0].length, insert: '', id: '' });
    const idFrom = b.from + b.text.length;
    const setId = (id: string) => edits.push({ from: idFrom, to: b.to, insert: ` ^${id}`, id });
    const want = inner.length ? inner[0][1] : b.id;
    if (want && !seen.has(want) && !taken(want)) {
      seen.add(want);
      if (want !== b.id) setId(want);
      continue;
    }
    let id = newId('b');
    while (seen.has(id) || taken(id)) id = newId('b');
    seen.add(id);
    setId(id);
  }
  return edits;
}

export function applyEdits(body: string, edits: Array<{ from: number; to: number; insert: string }>): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from);
  let out = body;
  for (const e of sorted) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return s.slice(0, 80) || 'Untitled';
}
