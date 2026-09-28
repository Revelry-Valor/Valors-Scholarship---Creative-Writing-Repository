// Autocorrect, the way word processors do it: fix a word when you finish it
// (space or punctuation), and let one Ctrl+Z undo the fix. Pure logic, tested.

export interface AutocorrectPrefs {
  enabled: boolean;
  capitalizeSentences: boolean;
  fixTwoCapitals: boolean;
  /** Your own replacements, e.g. { "jc": "Jesus Christ" }. Checked before the built-in list. */
  custom: Record<string, string>;
}

export const DEFAULT_AUTOCORRECT: AutocorrectPrefs = { enabled: true, capitalizeSentences: true, fixTwoCapitals: true, custom: {} };

/** Common misspellings, including ones frequent in theology and history writing. */
export const BUILT_IN: Record<string, string> = {
  teh: 'the', hte: 'the', adn: 'and', nad: 'and', taht: 'that', thta: 'that', jsut: 'just', waht: 'what', wiht: 'with', whcih: 'which', wich: 'which',
  recieve: 'receive', recieved: 'received', beleive: 'believe', beleived: 'believed', belive: 'believe', acheive: 'achieve', thier: 'their', freind: 'friend',
  occured: 'occurred', occuring: 'occurring', occurence: 'occurrence', seperate: 'separate', seperated: 'separated', definately: 'definitely', definatly: 'definitely',
  becuase: 'because', becasue: 'because', untill: 'until', begining: 'beginning', goverment: 'government', accross: 'across', apparant: 'apparent', arguement: 'argument',
  cemetary: 'cemetery', comming: 'coming', commited: 'committed', completly: 'completely', concious: 'conscious', embarass: 'embarrass', existance: 'existence',
  foriegn: 'foreign', grammer: 'grammar', independant: 'independent', knowlege: 'knowledge', millenium: 'millennium', neccessary: 'necessary', necesary: 'necessary',
  noticable: 'noticeable', occassion: 'occasion', persue: 'pursue', posession: 'possession', prefered: 'preferred', reccomend: 'recommend', recomend: 'recommend',
  refered: 'referred', relevent: 'relevant', religous: 'religious', succesful: 'successful', tommorow: 'tomorrow', truely: 'truly', wierd: 'weird', writting: 'writing',
  alot: 'a lot', dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", wasnt: "wasn't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't",
  cant: "can't", thats: "that's", theres: "there's", youre: "you're", im: "I'm", ive: "I've",
  // theology, church history and biblical studies
  diciple: 'disciple', desciple: 'disciple', disiple: 'disciple', diciples: 'disciples', desciples: 'disciples', apostels: 'apostles', apostel: 'apostle',
  baptisim: 'baptism', baptised: 'baptized', phariseees: 'Pharisees', pharisses: 'Pharisees', sadducees: 'Sadducees', beatitudes: 'Beatitudes',
  prophesies: 'prophecies', annoint: 'anoint', annointed: 'anointed', resurection: 'resurrection', ressurection: 'resurrection', crucifiction: 'crucifixion',
  cannonical: 'canonical', cannonized: 'canonized', apocraphya: 'Apocrypha', apocrypa: 'Apocrypha', diety: 'deity', dieties: 'deities', heresey: 'heresy',
  heretcal: 'heretical', orthadox: 'orthodox', athanasuis: 'Athanasius', augustin: 'Augustine', eusibius: 'Eusebius', eusebeus: 'Eusebius', iraneus: 'Irenaeus',
  ireneaus: 'Irenaeus', tertulian: 'Tertullian', septuigint: 'Septuagint', septuagent: 'Septuagint', deuteronomy: 'Deuteronomy',
  leviticus: 'Leviticus', genisis: 'Genesis', exodous: 'Exodus', eclesiastes: 'Ecclesiastes', ecclesiasties: 'Ecclesiastes',
  phillipians: 'Philippians', philipians: 'Philippians', collosians: 'Colossians', colosians: 'Colossians', thessalonains: 'Thessalonians', galations: 'Galatians',
  ephesains: 'Ephesians', corinthains: 'Corinthians', habbakuk: 'Habakkuk', habakuk: 'Habakkuk', zechariahh: 'Zechariah', mathew: 'Matthew', sacrifical: 'sacrificial',
  covanent: 'covenant', convenant: 'covenant', tabernackle: 'tabernacle', messianc: 'messianic', messaih: 'Messiah', messiha: 'Messiah', jeruselem: 'Jerusalem',
  jerusalam: 'Jerusalem', isreal: 'Israel', isrealites: 'Israelites', galilea: 'Galilee', nazereth: 'Nazareth', bethleham: 'Bethlehem', bethlehm: 'Bethlehem',
};

export interface Correction {
  /** Replace [from, to) of the word with `insert`. */
  from: number;
  to: number;
  insert: string;
  reason: string;
}

const WORD_BEFORE = /([\p{L}\p{N}'’]+)$/u;

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase() && replacement[0] === replacement[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Given the text of a line up to the cursor (the word just finished), return the
 * correction to make, if any. `lineStart` is the document offset of the line.
 * `isName(word)` says whether a word is part of an entity name (never touched).
 */
export function correctionFor(lineBefore: string, lineStart: number, prefs: AutocorrectPrefs, isName: (w: string) => boolean = () => false): Correction | null {
  if (!prefs.enabled) return null;
  const m = WORD_BEFORE.exec(lineBefore);
  if (!m) return null;
  const word = m[1];
  const at = lineBefore.length - word.length;
  const prev = lineBefore[at - 1] ?? '';
  // Never touch markup: tags, topics, facts, relations, notes, code, links, ids.
  if (/[@#{>%`\[\\^|:=!\/]/.test(prev)) return null;
  const opens = (lineBefore.match(/\{/g) ?? []).length - (lineBefore.match(/\}/g) ?? []).length;
  if (opens > 0 || (lineBefore.match(/`/g) ?? []).length % 2 === 1 || (lineBefore.match(/%%/g) ?? []).length % 2 === 1) return null;
  if (/https?:\/\/\S*$/.test(lineBefore)) return null;
  if (isName(word)) return null;

  const from = lineStart + at;
  const to = lineStart + lineBefore.length;
  const lower = word.toLowerCase().replace(/’/g, "'");

  const custom = Object.entries(prefs.custom).find(([k]) => k.toLowerCase() === lower)?.[1];
  const fix = custom ?? BUILT_IN[lower];
  if (fix && fix !== word) {
    // Built-in entries keep your capitalisation; custom ones are used exactly as written.
    const insert = custom ? custom : fix === fix.toLowerCase() ? matchCase(word, fix) : fix;
    if (insert !== word) {
      // A fixed word at the start of a sentence still gets its capital ("teh" → "The").
      const cap = prefs.capitalizeSentences && startsSentence(lineBefore.slice(0, at)) && /^\p{Ll}/u.test(insert) ? insert[0].toUpperCase() + insert.slice(1) : insert;
      return { from, to, insert: cap, reason: `${word} → ${cap}` };
    }
  }
  if (lower === 'i' && word === 'i') return { from, to, insert: 'I', reason: 'i → I' };
  if (/^i['’](m|ve|d|ll)$/.test(word)) return { from, to, insert: `I${word.slice(1)}`, reason: `${word} → I${word.slice(1)}` };

  // "THe" → "The", but leave plural acronyms like "IDs" alone.
  if (prefs.fixTwoCapitals && /^\p{Lu}{2}\p{Ll}+$/u.test(word) && word.slice(2) !== 's') {
    const insert = word[0] + word.slice(1).toLowerCase();
    return { from, to, insert, reason: `${word} → ${insert}` };
  }

  if (prefs.capitalizeSentences && /^\p{Ll}/u.test(word)) {
    if (startsSentence(lineBefore.slice(0, at)) && !/^\d/.test(word)) {
      const insert = word[0].toUpperCase() + word.slice(1);
      return { from, to, insert, reason: 'Capitalised the start of a sentence' };
    }
  }
  return null;
}

/** Start of a paragraph (after any list/quote/heading marker), or after . ! ? and a space — not after "cf." or "e.g.". */
function startsSentence(before: string): boolean {
  const startOfLine = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+)?$/.test(before);
  const afterSentence = /[.!?]["'”’)]?\s+$/.test(before) && !/\b(?:e\.g|i\.e|cf|vs|etc|v|vv|ch|p|pp|ca|c)\.\s+$/i.test(before);
  return startOfLine || afterSentence;
}

/** Small words inside names ("On *the* Vine") are ordinary words, not names. */
export const NAME_STOPWORDS = new Set(['the', 'of', 'on', 'a', 'an', 'and', 'in', 'to', 'at', 'for', 'de', 'la', 'le', 'von', 'van', 'da', 'di', 'du', 'al', 'el', 'bin', 'ibn', 'ben', 'by', 'with', 'from']);
