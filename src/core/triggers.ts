// Trigger words (spec 7, "Keywords"): themed word lists the active scan looks for.
// A theme can point at a page ("File to Canon of Scripture"); a hit on its words
// suggests filing the paragraph there. Words ending in * match any ending
// ("baptiz*" → baptize, baptized, baptizing). Stored per project in triggers.yaml.

import { DISPUTED_WRITINGS } from './scripture';

export interface TriggerTheme {
  id: string;
  label: string;
  /** Page (entity name) that paragraphs about this theme are filed to. Defaults to the label. */
  entity?: string;
  words: string[];
  /** Off themes are kept but not scanned for. */
  enabled?: boolean;
  /** Distinct words needed before a paragraph is suggested (default 2). */
  min?: number;
}

const w = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export const SCHOLARSHIP_THEMES: TriggerTheme[] = [
  {
    id: 'canon',
    label: 'Canon of Scripture',
    words: [
      ...w(`canon, canonical, canonicity, non-canonical, uncanonical, the scriptures, holy scripture*, divine scripture*, sacred scripture*, inspired scripture*,
      received books, books received, received as scripture, accepted books, acknowledged books, homologoumena, antilegomena, disputed books, disputed writings, spurious, notha,
      apocrypha, apocryphal, deuterocanonical, protocanonical, pseudepigrapha, pseudepigraphal, rejected books, the rule of truth, read in the churches, read publicly,
      read in church, public reading, the old testament, the new testament, old covenant books, new covenant books, the law and the prophets, the gospels, four gospels, fourfold gospel,
      the apostle, the apostolic writings, the memoirs of the apostles, catalogue of books, list of books, muratorian, festal letter, thirty-ninth festal letter, number of books,
      twenty-two books, twenty-four books, septuagint, lxx, the seventy, hebrew canon, vulgate, received by all, accepted by all, doubted by some, some reject, some do not receive,
      not in the canon, outside the canon, excluded, admitted, catholic epistles, pauline epistles, epistle to the hebrews, authorship of hebrews`),
      ...DISPUTED_WRITINGS.map((d) => d.toLowerCase()).filter((d) => !/^(james|jude|hebrews|revelation|2 john|3 john|2 peter|baruch)$/.test(d)),
    ],
  },
  {
    id: 'scripture-authority',
    label: 'Authority of Scripture',
    words: w(`inspired, inspiration, god-breathed, theopneustos, inerran*, infallib*, word of god, oracles of god, it is written, as it is written, the scripture says, scripture saith,
      the holy spirit says, the spirit spoke, spoke by the prophets, sufficiency of scripture, rule of faith, regula fidei, tradition, apostolic tradition, handed down, paradosis,
      interpret*, exegesis, allegor*, typolog*, literal sense, spiritual sense, figurative, hidden meaning`),
  },
  {
    id: 'prophecy',
    label: 'Prophecy',
    words: w(`prophec*, prophes*, prophet, prophets, prophetess, prophetic, foretold, foretell*, predicted, prediction, fulfilled, fulfil*, fulfillment, fulfilment, oracle, oracles,
      vision, visions, seer, revelation, revealed, it was spoken, spoken by the prophet, that it might be fulfilled, the prophet says, the prophet isaiah, daniel's weeks, seventy weeks,
      sign, signs, portent*, the coming one, messianic, messiah, the anointed, christ foretold, type and antitype, foreshadow*, prefigure*, figure of christ, shadow of things to come`),
  },
  {
    id: 'trinity',
    label: 'Trinity',
    words: w(`trinity, triune, trias, three persons, one god in three, godhead, hypostas*, ousia, substance, essence, consubstantial, homoousi*, homoiousi*, persons of the godhead,
      father son and holy spirit, father and the son, unbegotten, begotten, only-begotten, monogenes, generation of the son, procession, proceeds from, filioque, spiration,
      coequal, coeternal, monarchy of the father, modalism, modalist*, sabellian*, patripassian*, tritheis*, economy, oikonomia, perichoresis, circumincession`),
  },
  {
    id: 'christology',
    label: 'Christology',
    words: w(`christolog*, incarnat*, the word made flesh, logos, the word of god, two natures, one nature, hypostatic union, theotokos, christotokos, god-man, true god and true man,
      divinity of christ, deity of christ, humanity of christ, human soul, rational soul, kenosis, emptied himself, took flesh, assumed, assumption of humanity, son of god, son of man,
      pre-existen*, eternally begotten, adoption*, adoptionis*, apollinar*, nestori*, eutych*, monophysit*, miaphysit*, monothelit*, docet*, chalcedon*, communicatio idiomatum`),
  },
  {
    id: 'holy-spirit',
    label: 'Holy Spirit',
    words: w(`holy spirit, holy ghost, spirit of god, the paraclete, paraclete, comforter, the spirit, pneumatolog*, pentecost, gifts of the spirit, charism*, tongues, speaking in tongues,
      indwelling, anoint*, chrism, seal of the spirit, pneumatomach*, macedonian*, giver of life, lord and giver of life`),
  },
  {
    id: 'grace',
    label: 'Grace and salvation',
    words: w(`grace, gracious, salvation, saved, save us, redeem*, redemption, ransom, atonement, atone*, justif*, sanctif*, righteousness, imputed, faith alone, works of the law,
      good works, merit*, free will, freedom of the will, predestin*, election, elect, foreknow*, foreordain*, reprobat*, perseverance, deification, theosis, divinization, partakers of the divine nature,
      adoption as sons, new birth, born again, regenerat*, pelagi*, semi-pelagi*, synergism, monergism, original sin, ancestral sin`),
  },
  {
    id: 'repentance',
    label: 'Repentance and penance',
    words: w(`repent*, penance, penitent*, confession, confess*, absolution, forgiveness, forgive*, remission of sins, second repentance, post-baptismal sin, lapsed, the lapsed, lapsi,
      restoration, readmit*, excommunicat*, public penance, contrition, sorrow for sin, amendment of life, mortal sin, deadly sin, unforgivable, sin unto death, reconcil*`),
  },
  {
    id: 'baptism',
    label: 'Baptism',
    words: w(`baptism, baptis*, baptiz*, baptistery, font, laver, washing, washed, water and the spirit, regeneration, illumination, enlightened, catechumen*, catechesis, catechetical,
      renounce satan, renunciation, exorcism, anointing, triple immersion, immersion, affusion, sprinkling, infant baptism, baptism of infants, rebaptism, rebaptiz*, baptism of blood,
      clinical baptism, sponsor*, godparent*, the seal, sphragis, born of water`),
  },
  {
    id: 'eucharist',
    label: 'Eucharist',
    words: w(`eucharist*, lord's supper, the supper, communion, holy communion, the bread, the cup, body and blood, body of christ, blood of christ, flesh and blood, the offering,
      sacrifice of the mass, the sacrifice, oblation, anaphora, consecrat*, epiclesis, real presence, transubstantiat*, the mysteries, the holy mysteries, breaking of bread, agape, love feast,
      altar, the table, medicine of immortality, antidote against death`),
  },
  {
    id: 'church',
    label: 'The Church',
    words: w(`the church, catholic church, universal church, one holy catholic, ecclesia, ecclesiolog*, congregation, assembly, the faithful, the brethren, unity of the church,
      schism, schismatic*, bishop, bishops, episcop*, presbyter*, elder*, deacon*, deaconess*, clergy, laity, ordain*, ordination, laying on of hands, apostolic succession, succession of bishops,
      see of peter, chair of peter, primacy, the see of rome, metropolitan, patriarch*, synod*, the pope, bishop of rome, keys of the kingdom, outside the church, no salvation outside`),
  },
  {
    id: 'heresy',
    label: 'Heresies and controversies',
    words: w(`heresy, heresies, heretic, heretics, heretical, heterodox*, orthodox*, false teacher*, false teaching, blasphem*, anathema*, condemned, apostasy, apostate*,
      gnostic*, gnosis, valentinian*, basilide*, marcion*, montan*, new prophecy, ebionite*, docetist*, arian*, arius, semi-arian*, eunomian*, anomoean*, sabellius, paul of samosata,
      novatian*, donatist*, pelagius, manichae*, manichee*, encratite*, quartodeciman*, origenis*, iconoclas*, nestorius, eutyches, apollinaris, simon magus, cerinthus, carpocrat*`),
  },
  {
    id: 'councils',
    label: 'Councils and creeds',
    words: w(`council, councils, ecumenical council, synod, nicaea, nicea, nicene, constantinople, ephesus, chalcedon, creed, creeds, symbol of faith, profession of faith, canons of the council,
      the fathers of the council, 318 fathers, one hundred and fifty fathers, homoousios, definition of faith, decree*, the emperor summoned, anathematized, deposed, deposition`),
  },
  {
    id: 'martyrdom',
    label: 'Martyrdom and persecution',
    words: w(`martyr, martyrs, martyrdom, martyred, witness, confessor*, persecut*, suffered, sufferings, tortur*, torments, the beasts, wild beasts, arena, amphitheatre, stake, burned,
      beheaded, crucified, sword, prison, imprisoned, chains, exile, exiled, sacrifice to the gods, offer incense, libellus, libelli, traditor*, deny christ, denied christ, the lapsed,
      decius, diocletian, nero, domitian, trajan, valerian, galerius, great persecution, edict, crown of martyrdom, birthday of the martyr, relics`),
  },
  {
    id: 'eschatology',
    label: 'Last things',
    words: w(`eschatolog*, end times, last days, the end, second coming, parousia, return of christ, antichrist, the beast, tribulation, millennium, millennial*, chiliasm, chiliast*,
      thousand years, resurrection of the dead, resurrection of the body, general resurrection, judgment, last judgment, day of judgment, day of the lord, hell, gehenna, hades, eternal fire,
      punishment, eternal punishment, apokatastasis, restoration of all, universal salvation, heaven, paradise, kingdom of heaven, kingdom of god, new jerusalem, new heavens, new earth, purgatory, purifying fire`),
  },
  {
    id: 'creation',
    label: 'Creation',
    words: w(`creation, created, creator, maker of heaven, ex nihilo, out of nothing, six days, hexaemeron, genesis, the beginning, in the beginning, cosmos, matter, eternal matter,
      demiurge, image of god, likeness of god, imago dei, adam, eve, paradise, the fall, fall of man, serpent, the tree, providence, nature, natural law`),
  },
  {
    id: 'sin',
    label: 'Sin and the fall',
    min: 3,
    words: w(`sin, sins, sinful, sinner*, transgression*, iniquity, wickedness, evil, the fall, fallen, corruption, corrupt*, concupiscence, passions, the passions, lust, pride, vainglory,
      avarice, gluttony, envy, wrath, sloth, acedia, death entered, mortality, the devil, satan, temptation, tempted`),
  },
  {
    id: 'angels',
    label: 'Angels and demons',
    words: w(`angel*, archangel*, cherub*, seraph*, heavenly host*, principalities, powers, thrones, dominions, guardian angel, demon*, daemon*, devil*, evil spirit*, unclean spirit*,
      possessed, possession, exorcis*, fallen angel*, watchers, lucifer, beelzebub, belial`),
  },
  {
    id: 'mary',
    label: 'Mary',
    words: w(`mary, the virgin, blessed virgin, virgin mary, virgin birth, virginal conception, born of a virgin, mother of god, theotokos, new eve, second eve, ever-virgin, perpetual virginity,
      annunciation, magnificat, dormition, assumption of mary, handmaid of the lord`),
  },
  {
    id: 'worship',
    label: 'Worship and liturgy',
    min: 3,
    words: w(`worship, liturg*, the liturgy, divine service, lord's day, sunday, the eighth day, sabbath, feast, feasts, easter, pascha, paschal, lent, fasting, fast, vigil, hymn*, psalmody,
      psalms, prayer*, pray, the lord's prayer, our father, doxology, amen, incense, vestment*, sign of the cross, hours of prayer, the offering, alms, almsgiving, pilgrimage, icons, images, veneration`),
  },
  {
    id: 'ascetic',
    label: 'Asceticism and the virtues',
    words: w(`ascetic*, ascesis, monk*, monastic*, monaster*, hermit*, anchorite*, desert fathers, the desert, cenobit*, abbot, abba, amma, celibacy, virginity, virgins, continence, chastity,
      renunciation, poverty, obedience, humility, humble, patience, charity, love of neighbour, love of neighbor, virtue*, vice*, discipline, watchfulness, nepsis, stillness, hesychia, contemplation, theoria`),
  },
  {
    id: 'ethics',
    label: 'Christian life and ethics',
    min: 3,
    words: w(`marriage, married, husband, wife, divorce, remarriage, adultery, fornication, second marriage, widow*, children, abortion, infanticide, exposure of infants, slave*, slavery,
      master*, wealth, the rich, riches, the poor, poverty, usury, military service, soldier*, oath*, swearing, games, theatre, spectacles, idolatry, idol*, food offered to idols, modesty`),
  },
  {
    id: 'covenant',
    label: 'Law, covenant and Israel',
    words: w(`covenant*, old covenant, new covenant, the law, law of moses, mosaic law, circumcis*, sabbath, jew*, judaism, judaiz*, israel, the synagogue, the temple, sacrifices, priesthood,
      levit*, ceremonial law, moral law, the ten commandments, decalogue, the gentiles, the nations, supersession*, true israel, new israel, abraham, moses, the prophets`),
  },
  {
    id: 'empire',
    label: 'Church and empire',
    min: 3,
    words: w(`emperor*, empire, caesar, augustus, rome, roman, the senate, magistrate*, governor, proconsul, prefect, the state, rulers, authorities, constantine, theodosius, julian, licinius,
      edict of milan, toleration, pagan*, the gods, temples, sacrifice*, imperial, the throne, tribute, taxes, render unto caesar`),
  },
  {
    id: 'philosophy',
    label: 'Philosophy',
    words: w(`philosoph*, plato, platon*, neoplaton*, plotinus, porphyry, aristotle, aristotel*, stoic*, epicure*, the academy, the greeks, hellen*, pagan wisdom, reason, logos spermatikos,
      seeds of the word, the good, the one, the soul, immortality of the soul, pre-existence of souls, transmigration, metempsychosis, athens and jerusalem`),
  },
  {
    id: 'sources',
    label: 'Sources and authorship',
    min: 3,
    words: w(`wrote, written, writing*, letter*, epistle*, treatise*, homil*, sermon*, oration*, commentary, commentaries, dialogue, apology, apologia, against, contra, the book, the work,
      manuscript*, codex, codices, copy, copies, translat*, forged, forgery, spurious, genuine, authentic, attributed to, ascribed to, falsely ascribed, pseudonymous, lost work, fragment*, quoted by, preserved by`),
  },
];

export const FANTASY_THEMES: TriggerTheme[] = [
  {
    id: 'war',
    label: 'Wars and battles',
    words: w(`war, wars, battle*, siege, besieg*, army, armies, legion*, host, warband*, invasion, invad*, conquer*, conquest, campaign*, raid*, skirmish*, fortress, fort, garrison, rout*, routed,
      surrender*, treaty, truce, ceasefire, alliance, allied, enemy, enemies, rebellion, rebel*, revolt, uprising, mutiny, general, commander, captain, cavalry, infantry, archers, siege engine*, slain, casualties`),
  },
  {
    id: 'politics',
    label: 'Politics and rule',
    words: w(`king, queen, kings, queens, prince*, princess*, emperor, empress, throne, crown, crowned, coronation, reign*, ruled, ruler*, regent, dynasty, dynast*, heir*, succession, usurp*,
      council, senate, parliament, court, courtier*, noble*, lord*, lady, duke*, count*, baron*, chancellor, vizier, steward, tax*, tribute, law*, decree*, edict*, treason, traitor*, exile*, banish*, vassal*, fealty, oath of fealty`),
  },
  {
    id: 'magic',
    label: 'Magic',
    words: w(`magic*, mage*, wizard*, witch*, sorcer*, spell*, enchant*, ritual*, rune*, arcane, mana, aether, ether, conjur*, summon*, necromanc*, curse*, cursed, hex*, ward*, glyph*, sigil*,
      artifact*, relic*, staff, wand, familiar*, alchemy, alchemist*, potion*, elixir*, scry*, divination, portal*, the weave, leyline*, ley line*`),
  },
  {
    id: 'religion',
    label: 'Gods and faith',
    words: w(`god, gods, goddess*, deity, deities, divine, pantheon, temple*, shrine*, altar*, priest*, priestess*, cleric*, oracle*, prophet*, prophec*, worship*, pray*, prayer*, sacrifice*, offering*,
      holy, sacred, blessed, blessing*, heresy, heretic*, cult*, faith, faithful, pilgrim*, relic*, miracle*, afterlife, heaven*, underworld, damnation, saint*, creed`),
  },
  {
    id: 'prophecy',
    label: 'Prophecy',
    words: w(`prophec*, prophes*, foretold, foretell*, destiny, destined, fate, fated, chosen one, the chosen, omen*, portent*, sign*, vision*, dream*, oracle*, seer*, fulfilled, fulfil*, the prophecy, it is said that, legend says, the old songs`),
  },
  {
    id: 'lineage',
    label: 'Family and lineage',
    min: 3,
    words: w(`born, birth, died, death, married, marriage, wed, wedding, betroth*, son of, daughter of, father, mother, brother, sister, sibling*, twin*, heir, bastard, ancestor*, descendant*, lineage,
      bloodline, house of, family, clan*, kin, kinsman, cousin*, uncle, aunt, nephew, niece, grandfather, grandmother, widow*, orphan*, adopted, firstborn`),
  },
  {
    id: 'trade',
    label: 'Trade and economy',
    words: w(`trade, trader*, merchant*, market*, caravan*, ship*, shipping, port*, harbour, harbor, coin*, gold, silver, copper, currency, guild*, tariff*, toll*, goods, cargo, export*, import*,
      spice*, silk, salt, iron, grain, harvest*, famine, wealth, debt*, bank*, smuggl*`),
  },
  {
    id: 'geography',
    label: 'Places and travel',
    min: 3,
    words: w(`journey*, travel*, voyage*, road*, pass, mountain*, river*, sea, ocean, coast*, island*, forest*, desert*, swamp*, marsh*, valley, plain*, border*, frontier, north, south, east, west,
      city, cities, town*, village*, capital, ruins, map*, league*, miles, days' ride, crossing*, bridge*, ford`),
  },
  {
    id: 'creatures',
    label: 'Creatures',
    words: w(`beast*, monster*, creature*, dragon*, wyrm*, drake*, giant*, troll*, orc*, goblin*, wolf, wolves, spirit*, ghost*, wraith*, undead, demon*, fae, fey, fairy, fairies, elf, elves, dwarf, dwarves,
      serpent*, kraken, griffin*, gryphon*, hunt*, hunter*, prey, predator*, lair, nest, hatch*, tame*, domestic*`),
  },
  {
    id: 'secrets',
    label: 'Secrets and betrayal',
    words: w(`secret*, hidden, conceal*, betray*, treacher*, traitor*, spy, spies, spymaster, conspir*, plot*, assassin*, murder*, poison*, disguise*, lie, lies, lied, deceiv*, deceit, blackmail*, ransom*, kidnap*, vanish*, disappear*, mystery, unknown to`),
  },
  {
    id: 'technology',
    label: 'Technology and invention',
    words: w(`invent*, invention*, discover*, discovery, forge*, smith*, crafted, craft*, engineer*, machine*, device*, mechanism*, clockwork, gunpowder, steam, engine*, printing, press, mill*, loom*,
      aqueduct*, irrigation, writing, script, alphabet, calendar*, astronomy, medicine, surgery, workshop*, apprentice*, master craftsman, blueprint*, prototype*`),
  },
];

const OFF_BY_DEFAULT = new Set(['sources', 'sin', 'geography']);

/** Built-in themes for a new project. */
export function defaultThemes(mode: 'scholarship' | 'fantasy' | 'blank' | string): TriggerTheme[] {
  const src = mode === 'fantasy' ? FANTASY_THEMES : mode === 'scholarship' ? SCHOLARSHIP_THEMES : [];
  // Very general themes start switched off; turn them on in Trigger words.
  return src.map((t) => ({ ...t, words: [...new Set(t.words)], enabled: !OFF_BY_DEFAULT.has(t.id) }));
}

// ---------------------------------------------------------------- major statements

export interface MajorCue {
  re: RegExp;
  weight: number;
  why: string;
}

/**
 * Phrases that tend to open a thesis, a definition, a verdict or a strong claim.
 * Weights add up; a paragraph scoring 3+ is offered as a key detail.
 */
export const MAJOR_CUES: MajorCue[] = [
  { re: /\b(we|i) (confess|believe|affirm|declare|teach|hold|maintain|profess|acknowledge)\b/i, weight: 3, why: 'a statement of belief' },
  { re: /\b(the church|the catholic church|the apostles?|the fathers|the scriptures?) (teach(es)?|hold(s)?|declare(s)?|affirm(s)?|confess(es)?|receive(s)?|reject(s)?)\b/i, weight: 3, why: 'says what the church or Scripture teaches' },
  { re: /\blet (him|them) be anathema\b|\banathema sit\b|\bis (anathema|accursed)\b/i, weight: 4, why: 'an anathema' },
  { re: /\b(we|i) (reject|condemn|anathemati[sz]e|deny|refute)\b/i, weight: 3, why: 'a condemnation' },
  { re: /\b(it is|is) (necessary|essential|required|fitting|right|impossible|not lawful|unlawful|lawful)\b/i, weight: 2, why: 'a verdict' },
  { re: /\b(must|ought to|shall|cannot|may not) (be|not|never)\b/i, weight: 1, why: 'a strong claim' },
  { re: /\b(therefore|consequently|hence|thus|wherefore|accordingly),?\s/i, weight: 1, why: 'a conclusion' },
  { re: /\b(in (short|sum|summary|conclusion)|to sum up|the (whole|main|chief) point|above all|first of all|most important(ly)?|chiefly|principally)\b/i, weight: 2, why: 'a summary or main point' },
  { re: /\b(it is (clear|evident|manifest|plain|certain|beyond doubt)|without (doubt|question)|undoubtedly|certainly|clearly|plainly|manifestly)\b/i, weight: 2, why: 'stated as certain' },
  { re: /\b(all|every|no one|none|always|never|everywhere|by all)\b.*\b(agree|received|accepted|believe|held|taught|confess)\w*\b/i, weight: 2, why: 'a claim about what all accept' },
  { re: /\b(is|are|means|signifies|denotes) (called|defined as|that is to say)\b|\bthat is to say\b|\bby this (he|we|they) mean/i, weight: 2, why: 'a definition' },
  { re: /\b(is|was) (the (first|last|only|earliest|oldest|greatest|chief))\b/i, weight: 2, why: 'a first, only or greatest' },
  { re: /\b(founded|established|instituted|ordained|decreed|proclaimed|declared|crowned|abolished|outlawed|condemned)\b/i, weight: 1, why: 'a founding or ruling act' },
  { re: /\b(i say|i tell you|mark this|note (this|well)|know (this|that)|remember (this|that)|hear this)\b/i, weight: 2, why: 'the writer stresses it' },
  { re: /\b(truly|verily|amen,? amen)\b/i, weight: 1, why: 'solemn emphasis' },
  { re: /\b(the (rule|canon|definition|confession) of (faith|truth))\b/i, weight: 3, why: 'the rule of faith' },
  { re: /\b(is|are) (not|no longer) (to be )?(received|accepted|read|counted|reckoned|numbered)\b|\bnot (received|accepted|read) (by|in)\b/i, weight: 3, why: 'says what is not accepted' },
  { re: /\b(received|accepted|read|counted|reckoned|numbered) (among|as|by all|in the churches)\b/i, weight: 3, why: 'says what is accepted' },
  { re: /!$|—\s*(never|always)\b/, weight: 1, why: 'emphatic' },
];

export function majorScore(text: string): { score: number; why: string[]; spans: Array<[number, number]> } {
  let score = 0;
  const why: string[] = [];
  const spans: Array<[number, number]> = [];
  for (const c of MAJOR_CUES) {
    const m = c.re.exec(text);
    if (m) {
      score += c.weight;
      if (!why.includes(c.why)) why.push(c.why);
      if (m[0].trim()) spans.push([m.index, m.index + m[0].length]);
    }
  }
  return { score, why, spans: spans.sort((a, b) => a[0] - b[0]) };
}

// ---------------------------------------------------------------- matching

export interface CompiledTheme {
  theme: TriggerTheme;
  re: RegExp;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex per theme: whole words and phrases, `*` = any word ending. */
export function compileWords(words: string[]): RegExp | null {
  const parts = words
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((x) => {
      const stem = x.endsWith('*');
      const body = escape(stem ? x.slice(0, -1) : x)
        .replace(/\\?'/g, "['’]")
        .replace(/\s+/g, '\\s+');
      return stem ? `${body}[\\p{L}\\p{N}]*` : body;
    });
  if (!parts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

export function compileThemes(themes: TriggerTheme[]): CompiledTheme[] {
  const out: CompiledTheme[] = [];
  for (const t of themes) {
    if (t.enabled === false) continue;
    const re = compileWords(t.words);
    if (re) out.push({ theme: t, re });
  }
  return out;
}

export interface WordHit {
  from: number;
  to: number;
  word: string;
}

export function findWords(re: RegExp, text: string): WordHit[] {
  const out: WordHit[] = [];
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) out.push({ from: m.index, to: m.index + m[0].length, word: m[0] });
  return out;
}
