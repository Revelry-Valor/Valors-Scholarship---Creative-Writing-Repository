import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { lexKey, lexicalWords, parseLexicon } from '../src/core/lexicon';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-lex-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('lexicon parsing', () => {
  it('normalises accents, breathings, final sigma and Hebrew points', () => {
    expect(lexKey('λόγος')).toBe(lexKey('ΛΟΓΟΣ'));
    expect(lexKey('ἀγάπη')).toBe('αγαπη');
    expect(lexKey('חֶסֶד')).toBe('חסד');
  });

  it('reads a TSV with a header', () => {
    const e = parseLexicon('Strong\tGreek\tTranslit\tGloss\tDefinition\nG3056\tλόγος\tlogos\tword\ta word, speech, reason\nG26\tἀγάπη\tagapē\tlove\tlove, goodwill\nG5485\tχάρις\tcharis\tgrace\tgrace, favour, kindness');
    expect(e[0]).toEqual({ strong: 'G3056', lemma: 'λόγος', translit: 'logos', gloss: 'word', def: 'a word, speech, reason' });
  });

  it('reads STEPBible-style rows after notes, without a header', () => {
    const text = ['TBESG - Translators Brief lexicon of Extended Strongs for Greek', 'Notes about the file.', '', 'G0025\tG0025 =\tG0025\tἀγαπάω\tagapaō\tG:V\tto love\tto love, value, esteem', 'G0026\tG0026 =\tG0026\tἀγάπη, -ης, ἡ\tagapē\tG:N-F\tlove\tlove, goodwill', 'G3056\tG3056 =\tG3056\tλόγος, -ου, ὁ\tlogos\tG:N-M\tword\ta word, speech, account'].join('\n');
    const e = parseLexicon(text);
    expect(e).toHaveLength(3);
    expect(e[1]).toMatchObject({ strong: 'G26', lemma: 'ἀγάπη', translit: 'agapē' });
    expect(e[1].def).toContain('goodwill');
  });

  it('reads JSON keyed by Strong’s number and plain lines', () => {
    const j = parseLexicon('var d = {"G3056":{"lemma":"λόγος","translit":"lógos","strongs_def":" something said","kjv_def":"word, saying"}};');
    expect(j[0]).toMatchObject({ strong: 'G3056', lemma: 'λόγος', translit: 'lógos' });
    const p = parseLexicon('λόγος (logos) — word; speech\nχάρις — grace, favour\nπίστις — faith, trust');
    expect(p[0]).toMatchObject({ lemma: 'λόγος', translit: 'logos', gloss: 'word' });
  });

  it('finds Greek and Hebrew words and Strong’s numbers in text', () => {
    expect(lexicalWords('The word λόγος (G3056) and חֶסֶד.').map((w) => w.word)).toEqual(['λόγος', 'G3056', 'חֶסֶד']);
  });
});

describe('lexicons in a project', () => {
  it('imports, looks up by form, transliteration, Strong’s and English, and survives reopening', async () => {
    const r = await v.importLexicon({ name: 'Mini Greek', text: 'Strong\tGreek\tTranslit\tGloss\tDefinition\nG3056\tλόγος\tlogos\tword\ta word, speech, reason\nG26\tἀγάπη\tagapē\tlove\tlove, goodwill\nG5485\tχάρις\tcharis\tgrace\tgrace, favour, kindness' });
    expect(r).toMatchObject({ language: 'greek', count: 3 });
    expect((await v.lexiconLookup('λογος'))[0].lemma).toBe('λόγος');
    expect((await v.lexiconLookup('λόγου'))[0].lemma).toBe('λόγος'); // an inflected form
    expect((await v.lexiconLookup('agape'))[0].lemma).toBe('ἀγάπη');
    expect((await v.lexiconLookup('G5485'))[0]).toMatchObject({ lemma: 'χάρις', match: 'strong' });
    expect((await v.lexiconLookup('favour'))[0].lemma).toBe('χάρις');
    const words = await v.lexiconWords(['χάριτι', 'G26', 'ὕδωρ']);
    expect(words['G26']?.gloss).toBe('love');
    expect(words['ὕδωρ']).toBeNull();
    const v2 = await Vault.open(v.root, { author: 't' });
    expect(await v2.listLexicons()).toMatchObject([{ name: 'Mini Greek', count: 3, language: 'greek' }]);
  });

  it('handles a large lexicon quickly', async () => {
    const rows = ['Strong\tGreek\tGloss\tDefinition'];
    const alpha = 'αβγδεζηθικλμνξοπρστυφχψω';
    for (let i = 1; i <= 20000; i++) rows.push(`G${i}\t${alpha[i % 24]}${alpha[(i >> 3) % 24]}${alpha[(i >> 6) % 24]}${alpha[(i >> 9) % 24]}ος\tword ${i}\t${'a long definition '.repeat(20)}${i}`);
    let t = Date.now();
    await v.importLexicon({ name: 'Big', text: rows.join('\n') });
    const importMs = Date.now() - t;
    t = Date.now();
    await v.lexiconLookup('G12345');
    const firstMs = Date.now() - t;
    t = Date.now();
    for (let i = 0; i < 50; i++) await v.lexiconLookup(`G${i * 300 + 1}`);
    const lookupMs = (Date.now() - t) / 50;
    expect(importMs).toBeLessThan(5000);
    expect(firstMs).toBeLessThan(3000);
    expect(lookupMs).toBeLessThan(50);
  });
});
