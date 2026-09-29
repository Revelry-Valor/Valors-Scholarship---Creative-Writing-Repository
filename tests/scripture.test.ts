// Spec 6.1 reference detection table, plus T2–T5.
import { describe, expect, it } from 'vitest';
import { findScriptureRefs, refCovers } from '../src/core/scripture';

const labels = (t: string) => findScriptureRefs(t).map((r) => r.label);

describe('scripture references', () => {
  it('normalises the spec examples', () => {
    for (const t of ['John 3:16', 'Jn 3.16', 'Jhn 3:16', 'John 3 v 16']) expect(labels(t)).toEqual(['John 3:16']);
    expect(labels('Rom 8:28-30')).toEqual(['Romans 8:28–30']);
    expect(labels('Romans 8:28–30')).toEqual(['Romans 8:28–30']);
    for (const t of ['1 Cor 13', 'I Corinthians 13', '1Co 13', 'First Corinthians 13']) expect(labels(t)).toEqual(['1 Corinthians 13']);
    expect(labels('Gen 1:1; 2:4')).toEqual(['Genesis 1:1', 'Genesis 2:4']);
    expect(labels('Ps 23:1, 4')).toEqual(['Psalms 23:1', 'Psalms 23:4']);
    expect(labels('Matt 5:3ff')).toEqual(['Matthew 5:3ff']);
    expect(labels('Sir 24:1 and Tobit 4 and 1 Macc 2')).toEqual(['Sirach 24:1', 'Tobit 4', '1 Maccabees 2']);
    expect(labels('I Cor 13; 15:3')).toEqual(['1 Corinthians 13', '1 Corinthians 15:3']);
  });

  it('marks "cf." as compare and references after a quotation as quoted', () => {
    const [cf] = findScriptureRefs('grace precedes repentance (cf. Isa 53)');
    expect(cf).toMatchObject({ label: 'Isaiah 53', compare: true });
    const [q] = findScriptureRefs('"For by grace you have been saved" (Eph 2:8)');
    expect(q).toMatchObject({ label: 'Ephesians 2:8', quoted: true });
  });

  it('reads "v. 17" after a reference as the same chapter', () => {
    expect(labels('John 3:16, and v. 17 says')).toEqual(['John 3:16', 'John 3:17']);
  });

  it('does not mistake ordinary words for books', () => {
    expect(labels('This is 5 times better. I am 3 years old. Mark 3 people.')).toEqual([]);
    expect(labels('He wrote in 1313 about grace.')).toEqual([]);
    expect(labels('Genesis 99:1')).toEqual([]); // no such chapter
  });

  it('knows which verses a reference covers', () => {
    const [r] = findScriptureRefs('Rom 8:28-30');
    expect([27, 28, 29, 30, 31].map((v) => refCovers(r, 'Rom', 8, v))).toEqual([false, true, true, true, false]);
    const [ch] = findScriptureRefs('1 Cor 13');
    expect(refCovers(ch, '1Cor', 13, 4)).toBe(true);
  });
});
