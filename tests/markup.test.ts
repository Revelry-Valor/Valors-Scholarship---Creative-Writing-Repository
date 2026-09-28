import { describe, expect, it } from 'vitest';
import { tokenize, plainText, headingTitle, formatTag, type TagToken } from '../src/core/markup';
import { NameTable } from '../src/core/names';
import { splitBlocks, planBlockIds, applyEdits, joinBlocks } from '../src/core/document';
import { parseDate } from '../src/core/dates';

const names = new NameTable([
  { id: 'e-1', name: 'Apple Scouch', aliases: ['the Vine Doctor'] },
  { id: 'e-2', name: 'Chamberlain Pineapple', aliases: [] },
  { id: 'e-3', name: 'Council of Nicaea', aliases: [] },
]);

const tags = (text: string, r = names) => tokenize(text, r).filter((t): t is TagToken => t.kind === 'tag');

describe('tag tokenizer', () => {
  it('reads multi-word names from capitalized runs', () => {
    const [t] = tags('@@Apple Scouch wrote On the Vine', undefined);
    expect(t.name).toBe('Apple Scouch');
    expect(t.create).toBe(true);
  });

  it('prefers known names, and stops before possessives', () => {
    expect(tags("@Apple Scouch's view")[0].name).toBe('Apple Scouch');
    expect(tags('@Council of Nicaea met')[0].name).toBe('Council of Nicaea');
  });

  it('shrinks a run to the part that resolves', () => {
    expect(tags('@Pineapple Then he left')[0].name).toBe('Pineapple');
  });

  it('handles display text, sections, opt-outs, brackets and bare heading tags', () => {
    const [a] = tags('@Apple Scouch|he said');
    expect(a.display).toBe('he');
    const [b] = tags('@Scouch::Writings is here');
    expect(b.section).toBe('Writings');
    const [c] = tags('not him @-Scouch');
    expect(c.optOut).toBe(true);
    const [d] = tags('@[grace and repentance|this doctrine]');
    expect(d.name).toBe('grace and repentance');
    expect(d.display).toBe('this doctrine');
    const [e] = tags('## Apple Scouch @');
    expect(e.bare).toBe(true);
  });

  it('ignores emails and escaped @', () => {
    expect(tags('mail me at a@b.com or \\@Scouch')).toHaveLength(0);
  });

  it('reads fields, relations, topics, pins, notes and block ids', () => {
    const toks = tokenize('@Chamberlain Pineapple >disagrees_with> @Apple Scouch on #grace-and-repentance {died: 1351 ?probable} ^pin %% private %% ^b-abc123', names);
    const kinds = toks.map((t) => t.kind);
    expect(kinds).toEqual(['tag', 'relation', 'tag', 'topic', 'field', 'pin', 'note', 'blockId']);
    const field = toks.find((t) => t.kind === 'field');
    expect(field).toMatchObject({ field: 'died', value: '1351', confidence: 'probable' });
    expect(toks.find((t) => t.kind === 'topic')).toMatchObject({ name: 'grace and repentance' });
  });

  it('does not parse inside private notes or code', () => {
    expect(tags('%% @Apple Scouch %% and `@Chamberlain Pineapple`')).toHaveLength(0);
  });

  it('flags unclosed markers', () => {
    expect(tokenize('{died: 1351', names).some((t) => t.kind === 'unclosed')).toBe(true);
    expect(tokenize('%% never closed', names).some((t) => t.kind === 'unclosed')).toBe(true);
  });

  it('makes plain text and heading titles', () => {
    expect(plainText('@Apple Scouch|He wrote in {year: 1313} ^b-xx1', names)).toBe('He wrote in 1313');
    expect(headingTitle('## Apple Scouch @', names)).toBe('Apple Scouch');
    expect(headingTitle("### Pineapple's objections @Chamberlain Pineapple", names)).toBe("Pineapple's objections");
  });

  it('formats tags safely', () => {
    expect(formatTag('Apple Scouch')).toBe('@Apple Scouch');
    expect(formatTag('grace and repentance')).toBe('@[grace and repentance]');
  });
});

describe('document blocks', () => {
  it('splits paragraphs, headings, list items and code', () => {
    const body = '## Head ^b-aaaaaa\nPara one\ncontinues ^b-bbbbbb\n\n- one\n- two ^b-cccccc\n  more\n\n```\ncode\n\nstill code\n```\n';
    const blocks = splitBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'code']);
    expect(blocks[0].id).toBe('b-aaaaaa');
    expect(blocks[1].text).toBe('Para one\ncontinues');
    expect(blocks[2].text).toBe('- one');
    expect(blocks[4].text).toContain('still code');
  });

  it('plans ids for new and duplicated blocks', () => {
    const body = 'one ^b-aaaaaa\n\ntwo ^b-aaaaaa\n\nthree';
    const out = applyEdits(body, planBlockIds(body));
    const ids = splitBlocks(out).map((b) => b.id);
    expect(ids[0]).toBe('b-aaaaaa');
    expect(new Set(ids).size).toBe(3);
    expect(ids.every(Boolean)).toBe(true);
  });

  it('joins blocks back', () => {
    expect(joinBlocks([{ text: 'a', id: 'b-1', kind: 'paragraph' }, { text: '- x', kind: 'list' }, { text: '- y', kind: 'list' }])).toBe('a ^b-1\n\n- x\n- y\n');
  });
});

describe('dates', () => {
  it('parses the spec formats', () => {
    expect(parseDate('1313')?.sort).toBe(1313);
    expect(parseDate('c. 1313')).toMatchObject({ sort: 1313, approximate: true });
    expect(parseDate('~1290')?.sort).toBe(1290);
    expect(parseDate('1313–1320')).toMatchObject({ sort: 1313, end: 1320 });
    expect(parseDate('AD 325')?.sort).toBe(325);
    expect(parseDate('325 BC')?.sort).toBe(-325);
    expect(parseDate('early 4th century')).toMatchObject({ sort: 301, end: 333 });
    expect(parseDate('whenever')).toBeNull();
  });
});
