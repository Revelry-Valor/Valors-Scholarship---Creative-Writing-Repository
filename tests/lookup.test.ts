import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/core/vault';
import { canonMentions, cellStance, lookup, parseTerms, quoteFor } from '../src/core/lookup';

let dir: string;
let v: Vault;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lr-look-'));
  v = await Vault.create(path.join(dir, 'Scholarship'), { name: 'Scholarship', pack: 'scholarship', author: 't' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const EUSEBIUS = [
  'Book III',
  'First then must be put the holy quaternion of the Gospels; following them the Acts of the Apostles. After this must be reckoned the epistles of Paul. These then belong among the accepted writings.',
  'Among the disputed writings, which are nevertheless recognized by many, are extant the so-called epistle of James and that of Jude, also the second epistle of Peter.',
  'Among the rejected writings must be reckoned also the Acts of Paul, and the so-called Shepherd, and the Apocalypse of Peter, and in addition to these the extant epistle of Barnabas.',
  'He then turned to other matters entirely, as the churches grew in number.',
].join('\n\n');

const ATHANASIUS = [
  'Again it is not tedious to speak of the books of the New Testament. These are, the four Gospels. Then the Acts of the Apostles and Epistles called Catholic, seven, namely of James one; of Peter, two; of John, three; after these, one of Jude.',
  'There are other books besides these not indeed included in the Canon, but appointed by the Fathers to be read by those who newly join us: the Wisdom of Solomon, and the Wisdom of Sirach, and Esther, and Judith, and Tobit, and that which is called the Teaching of the Apostles, and the Shepherd.',
].join('\n\n');

describe('query terms', () => {
  it('splits words, phrases, exclusions and verses', () => {
    const t = parseTerms('grace "rule of faith" -Marcion Rom 3:23');
    expect(t.include).toEqual(['grace', 'rule of faith']);
    expect(t.exclude).toEqual(['marcion']);
    expect(t.refs[0].label).toBe('Romans 3:23');
  });
});

describe('canon mentions', () => {
  it('reads what a sentence says about each book', () => {
    const text = 'Among the rejected writings must be reckoned the Acts of Paul, and the so-called Shepherd, and the Apocalypse of Peter.';
    const m = canonMentions('b', text);
    expect(m.map((x) => [x.work, x.stance])).toEqual([
      ['ActsPaul', 'rejected'],
      ['Hermas', 'rejected'],
      ['ApocPet', 'rejected'],
    ]);
    const d = canonMentions('b', 'Among the disputed writings, which are nevertheless recognized by many, are the epistle of James and that of Jude.');
    expect(d.map((x) => [x.work, x.stance])).toEqual([
      ['Jas', 'disputed'],
      ['Jude', 'disputed'],
    ]);
  });

  it('counts citations as use', () => {
    const m = canonMentions('b', 'As it says in Heb 11:1, faith is assurance.', [{ book: 'Heb', from: 15, to: 23 }]);
    expect(m[0]).toMatchObject({ work: 'Heb', stance: 'cited' });
  });
});

describe('lookup', () => {
  it('builds a canon table across authors with highlighted paragraphs', async () => {
    await v.importLibrary({ title: 'Church History', text: EUSEBIUS, kind: 'text', author: 'Eusebius' });
    await v.importLibrary({ title: 'Festal Letter 39', text: ATHANASIUS, kind: 'text', author: 'Athanasius' });
    const r = lookup(v, { text: '', concept: 'canon' });
    expect(r.hits.length).toBe(5);
    expect(r.hits.every((h) => h.spans.length > 0)).toBe(true);
    expect(r.hits.some((h) => h.text.startsWith('He then turned'))).toBe(false);
    const t = r.canon!;
    expect(t.columns.map((c) => c.label)).toEqual(['Athanasius', 'Eusebius']);
    const col = (label: string) => t.columns.find((c) => c.label === label)!.key;
    expect(cellStance(t.cells.Hermas[col('Eusebius')])).toBe('rejected');
    expect(cellStance(t.cells.Jas[col('Eusebius')])).toBe('disputed');
    expect(cellStance(t.cells.gospels[col('Eusebius')])).toBe('accepted');
    expect(cellStance(t.cells.Wis[col('Athanasius')])).toBe('read');
    // Context comes with each hit.
    const hit = r.hits.find((h) => h.text.includes('so-called Shepherd'))!;
    expect(hit.before).toContain('disputed writings');
    expect(hit.source.author).toBe('Eusebius');
  });

  it('finds words, phrases and verses, and makes quotes', async () => {
    await v.importLibrary({ title: 'KJV', translation: 'KJV', text: ['Romans 3:23 For all have sinned, and come short of the glory of God;', 'Romans 3:24 Being justified freely by his grace', 'Romans 5:1 Therefore being justified by faith', 'Genesis 1:1 In the beginning', 'Genesis 1:2 And the earth'].join('\n') });
    await v.importLibrary({ title: 'Homily', text: 'All have sinned, as Paul says in Rom 3:23.\n\nGrace is free.', kind: 'text', author: 'Chrysostom' });
    const byRef = lookup(v, { text: 'Rom 3:23' });
    expect(byRef.hits.map((h) => h.source.title).sort()).toEqual(['Homily', 'Romans (KJV)']);
    const words = lookup(v, { text: 'justif* grace', matchAll: true });
    expect(words.hits.map((h) => h.text)).toEqual(['[Rom 3:24] Being justified freely by his grace']);
    expect(quoteFor(v, words.hits[0].blockId)).toBe('> “Being justified freely by his grace” — Romans 3:24 (KJV)');
    const hom = lookup(v, { text: '"have sinned"' }).hits.find((h) => h.source.title === 'Homily')!;
    expect(quoteFor(v, hom.blockId)).toBe('> “All have sinned, as Paul says in Rom 3:23.” — Chrysostom, *Homily*');
  });
});
