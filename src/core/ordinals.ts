// Ordinal names for offices: a person whose profile says "Office: Pope" and
// "Number in office: 6" can be written as "the 6th Pope" or "the sixth pope".

const WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const TENS: Record<number, string> = { 2: 'twent', 3: 'thirt', 4: 'fort', 5: 'fift', 6: 'sixt', 7: 'sevent', 8: 'eight', 9: 'ninet' };

export function ordinalSuffix(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "sixth", "twenty-first", up to ninety-ninth; undefined beyond that. */
export function ordinalWord(n: number): string | undefined {
  if (n < 1 || n > 99 || !Number.isInteger(n)) return undefined;
  if (n <= 20) return WORDS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (!ones) return `${TENS[tens]}ieth`;
  return `${TENS[tens]}y-${WORDS[ones]}`;
}

/** Names an office holder can go by: "6th Pope", "Sixth Pope". */
export function officeAliases(office: string, n: number): string[] {
  const o = office.trim().replace(/^@+\[?|\]$/g, '');
  if (!o || !Number.isInteger(n) || n < 1) return [];
  const out = [`${ordinalSuffix(n)} ${o}`];
  const w = ordinalWord(n);
  if (w) out.push(`${w.charAt(0).toUpperCase()}${w.slice(1)} ${o}`);
  return out;
}

/** Aliases generated from an entity's profile fields (office + number in office). */
export function autoAliases(fields: Record<string, unknown> | undefined): string[] {
  if (!fields) return [];
  const n = Number(Array.isArray(fields.succession) ? fields.succession[0] : fields.succession);
  if (!n) return [];
  const offices = (Array.isArray(fields.office) ? fields.office : [fields.office]).filter((x): x is string => typeof x === 'string' && !!x.trim());
  return offices.flatMap((o) => officeAliases(o, n));
}

/** True when a name starts with an ordinal ("6th", "sixth"), so lower-case writing still counts. */
export function startsWithOrdinal(name: string): boolean {
  return /^(\d+(st|nd|rd|th)|([a-z]+-)?(first|second|third|[a-z]+th))\s/i.test(name);
}
