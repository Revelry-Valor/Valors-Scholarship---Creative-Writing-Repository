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

  const year = /^(\d{1,5})\??$/.exec(s);
  if (year) return { text, sort: Number(year[1]) * sign, approximate: approximate || s.endsWith('?') };

  return null;
}

export function formatSort(sort: number): string {
  const y = Math.floor(sort);
  return y < 0 ? `${-y} BC` : `${y}`;
}
