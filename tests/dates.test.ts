import { describe, expect, it } from 'vitest';
import { findDates, formatDateSort, parseDate } from '../src/core/dates';
import { analyzeBlocks } from '../src/core/analysis';
import { NameTable } from '../src/core/names';

const found = (t: string) => findDates(t).map((d) => [d.text, formatDateSort(d.sort)]);

describe('dates in prose', () => {
  it('reads the common ways of writing a date', () => {
    expect(found('The sermon on May 4th 2026 and another on May 4, 2026.')).toEqual([
      ['May 4th 2026', '4 May 2026'],
      ['May 4, 2026', '4 May 2026'],
    ]);
    expect(found('This sermon took place Jan/21/2024')).toEqual([['Jan/21/2024', '21 January 2024']]);
    expect(found('On 4 May 2026, then 2024-01-21, then 1/21/2024 and 21/1/2024.')).toEqual([
      ['4 May 2026', '4 May 2026'],
      ['2024-01-21', '21 January 2024'],
      ['1/21/2024', '21 January 2024'],
      ['21/1/2024', '21 January 2024'],
    ]);
    expect(found('The council opened in 1869 and closed in July 1870.')).toEqual([
      ['in 1869', '1869'],
      ['July 1870', '1 July 1870'],
    ]);
    expect(found('He read 12 books and paid 1500 coins; see p. 1313.')).toEqual([]);
    expect(parseDate('May 4th 2026')?.sort).toBeCloseTo(2026 + 4 / 12 + 3 / 365);
  });

  it('dates a paragraph from the text when no {date:} is given', () => {
    const ctx = { resolver: new NameTable([]), templates: new Map(), relationTypes: new Map(), entityType: () => undefined };
    const [a] = analyzeBlocks([{ text: 'This sermon took place Jan/21/2024.', kind: 'paragraph' } as never], ctx as never);
    expect(a.eventDate).toEqual({ text: 'Jan/21/2024', sort: 2024 + 20 / 365 });
  });
});
