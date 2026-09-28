// Entity types and templates (spec 5), relationship types, and starter packs.
// Templates live in the vault as editable YAML; these packs only seed new vaults.

import type { FieldDef, RelationTypeDef, ResolvedTemplate, TemplateDef, VaultSettings } from './types';

const f = (key: string, label: string, kind: FieldDef['kind'] = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  kind,
  ...extra,
});

const people = (key: string, label: string, inverse: string, one = false): FieldDef =>
  one ? f(key, label, 'entity', { inverse }) : f(key, label, 'list', { of: 'entity', inverse });

/** Worldbuilding types shared by the fantasy pack and "add a type" in any project. */
export const WORLD_TEMPLATES: TemplateDef[] = [
  {
    id: 'settlement',
    name: 'Settlement',
    extends: 'place',
    folder: 'settlements',
    color: '#5b8a3a',
    fields: [
      f('size', 'Size (hamlet, village, town, city)'),
      f('population', 'Population', 'number'),
      f('founded', 'Founded', 'date'),
      f('ruler', 'Ruler', 'entity'),
      f('nation', 'Nation', 'entity', { entityType: 'faction' }),
      f('trade', 'Trade goods', 'list', { of: 'text' }),
    ],
    sections: ['Overview', 'History', 'Districts', 'People', 'Economy', 'Events here'],
  },
  {
    id: 'species',
    name: 'Species',
    folder: 'species',
    color: '#1f7a8c',
    fields: [
      f('classification', 'Classification'),
      f('lifespan', 'Lifespan'),
      f('habitat', 'Habitat', 'list', { of: 'entity' }),
      f('diet', 'Diet'),
      f('intelligence', 'Intelligence'),
      f('related_species', 'Related species', 'list', { of: 'entity', inverse: 'related_species' }),
    ],
    sections: ['Description', 'Biology', 'Behaviour', 'Habitat', 'Lore'],
  },
  {
    id: 'flora',
    name: 'Flora',
    folder: 'flora',
    color: '#4e9a3f',
    fields: [
      f('kind', 'Kind (tree, herb, fungus…)'),
      f('habitat', 'Habitat', 'list', { of: 'entity' }),
      f('season', 'Season'),
      f('uses', 'Uses', 'list', { of: 'text' }),
      f('toxicity', 'Toxicity'),
      f('eaten_by', 'Eaten by', 'list', { of: 'entity', inverse: 'eats' }),
    ],
    sections: ['Description', 'Habitat', 'Uses', 'Lore'],
  },
  {
    id: 'fauna',
    name: 'Fauna',
    folder: 'fauna',
    color: '#a0632b',
    fields: [
      f('kind', 'Kind (beast, bird, fish…)'),
      f('habitat', 'Habitat', 'list', { of: 'entity' }),
      f('size', 'Size'),
      f('temperament', 'Temperament'),
      f('domesticated', 'Domesticated', 'bool'),
      f('eats', 'Eats', 'list', { of: 'entity', inverse: 'eaten_by' }),
      f('eaten_by', 'Eaten by', 'list', { of: 'entity', inverse: 'eats' }),
    ],
    sections: ['Description', 'Behaviour', 'Habitat', 'Uses', 'Lore'],
  },
  {
    id: 'technology',
    name: 'Technology',
    folder: 'technology',
    color: '#6b6fb3',
    fields: [
      f('discovered', 'Discovered', 'date'),
      f('inventor', 'Inventor', 'entity'),
      f('field', 'Field'),
      f('requires', 'Requires', 'list', { of: 'entity', inverse: 'leads_to' }),
      f('leads_to', 'Leads to', 'list', { of: 'entity', inverse: 'requires' }),
    ],
    sections: ['Description', 'History', 'Uses', 'Spread'],
  },
];

/** Family and friendship facts, linked both ways (spec 5: "entity-link fields are two-way"). */
export const FAMILY_FIELDS: FieldDef[] = [
  people('father', 'Father', 'children', true),
  people('mother', 'Mother', 'children', true),
  people('parents', 'Parents', 'children'),
  people('spouse', 'Spouse', 'spouse'),
  people('sons', 'Sons', 'parents'),
  people('daughters', 'Daughters', 'parents'),
  people('children', 'Children', 'parents'),
  people('siblings', 'Siblings', 'siblings'),
  people('grandfather', 'Grandfather', 'grandchildren'),
  people('grandmother', 'Grandmother', 'grandchildren'),
  people('grandparents', 'Grandparents', 'grandchildren'),
  people('grandchildren', 'Grandchildren', 'grandparents'),
  people('friends', 'Friends', 'friends'),
];

export function resolveTemplates(defs: TemplateDef[]): Map<string, ResolvedTemplate> {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const out = new Map<string, ResolvedTemplate>();
  const resolve = (id: string, seen: Set<string>): ResolvedTemplate | undefined => {
    if (out.has(id)) return out.get(id);
    const def = byId.get(id);
    if (!def) return undefined;
    if (seen.has(id)) throw new Error(`Template inheritance loop at "${id}"`);
    seen.add(id);
    const parent = def.extends ? resolve(def.extends, seen) : undefined;
    const fields: FieldDef[] = [...(parent?.fields ?? [])];
    for (const fd of def.fields ?? []) {
      const i = fields.findIndex((x) => x.key === fd.key);
      if (i >= 0) fields[i] = fd;
      else fields.push(fd);
    }
    const sections = def.sections?.length ? [...def.sections] : [...(parent?.sections ?? [])];
    const rt: ResolvedTemplate = {
      ...def,
      folder: def.folder ?? parent?.folder ?? def.id,
      color: def.color ?? parent?.color,
      fields,
      sections,
      rules: [...(parent?.rules ?? []), ...(def.rules ?? [])],
      lineage: [...(parent?.lineage ?? []), def.id],
    };
    out.set(id, rt);
    return rt;
  };
  for (const d of defs) resolve(d.id, new Set());
  return out;
}

/** True if `typeId` is `ancestor` or inherits from it. */
export function isA(templates: Map<string, ResolvedTemplate>, typeId: string, ancestor: string): boolean {
  return templates.get(typeId)?.lineage.includes(ancestor) ?? typeId === ancestor;
}

const PALETTE = ['#b5652b', '#2f7d6d', '#6a4fa3', '#b23a48', '#3b6fb6', '#8a7a1e', '#a0508f', '#3f8f3a', '#c07a12', '#4d6b7a', '#7a4e2d', '#2a8ca0'];

export function colorFor(key: string, explicit?: string): string {
  if (explicit) return explicit;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface StarterPack {
  id: 'scholarship' | 'fantasy' | 'blank';
  name: string;
  description: string;
  templates: TemplateDef[];
  relations: RelationTypeDef[];
  settings: Omit<VaultSettings, 'name'>;
}

const common: TemplateDef[] = [
  {
    id: 'topic',
    name: 'Topic',
    folder: 'topics',
    color: '#3b6fb6',
    fields: [f('category', 'Category'), f('related', 'Related', 'list', { of: 'entity' })],
    sections: ['Definition', 'Positions', 'Key texts', 'Debates', 'My conclusions'],
  },
];

const scholarshipTemplates: TemplateDef[] = [
  {
    id: 'person',
    name: 'Person',
    folder: 'people',
    color: '#b5652b',
    fields: [
      f('born', 'Born', 'date'),
      f('died', 'Died', 'date'),
      f('region', 'Region', 'entity', { entityType: 'place' }),
      f('tradition', 'Tradition'),
      f('teachers', 'Teachers', 'list', { of: 'entity', inverse: 'students' }),
      f('students', 'Students', 'list', { of: 'entity', inverse: 'teachers' }),
      ...FAMILY_FIELDS,
    ],
    sections: ['Summary', 'Life', 'Writings', 'Positions', 'Disagreements', 'Quotes'],
    rules: [
      { section: 'Disagreements', when: { relationCategory: 'conflict' } },
      { section: 'Writings', when: { alsoTagsType: 'work' } },
    ],
  },
  {
    id: 'church-father',
    name: 'Church Father',
    extends: 'person',
    fields: [f('see_office', 'See / office')],
    sections: ['Summary', 'Life', 'Writings', 'Positions', 'Disagreements', 'Scripture used', 'Quotes'],
  },
  {
    id: 'work',
    name: 'Work',
    folder: 'works',
    color: '#6a4fa3',
    fields: [
      f('author', 'Author', 'entity', { entityType: 'person' }),
      f('written', 'Written', 'date'),
      f('language', 'Language'),
      f('genre', 'Genre'),
      f('extant', 'Extant', 'bool'),
      f('editions', 'Editions', 'list', { of: 'text' }),
    ],
    sections: ['Summary', 'Contents', 'Key quotes', 'Scripture cited', 'Who cites it'],
  },
  {
    id: 'scripture-passage',
    name: 'Scripture passage',
    folder: 'scripture',
    color: '#8a7a1e',
    fields: [f('book', 'Book'), f('chapter', 'Chapter', 'number'), f('verse_range', 'Verse range'), f('testament', 'Testament'), f('genre', 'Genre')],
    sections: ['My notes', 'Cross-references', 'Cited by', 'Discussed in', 'Translations'],
  },
  {
    id: 'topic',
    name: 'Doctrine / Topic',
    folder: 'topics',
    color: '#3b6fb6',
    fields: [f('category', 'Category'), f('related_doctrines', 'Related doctrines', 'list', { of: 'entity' })],
    sections: ['Definition', 'Positions', 'Key texts', 'Debates', 'My conclusions'],
  },
  {
    id: 'council',
    name: 'Council / Event',
    folder: 'events',
    color: '#b23a48',
    fields: [f('date', 'Date', 'date'), f('place', 'Place', 'entity', { entityType: 'place' }), f('convened_by', 'Convened by', 'entity'), f('participants', 'Participants', 'list', { of: 'entity' })],
    sections: ['Background', 'Decisions', 'Aftermath'],
  },
  {
    id: 'place',
    name: 'Place',
    folder: 'places',
    color: '#3f8f3a',
    fields: [f('region', 'Region', 'entity', { entityType: 'place' }), f('modern_name', 'Modern name'), f('coordinates', 'Coordinates')],
    sections: ['History', 'People from here', 'Events here'],
  },
  {
    id: 'movement',
    name: 'Movement / Group',
    folder: 'groups',
    color: '#a0508f',
    fields: [f('founded', 'Founded', 'date'), f('founder', 'Founder', 'entity', { entityType: 'person' }), f('active_period', 'Active period')],
    sections: ['Beliefs', 'Members', 'Opponents'],
  },
  {
    id: 'source',
    name: 'Source',
    folder: 'sources',
    color: '#4d6b7a',
    fields: [f('author', 'Author'), f('title', 'Title'), f('year', 'Year', 'date'), f('publisher', 'Publisher'), f('pages', 'Pages')],
    sections: ['Notes', 'Where I used it'],
  },
];

const fantasyTemplates: TemplateDef[] = [
  {
    id: 'character',
    name: 'Character',
    folder: 'characters',
    color: '#b5652b',
    fields: [
      f('born', 'Born', 'date'),
      f('died', 'Died', 'date'),
      f('race', 'Race', 'entity', { entityType: 'race' }),
      f('faction', 'Faction', 'entity', { entityType: 'faction' }),
      f('home', 'Home', 'entity', { entityType: 'place' }),
      f('titles', 'Titles', 'list', { of: 'text' }),
      ...FAMILY_FIELDS,
    ],
    sections: ['Summary', 'History', 'Relationships', 'Deeds', 'Appearances'],
    rules: [{ section: 'Relationships', when: { relationCategory: 'family' } }],
  },
  {
    id: 'place',
    name: 'Place',
    folder: 'places',
    color: '#3f8f3a',
    fields: [
      f('region', 'Region'),
      f('parent_place', 'Parent place', 'entity', { entityType: 'place' }),
      f('ruler', 'Ruler', 'entity'),
      f('population', 'Population', 'number'),
      f('founded', 'Founded', 'date'),
    ],
    sections: ['History', 'Geography', 'Inhabitants', 'Events here'],
  },
  {
    id: 'faction',
    name: 'Faction / Nation',
    folder: 'factions',
    color: '#b23a48',
    fields: [
      f('founded', 'Founded', 'date'),
      f('leader', 'Leader', 'entity'),
      f('capital', 'Capital', 'entity', { entityType: 'place' }),
      f('allies', 'Allies', 'list', { of: 'entity', inverse: 'allies' }),
      f('enemies', 'Enemies', 'list', { of: 'entity', inverse: 'enemies' }),
      f('rivals', 'Rivals', 'list', { of: 'entity', inverse: 'rivals' }),
      f('overlord', 'Overlord', 'entity', { inverse: 'vassals' }),
      f('vassals', 'Vassals', 'list', { of: 'entity', inverse: 'overlord' }),
    ],
    sections: ['History', 'Beliefs', 'Members', 'Wars'],
  },
  {
    id: 'event',
    name: 'Event',
    folder: 'events',
    color: '#c07a12',
    fields: [f('date', 'Date', 'date'), f('place', 'Place', 'entity', { entityType: 'place' }), f('participants', 'Participants', 'list', { of: 'entity' }), f('outcome', 'Outcome')],
    sections: ['Causes', 'What happened', 'Consequences'],
  },
  {
    id: 'race',
    name: 'Race',
    folder: 'races',
    color: '#2f7d6d',
    fields: [
      f('lifespan', 'Lifespan'),
      f('homeland', 'Homeland', 'entity', { entityType: 'place' }),
      f('species', 'Species', 'entity', { entityType: 'species' }),
      f('languages', 'Languages', 'list', { of: 'text' }),
      f('related_races', 'Related races', 'list', { of: 'entity', inverse: 'related_races' }),
    ],
    sections: ['Appearance', 'Biology', 'Culture', 'History', 'Notable members'],
  },
  ...WORLD_TEMPLATES,
  {
    id: 'item',
    name: 'Item / Artifact',
    folder: 'items',
    color: '#8a7a1e',
    fields: [f('maker', 'Maker', 'entity'), f('made', 'Made', 'date'), f('current_holder', 'Current holder', 'entity')],
    sections: ['History', 'Powers'],
  },
  {
    id: 'religion',
    name: 'Religion / Deity',
    folder: 'religions',
    color: '#6a4fa3',
    fields: [f('domain', 'Domain'), f('worshippers', 'Worshippers', 'list', { of: 'entity' })],
    sections: ['Teachings', 'Holy texts', 'Sects'],
  },
  { ...common[0], name: 'Lore topic', fields: [f('category', 'Category')], sections: ['Notes'] },
];

const scholarshipRelations: RelationTypeDef[] = [
  { id: 'disagrees_with', label: 'Disagrees with', inverse: 'Disagreed with by', category: 'conflict' },
  { id: 'agrees_with', label: 'Agrees with', inverse: 'Agreed with by', category: 'agreement' },
  { id: 'opposed', label: 'Opposed', inverse: 'Opposed by', category: 'conflict' },
  { id: 'responds_to', label: 'Responds to', inverse: 'Answered by', category: 'conflict' },
  { id: 'student_of', label: 'Student of', inverse: 'Teacher of', category: 'teaching', lineage: true },
  { id: 'teacher_of', label: 'Teacher of', inverse: 'Student of', category: 'teaching', lineage: true },
  { id: 'influenced', label: 'Influenced', inverse: 'Influenced by', category: 'teaching' },
  { id: 'wrote', label: 'Wrote', inverse: 'Written by', category: 'ownership' },
  { id: 'cites', label: 'Cites', inverse: 'Cited by', category: 'reference' },
  { id: 'succeeded', label: 'Succeeded', inverse: 'Succeeded by', category: 'political', lineage: true },
  { id: 'member_of', label: 'Member of', inverse: 'Has member', category: 'political' },
  { id: 'born_in', label: 'Born in', inverse: 'Birthplace of', category: 'place' },
  { id: 'parent_of', label: 'Parent of', inverse: 'Child of', category: 'family', lineage: true },
  { id: 'child_of', label: 'Child of', inverse: 'Parent of', category: 'family', lineage: true },
  { id: 'sibling_of', label: 'Sibling of', inverse: 'Sibling of', category: 'family' },
  { id: 'married_to', label: 'Married to', inverse: 'Married to', category: 'family' },
  { id: 'friend_of', label: 'Friend of', inverse: 'Friend of', category: 'friendship' },
];

const fantasyRelations: RelationTypeDef[] = [
  { id: 'parent_of', label: 'Parent of', inverse: 'Child of', category: 'family', lineage: true },
  { id: 'child_of', label: 'Child of', inverse: 'Parent of', category: 'family', lineage: true },
  { id: 'sibling_of', label: 'Sibling of', inverse: 'Sibling of', category: 'family' },
  { id: 'married_to', label: 'Married to', inverse: 'Married to', category: 'family' },
  { id: 'allied_with', label: 'Allied with', inverse: 'Allied with', category: 'agreement' },
  { id: 'admires', label: 'Admires', inverse: 'Admired by', category: 'agreement' },
  { id: 'enemy_of', label: 'Enemy of', inverse: 'Enemy of', category: 'conflict' },
  { id: 'despises', label: 'Despises', inverse: 'Despised by', category: 'conflict' },
  { id: 'conquered', label: 'Conquered', inverse: 'Conquered by', category: 'conflict' },
  { id: 'rules', label: 'Rules', inverse: 'Ruled by', category: 'political' },
  { id: 'serves', label: 'Serves', inverse: 'Served by', category: 'political' },
  { id: 'member_of', label: 'Member of', inverse: 'Has member', category: 'political' },
  { id: 'founded', label: 'Founded', inverse: 'Founded by', category: 'political' },
  { id: 'teacher_of', label: 'Teacher of', inverse: 'Student of', category: 'teaching', lineage: true },
  { id: 'worships', label: 'Worships', inverse: 'Worshipped by', category: 'agreement' },
  { id: 'owns', label: 'Owns', inverse: 'Owned by', category: 'ownership' },
  { id: 'renamed_from', label: 'Renamed from', inverse: 'Renamed to', category: 'place' },
  { id: 'friend_of', label: 'Friend of', inverse: 'Friend of', category: 'friendship' },
];

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'scholarship',
    name: 'Scholarship',
    description: 'People, works, scripture passages, doctrines, councils, places, movements and sources.',
    templates: scholarshipTemplates,
    relations: scholarshipRelations,
    settings: { mode: 'scholarship', defaultEntityType: 'church-father' },
  },
  {
    id: 'fantasy',
    name: 'Fantasy world',
    description: 'Characters, places, factions, events, races, artifacts, religions and lore.',
    templates: fantasyTemplates,
    relations: fantasyRelations,
    settings: { mode: 'fantasy', defaultEntityType: 'character' },
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'One general Topic type and one Person type. Build your own templates.',
    templates: [
      { id: 'person', name: 'Person', folder: 'people', color: '#b5652b', fields: [f('born', 'Born', 'date'), f('died', 'Died', 'date'), ...FAMILY_FIELDS], sections: ['Summary', 'Notes'] },
      ...common,
    ],
    relations: [
      { id: 'related_to', label: 'Related to', inverse: 'Related to', category: 'reference' },
      { id: 'agrees_with', label: 'Agrees with', inverse: 'Agreed with by', category: 'agreement' },
      { id: 'disagrees_with', label: 'Disagrees with', inverse: 'Disagreed with by', category: 'conflict' },
    ],
    settings: { mode: 'blank', defaultEntityType: 'person' },
  },
];

/** A generic fallback so an entity whose type file was deleted still renders. */
export function fallbackTemplate(id: string): ResolvedTemplate {
  return { id, name: id, folder: 'other', fields: [], sections: ['Notes'], rules: [], lineage: [id] };
}
