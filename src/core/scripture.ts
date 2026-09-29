// Scripture reference detection (spec 6.1). Recognises references with no markup:
//   John 3:16 · Jn 3.16 · Jhn 3:16 · John 3 v 16 · Rom 8:28-30 · Romans 8:28–30
//   1 Cor 13 · I Corinthians 13 · 1Co 13 · First Corinthians 13 · Gen 1:1; 2:4 · Ps 23:1, 4
//   Matt 5:3ff · v. 17 (after a reference) · cf. Isa 53 · Sir 24:1 · Tobit 4 · 1 Macc 2
// Book names and abbreviations come from the table below (editable in code; spec asks
// for an editable table, which a vault can extend later).

export interface BookDef {
  id: string;
  name: string;
  testament: 'OT' | 'NT' | 'DC';
  chapters: number;
  /** Lowercase names and abbreviations without the leading number. */
  abbr: string[];
  /** 1, 2, 3 for numbered books. */
  number?: number;
}

const B = (id: string, name: string, testament: BookDef['testament'], chapters: number, abbr: string, number?: number): BookDef => ({
  id,
  name,
  testament,
  chapters,
  abbr: abbr.split(' ').filter(Boolean),
  number,
});

export const BOOKS: BookDef[] = [
  B('Gen', 'Genesis', 'OT', 50, 'genesis gen ge gn'),
  B('Exod', 'Exodus', 'OT', 40, 'exodus exod exo ex'),
  B('Lev', 'Leviticus', 'OT', 27, 'leviticus lev le lv'),
  B('Num', 'Numbers', 'OT', 36, 'numbers num nu nm nb'),
  B('Deut', 'Deuteronomy', 'OT', 34, 'deuteronomy deut deu dt'),
  B('Josh', 'Joshua', 'OT', 24, 'joshua josh jos jsh'),
  B('Judg', 'Judges', 'OT', 21, 'judges judg jdg jg jdgs'),
  B('Ruth', 'Ruth', 'OT', 4, 'ruth rth ru'),
  B('1Sam', '1 Samuel', 'OT', 31, 'samuel sam sa sm', 1),
  B('2Sam', '2 Samuel', 'OT', 24, 'samuel sam sa sm', 2),
  B('1Kgs', '1 Kings', 'OT', 22, 'kings kgs ki kin', 1),
  B('2Kgs', '2 Kings', 'OT', 25, 'kings kgs ki kin', 2),
  B('1Chr', '1 Chronicles', 'OT', 29, 'chronicles chron chr ch', 1),
  B('2Chr', '2 Chronicles', 'OT', 36, 'chronicles chron chr ch', 2),
  B('Ezra', 'Ezra', 'OT', 10, 'ezra ezr'),
  B('Neh', 'Nehemiah', 'OT', 13, 'nehemiah neh ne'),
  B('Esth', 'Esther', 'OT', 10, 'esther esth est es'),
  B('Job', 'Job', 'OT', 42, 'job jb'),
  B('Ps', 'Psalms', 'OT', 150, 'psalms psalm pss ps psa psm pslm'),
  B('Prov', 'Proverbs', 'OT', 31, 'proverbs prov pro prv pr'),
  B('Eccl', 'Ecclesiastes', 'OT', 12, 'ecclesiastes eccl eccles ecc ec qoh qoheleth'),
  B('Song', 'Song of Songs', 'OT', 8, 'song of songs song of solomon song songs sos canticles cant ss'),
  B('Isa', 'Isaiah', 'OT', 66, 'isaiah isa is'),
  B('Jer', 'Jeremiah', 'OT', 52, 'jeremiah jer je jr'),
  B('Lam', 'Lamentations', 'OT', 5, 'lamentations lam la'),
  B('Ezek', 'Ezekiel', 'OT', 48, 'ezekiel ezek eze ezk'),
  B('Dan', 'Daniel', 'OT', 12, 'daniel dan da dn'),
  B('Hos', 'Hosea', 'OT', 14, 'hosea hos ho'),
  B('Joel', 'Joel', 'OT', 3, 'joel jl'),
  B('Amos', 'Amos', 'OT', 9, 'amos am'),
  B('Obad', 'Obadiah', 'OT', 1, 'obadiah obad ob'),
  B('Jonah', 'Jonah', 'OT', 4, 'jonah jon jnh'),
  B('Mic', 'Micah', 'OT', 7, 'micah mic mc'),
  B('Nah', 'Nahum', 'OT', 3, 'nahum nah na'),
  B('Hab', 'Habakkuk', 'OT', 3, 'habakkuk hab hb'),
  B('Zeph', 'Zephaniah', 'OT', 3, 'zephaniah zeph zep zp'),
  B('Hag', 'Haggai', 'OT', 2, 'haggai hag hg'),
  B('Zech', 'Zechariah', 'OT', 14, 'zechariah zech zec zc'),
  B('Mal', 'Malachi', 'OT', 4, 'malachi mal ml'),
  B('Matt', 'Matthew', 'NT', 28, 'matthew matt mat mt'),
  B('Mark', 'Mark', 'NT', 16, 'mark mrk mar mk mr'),
  B('Luke', 'Luke', 'NT', 24, 'luke luk lk'),
  B('John', 'John', 'NT', 21, 'john joh jhn jn'),
  B('Acts', 'Acts', 'NT', 28, 'acts act ac'),
  B('Rom', 'Romans', 'NT', 16, 'romans rom ro rm'),
  B('1Cor', '1 Corinthians', 'NT', 16, 'corinthians cor co', 1),
  B('2Cor', '2 Corinthians', 'NT', 13, 'corinthians cor co', 2),
  B('Gal', 'Galatians', 'NT', 6, 'galatians gal ga'),
  B('Eph', 'Ephesians', 'NT', 6, 'ephesians eph ephes'),
  B('Phil', 'Philippians', 'NT', 4, 'philippians phil php pp'),
  B('Col', 'Colossians', 'NT', 4, 'colossians col'),
  B('1Thess', '1 Thessalonians', 'NT', 5, 'thessalonians thess thes th', 1),
  B('2Thess', '2 Thessalonians', 'NT', 3, 'thessalonians thess thes th', 2),
  B('1Tim', '1 Timothy', 'NT', 6, 'timothy tim ti', 1),
  B('2Tim', '2 Timothy', 'NT', 4, 'timothy tim ti', 2),
  B('Titus', 'Titus', 'NT', 3, 'titus tit'),
  B('Phlm', 'Philemon', 'NT', 1, 'philemon philem phlm phm'),
  B('Heb', 'Hebrews', 'NT', 13, 'hebrews heb'),
  B('Jas', 'James', 'NT', 5, 'james jas jm'),
  B('1Pet', '1 Peter', 'NT', 5, 'peter pet pe pt', 1),
  B('2Pet', '2 Peter', 'NT', 3, 'peter pet pe pt', 2),
  B('1John', '1 John', 'NT', 5, 'john jn jhn joh', 1),
  B('2John', '2 John', 'NT', 1, 'john jn jhn joh', 2),
  B('3John', '3 John', 'NT', 1, 'john jn jhn joh', 3),
  B('Jude', 'Jude', 'NT', 1, 'jude jud jd'),
  B('Rev', 'Revelation', 'NT', 22, 'revelation rev re apocalypse apoc'),
  // Deuterocanonical / Apocrypha
  B('Tob', 'Tobit', 'DC', 14, 'tobit tob tb'),
  B('Jdt', 'Judith', 'DC', 16, 'judith jdt jdth'),
  B('AddEsth', 'Additions to Esther', 'DC', 16, 'additions to esther add esth addesth'),
  B('Wis', 'Wisdom of Solomon', 'DC', 19, 'wisdom of solomon wisdom wis ws'),
  B('Sir', 'Sirach', 'DC', 51, 'sirach sir ecclesiasticus ecclus'),
  B('Bar', 'Baruch', 'DC', 6, 'baruch bar'),
  B('EpJer', 'Letter of Jeremiah', 'DC', 1, 'letter of jeremiah epistle of jeremiah epjer ljer'),
  B('PrAzar', 'Prayer of Azariah', 'DC', 1, 'prayer of azariah song of the three praz'),
  B('Sus', 'Susanna', 'DC', 1, 'susanna sus'),
  B('Bel', 'Bel and the Dragon', 'DC', 1, 'bel and the dragon bel'),
  B('1Macc', '1 Maccabees', 'DC', 16, 'maccabees macc mac ma', 1),
  B('2Macc', '2 Maccabees', 'DC', 15, 'maccabees macc mac ma', 2),
  B('3Macc', '3 Maccabees', 'DC', 7, 'maccabees macc mac', 3),
  B('4Macc', '4 Maccabees', 'DC', 18, 'maccabees macc mac', 4),
  B('1Esd', '1 Esdras', 'DC', 9, 'esdras esd', 1),
  B('2Esd', '2 Esdras', 'DC', 16, 'esdras esd', 2),
  B('PrMan', 'Prayer of Manasseh', 'DC', 1, 'prayer of manasseh prayer of manasses prman'),
];

/**
 * Books and early writings whose place in the canon was discussed by early writers.
 * Used by the research lookup's "canon" expansion (not references with chapters).
 */
export const DISPUTED_WRITINGS: string[] = [
  'Shepherd of Hermas',
  'Hermas',
  'Didache',
  'Teaching of the Twelve Apostles',
  'Epistle of Barnabas',
  'Barnabas',
  '1 Clement',
  'First Epistle of Clement',
  'Apocalypse of Peter',
  'Gospel of Peter',
  'Gospel of Thomas',
  'Gospel of the Hebrews',
  'Acts of Paul',
  'Wisdom of Solomon',
  'Sirach',
  'Ecclesiasticus',
  'Tobit',
  'Judith',
  'Maccabees',
  'Baruch',
  'Hebrews',
  'James',
  'Jude',
  '2 Peter',
  '2 John',
  '3 John',
  'Revelation',
  'Apocalypse of John',
];

export interface ScriptureRef {
  from: number;
  to: number;
  book: string;
  bookName: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  /** Cross-chapter range: Gen 1:1–2:3. */
  chapterEnd?: number;
  /** "ff": to the end of the passage. */
  onward?: boolean;
  /** Preceded by "cf." / "see" / "compare". */
  compare: boolean;
  /** Follows a quotation in the same sentence. */
  quoted: boolean;
  /** Normalised form, e.g. "Romans 8:28–30". */
  label: string;
}

// name/abbreviation → books (numbered books share names: "cor" → 1Cor, 2Cor)
const LOOKUP = new Map<string, BookDef[]>();
for (const b of BOOKS) {
  for (const a of b.abbr) {
    if (!LOOKUP.has(a)) LOOKUP.set(a, []);
    LOOKUP.get(a)!.push(b);
  }
}
const NAMES_BY_LENGTH = [...LOOKUP.keys()].sort((a, b) => b.length - a.length);
// Short abbreviations that are also ordinary words: only count them with a chapter:verse.
const AMBIGUOUS = new Set(['is', 'am', 'mark', 'job', 'song', 'ex', 'ac', 'act', 'acts', 'ho', 'na', 'pp', 'ss', 'la', 'je', 'jon', 'hab', 'col', 'eph', 'gal', 'sir', 'bar', 'bel', 'sus', 'dan', 'ruth', 'numbers', 'es', 'ti', 'th', 'pe', 'pt', 'ch', 'co', 'ma', 'mac', 'tit', 'ob', 'am', 'ge', 'le', 'nu', 'de', 're', 'ro', 'mr', 'jb', 'tb', 'ws']);

const ORDINALS: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, i: 1, ii: 2, iii: 3, iv: 4, first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

function makeLabel(r: Omit<ScriptureRef, 'label' | 'from' | 'to' | 'compare' | 'quoted'>): string {
  let s = `${r.bookName} ${r.chapter}`;
  if (r.verseStart !== undefined) s += `:${r.verseStart}`;
  if (r.chapterEnd !== undefined) s += `–${r.chapterEnd}:${r.verseEnd}`;
  else if (r.verseEnd !== undefined && r.verseEnd !== r.verseStart) s += `–${r.verseEnd}`;
  if (r.onward) s += 'ff';
  return s;
}

const WORD = /[\p{L}]/u;

/** Find every scripture reference in a text. */
export function findScriptureRefs(text: string): ScriptureRef[] {
  const out: ScriptureRef[] = [];
  const lower = text.toLowerCase();
  let last: ScriptureRef | null = null;
  let i = 0;
  while (i < text.length) {
    // Continuations after a reference: "; 2:4", ", 4", "; 15:3", " v. 17"
    if (last && i === last.to) {
      const cont = /^(\s*[;,]?\s*(?:and\s+)?vv?\.\s*|\s*[;,]\s*|\s+(?:and|&)\s+)(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?(?:\s*[-–—]\s*(\d{1,3}))?(ff)?/.exec(text.slice(i));
      // "Tobit 4 and 1 Macc 2": a number followed by a book name starts a new reference.
      const startsNewRef = cont && /^\s+[A-Za-z]/.test(text.slice(i + cont[0].length)) && readRef(text, text.toLowerCase(), i + cont[1].length) !== null;
      const andWithoutVerse = cont && /^\s+(?:and|&)\s+$/.test(cont[1]) && cont[3] === undefined;
      if (cont && !startsNewRef && !andWithoutVerse) {
        const a = Number(cont[2]);
        const hasColon = cont[3] !== undefined;
        const vv = /v/.test(cont[1]);
        let chapter = last.chapter;
        let verseStart: number | undefined;
        if (hasColon && !vv) {
          chapter = a;
          verseStart = Number(cont[3]);
        } else if (last.verseStart !== undefined || vv) {
          verseStart = a;
        } else {
          chapter = a; // "1 Cor 13; 15" → chapter 15
        }
        const verseEnd = cont[4] ? Number(cont[4]) : undefined;
        const book = BOOKS.find((b) => b.id === last!.book)!;
        if (chapter >= 1 && chapter <= book.chapters) {
          const ref: ScriptureRef = {
            from: i + cont[1].length,
            to: i + cont[0].length,
            book: book.id,
            bookName: book.name,
            chapter,
            verseStart,
            verseEnd,
            onward: !!cont[5],
            compare: last.compare,
            quoted: last.quoted,
            label: '',
          };
          ref.label = makeLabel(ref);
          out.push(ref);
          last = ref;
          i = ref.to;
          continue;
        }
      }
    }
    const ch = text[i];
    // A reference starts at a word boundary with a number prefix or a letter.
    if ((i > 0 && WORD.test(text[i - 1])) || !(WORD.test(ch) || /[1-4]/.test(ch))) {
      i++;
      continue;
    }
    const ref = readRef(text, lower, i);
    if (ref) {
      const before = text.slice(Math.max(0, i - 12), i);
      ref.compare = /\b(cf|see|compare|comp)\.?\s*$/i.test(before);
      const sentence = text.slice(Math.max(0, text.lastIndexOf('.', i - 1) + 1), i);
      ref.quoted = /["”’]\s*\(?\s*$/.test(sentence.slice(-6)) || /["“][^"”]{3,}["”]/.test(sentence.slice(-160));
      out.push(ref);
      last = ref;
      i = ref.to;
      continue;
    }
    last = null;
    i++;
  }
  return out;
}

function readRef(text: string, lower: string, i: number): ScriptureRef | null {
  let j = i;
  let number: number | undefined;
  // Leading ordinal: 1, 2, I, II, First, 1st
  // Words and Roman numerals need a space after them ("I Cor", not "Isa"); digits may touch ("1Co").
  const ord = /^(?:(first|second|third|fourth|1st|2nd|3rd|4th|iii|ii|iv|i)\s+|([1-4])\s*)/i.exec(text.slice(j));
  if (ord) ord[1] = ord[1] ?? ord[2];
  if (ord && ORDINALS[ord[1].toLowerCase()] !== undefined) {
    const rest = lower.slice(j + ord[0].length);
    if (NAMES_BY_LENGTH.some((n) => rest.startsWith(n) && LOOKUP.get(n)!.some((b) => b.number))) {
      number = ORDINALS[ord[1].toLowerCase()];
      j += ord[0].length;
    }
  }
  if (!WORD.test(text[j] ?? '')) return null;
  const rest = lower.slice(j);
  const name = NAMES_BY_LENGTH.find((n) => rest.startsWith(n) && !WORD.test(rest[n.length] ?? ''));
  if (!name) return null;
  const candidates = LOOKUP.get(name)!.filter((b) => (number ? b.number === number : !b.number));
  if (!candidates.length) return null;
  const book = candidates[0];
  // Book names start with a capital (or follow a number): "is 53" is not Isaiah.
  if (!number && text[j] !== text[j].toUpperCase()) return null;
  j += name.length;
  if (text[j] === '.') j++;
  // Chapter, optional verse: "3:16", "3.16", "3 v 16", "3", "8:28-30", "1:1–2:3", "5:3ff"
  const m = /^\s*(\d{1,3})(?:\s*(?::|\.(?=\d)|\s+v\.?\s*|\s+verses?\s+)(\d{1,3}))?(?:\s*[-–—]\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?)?(ff)?/.exec(text.slice(j));
  if (!m) return null;
  const chapter = Number(m[1]);
  if (chapter < 1 || chapter > book.chapters) return null;
  const verseStart = m[2] !== undefined ? Number(m[2]) : undefined;
  if (AMBIGUOUS.has(name) && !number && verseStart === undefined) return null;
  let verseEnd: number | undefined;
  let chapterEnd: number | undefined;
  if (m[3] !== undefined) {
    if (m[4] !== undefined && verseStart !== undefined) {
      chapterEnd = Number(m[3]);
      verseEnd = Number(m[4]);
    } else if (verseStart !== undefined) verseEnd = Number(m[3]);
    else chapterEnd = Number(m[3]); // "Gen 1–3": chapters
  }
  const partial = { book: book.id, bookName: book.name, chapter, verseStart, verseEnd, chapterEnd, onward: !!m[5] };
  // Don't swallow trailing punctuation.
  let end = j + m[0].length;
  while (end > j && /[\s.]/.test(text[end - 1])) end--;
  return { ...partial, from: i, to: end, compare: false, quoted: false, label: makeLabel(partial) };
}

/** Does a reference include a given verse (or chapter, when verse is undefined)? */
export function refCovers(r: Pick<ScriptureRef, 'book' | 'chapter' | 'verseStart' | 'verseEnd' | 'chapterEnd' | 'onward'>, book: string, chapter: number, verse?: number): boolean {
  if (r.book !== book) return false;
  const lastChapter = r.chapterEnd ?? r.chapter;
  if (chapter < r.chapter || chapter > lastChapter) return false;
  if (verse === undefined || r.verseStart === undefined) return true;
  if (r.onward) return chapter > r.chapter || verse >= r.verseStart;
  if (r.chapterEnd !== undefined) {
    if (chapter === r.chapter) return verse >= r.verseStart;
    if (chapter === r.chapterEnd) return verse <= (r.verseEnd ?? verse);
    return true;
  }
  return verse >= r.verseStart && verse <= (r.verseEnd ?? r.verseStart);
}

export function bookById(id: string): BookDef | undefined {
  return BOOKS.find((b) => b.id === id);
}

/** Parse a single typed reference ("Acts 2:38", "1 Cor 13") for lookups. */
export function parseRef(text: string): ScriptureRef | null {
  return findScriptureRefs(text.trim())[0] ?? null;
}
