// Date parsing (spec 4.2 rules): store both the text typed and a sortable value.
// Accepts 1313, c. 1313, ~1313, 1313–1320, early 4th century, AD 325, 325 BC.
// Fantasy calendars (spec 11) plug in later through `calendar`.

export interface ParsedDate {
  text: string;
  /** Sortable value: years as a decimal, BC negative. */
  sort: number;
  /** Range end for spans and centuries. */
  end?: number;
  approximate: boolean;
}

const ORDINAL = /^(\d+)(?:st|nd|rd|th)$/i;

export function parseDate(input: string): ParsedDate | null {
  const text = input.trim();
  if (!text) return null;
  let s = text.toLowerCase().replace(/\s+/g, ' ');
  let approximate = false;

  const approx = /^(c\.|ca\.|circa|~|about|around)\s*/.exec(s);
  if (approx) {
    approximate = true;
    s = s.slice(approx[0].length);
  }

  let sign = 1;
  if (/\b(bc|bce)\b\.?$/.test(s)) {
    sign = -1;
    s = s.replace(/\s*\b(bc|bce)\b\.?$/, '');
  }
  s = s.replace(/^(ad|ce)\s+/, '').replace(/\s+(ad|ce)$/, '');

  // Centuries: "early 4th century", "4th century", "mid 12th c."
  const cent = /^(early|mid|middle|late)?\s*-?\s*(\d+(?:st|nd|rd|th))\s*(century|cent\.?|c\.)$/.exec(s);
  if (cent) {
    const n = Number(ORDINAL.exec(cent[2])![1]);
    let start = (n - 1) * 100 + 1;
    let end = n * 100;
    if (cent[1] === 'early') end = start + 32;
    else if (cent[1] === 'mid' || cent[1] === 'middle') {
      start += 33;
      end = start + 33;
    } else if (cent[1] === 'late') start = end - 32;
    if (sign < 0) [start, end] = [-end, -start];
    return { text, sort: start, end, approximate: true };
  }

  // Ranges: 1313-1320, 1313–1320, 1313 to 1320
  const range = /^(\d{1,5})\s*(?:-|–|—|to)\s*(\d{1,5})$/.exec(s);
  if (range) {
    let a = Number(range[1]);
    let b = Number(range[2]);
    if (range[2].length < range[1].length) {
      // 1313-20 → 1320
      const prefix = range[1].slice(0, range[1].length - range[2].length);
      b = Number(prefix + range[2]);
    }
    if (sign < 0) [a, b] = [-a, -b];
    return { text, sort: Math.min(a, b), end: Math.max(a, b), approximate };
  }

  // ISO-ish: 1313-05-02
  const iso = /^(\d{1,5})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (iso) {
    const y = Number(iso[1]) * sign;
    const m = Number(iso[2]);
    const d = iso[3] ? Number(iso[3]) : 1;
    return { text, sort: y + (m - 1) / 12 + (d - 1) / 365, approximate };
  }

  const prose = findDates(text).find((d) => d.from === 0 && d.to === text.length);
  if (prose) return { text, sort: prose.sort * sign, approximate };

  const year = /^(\d{1,5})\??$/.exec(s);
  if (year) return { text, sort: Number(year[1]) * sign, approximate: approximate || s.endsWith('?') };

  return null;
}

export function formatSort(sort: number): string {
  const y = Math.floor(sort);
  return y < 0 ? `${-y} BC` : `${y}`;
}

// ---------------------------------------------------------------- dates written in prose

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(\\d{3,4})';

const sortOf = (y: number, m: number, d: number) => y + (m - 1) / 12 + (d - 1) / 365;
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1 && y <= 2999;

export interface FoundDate extends ParsedDate {
  from: number;
  to: number;
}

const PATTERNS: Array<{ re: RegExp; get: (m: RegExpExecArray) => [number, number, number] | null }> = [
  // May 4th 2026 · May 4, 2026 · Jan. 21st, 2024
  { re: new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+${YEAR}\\b`, 'gi'), get: (m) => [Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])] },
  // 4 May 2026 · 4th of May, 2026
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH},?\\s+${YEAR}\\b`, 'gi'), get: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])] },
  // Jan/21/2024 · Jan-21-2024 · 21/Jan/2024
  { re: new RegExp(`\\b${MONTH}[/.-]${DAY}[/.-]${YEAR}\\b`, 'gi'), get: (m) => [Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])] },
  { re: new RegExp(`\\b${DAY}[/.-]${MONTH}[/.-]${YEAR}\\b`, 'gi'), get: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])] },
  // 2024-01-21 · 2024/01/21
  { re: /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/g, get: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 1/21/2024 (month first, as in the US) · 21/1/2024 when the first number cannot be a month
  {
    re: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g,
    get: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      return a > 12 ? [Number(m[3]), b, a] : [Number(m[3]), a, b];
    },
  },
  // May 2026 · in May of 2026
  { re: new RegExp(`\\b${MONTH}\\s+(?:of\\s+)?${YEAR}\\b`, 'gi'), get: (m) => [Number(m[2]), MONTHS[m[1].toLowerCase()], 1] },
  // in 1870 · during 1914 · AD 325 · c. 1313 (a bare number alone is too often not a year)
  { re: /\b(?:in|during|around|circa|c\.|ca\.|AD|A\.D\.)\s+(?:the\s+year\s+)?(\d{3,4})(?!\s*(?:BC|B\.C\.|BCE|%|[:.,]\d))\b/gi, get: (m) => [Number(m[1]), 1, 1] },
];

/** Dates written out in ordinary text: "May 4th 2026", "Jan/21/2024", "4 May 2026", "in 1870". */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (let m; (m = p.re.exec(text)); ) {
      const from = m.index;
      const to = from + m[0].length;
      if (out.some((d) => from < d.to && to > d.from)) continue;
      const got = p.get(m);
      if (!got || !valid(...got)) continue;
      const [y, mo, d] = got;
      out.push({ from, to, text: m[0], sort: sortOf(y, mo, d), approximate: false });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** "4 May 2026" from a sortable value (whole years print as the year). */
export function formatDateSort(sort: number): string {
  const y = Math.floor(sort);
  const rest = sort - y;
  const yearText = y < 0 ? `${-y} BC` : `${y}`;
  if (rest < 1e-6) return yearText;
  const m = Math.floor(rest * 12 + 1e-6);
  const d = Math.round((rest - m / 12) * 365) + 1;
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${names[m]} ${yearText}`;
}
