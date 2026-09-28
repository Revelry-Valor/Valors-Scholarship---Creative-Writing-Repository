import { describe, expect, it } from 'vitest';
import { importText, parseBible } from '../src/core/importer';

const refLines = ['Genesis 1:1 In the beginning God created the heaven and the earth.', 'Genesis 1:2 And the earth was without form, and void.', 'Genesis 1:3 And God said, Let there be light: and there was light.', 'Gen 1:4 And God saw the light, that it was good.', 'John 1:1 In the beginning was the Word.', 'John 3:16 For God so loved the world.'].join('\n');

describe('library import', () => {
  it('reads Bibles as reference lines, split by book, one verse per paragraph', () => {
    const r = importText({ title: 'KJV', text: refLines, translation: 'KJV' });
    expect(r.kind).toBe('bible');
    expect(r.paragraphs).toBe(6);
    expect(r.files.map((f) => f.name)).toEqual(['01 Genesis', '43 John']);
    expect(r.files[0].body).toContain('## Genesis 1\n\n[Gen 1:1] In the beginning God created');
    expect(r.files[1].frontmatter).toMatchObject({ kind: 'bible', translation: 'KJV', book: 'John' });
  });

  it('reads CSV, TSV, JSON and numbered-verse layouts', () => {
    const csv = 'book,chapter,verse,text\n' + ['Genesis,1,1,"In the beginning, God"', 'Genesis,1,2,And the earth', 'Genesis,1,3,Let there be light', 'Exodus,1,1,Now these are the names', 'Exodus,1,2,Reuben, Simeon'].join('\n');
    expect(parseBible(csv)?.map((v) => `${v.book.id} ${v.chapter}:${v.verse}`)).toEqual(['Gen 1:1', 'Gen 1:2', 'Gen 1:3', 'Exod 1:1', 'Exod 1:2']);
    expect(parseBible(csv)?.[0].text).toBe('In the beginning, God');
    const tsv = ['Rom\t8\t28\tAnd we know', 'Rom\t8\t29\tFor whom he did foreknow', 'Rom\t8\t30\tMoreover whom', 'Rom\t8\t31\tWhat shall we then say', 'Rom\t8\t32\tHe that spared not'].join('\n');
    expect(parseBible(tsv)).toHaveLength(5);
    const json = JSON.stringify([{ abbrev: 'gn', chapters: [['In the beginning', 'And the earth', 'And God said', 'And God saw', 'And God called']] }]);
    expect(parseBible(json)?.[4]).toMatchObject({ chapter: 1, verse: 5, text: 'And God called' });
    const numbered = 'Psalms\nChapter 23\n1 The LORD is my shepherd; I shall not want.\n2 He maketh me to lie down\nin green pastures.\n3 He restoreth my soul.\n4 Yea, though I walk\n5 Thou preparest a table';
    const ps = parseBible(numbered)!;
    expect(ps[1]).toMatchObject({ chapter: 23, verse: 2, text: 'He maketh me to lie down in green pastures.' });
  });

  it('splits ordinary texts into paragraphs and recognises chapter headings', () => {
    const text = 'AGAINST HERESIES\n\nBOOK I\n\nPreface.\nInasmuch as certain men have set the truth aside,\nand bring in lying words.\n\nChapter 1\n\nThey say that in the invisible heights there was a perfect Aeon.';
    const r = importText({ title: 'Against Heresies', text, author: 'Irenaeus' });
    expect(r.kind).toBe('text');
    expect(r.files[0].body).toBe('## AGAINST HERESIES\n\n## BOOK I\n\nPreface. Inasmuch as certain men have set the truth aside, and bring in lying words.\n\n## Chapter 1\n\nThey say that in the invisible heights there was a perfect Aeon.\n');
    expect(r.files[0].frontmatter).toMatchObject({ kind: 'text', author: 'Irenaeus' });
  });
});
