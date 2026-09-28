// Shared data shapes for the Living Repository engine.
// Terms follow the spec glossary: Vault, Entry, Block, Entity, Type/Template,
// Field, Tag, Relationship, Alias, View, Suggestion.

export type FieldKind = 'text' | 'number' | 'date' | 'bool' | 'entity' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** For kind 'list': the kind of each item. */
  of?: Exclude<FieldKind, 'list'>;
  /** For entity-link fields: restrict the picker to this type (and its descendants). */
  entityType?: string;
  /**
   * Two-way link: the field on the *other* entity that shows this one.
   * `mother` has inverse `children`, so {mother: @Anna} lists this person under Anna's Children.
   * A field that is its own inverse (friends, siblings, spouse) is symmetric.
   */
  inverse?: string;
}

export interface SectionRule {
  section: string;
  when: {
    relationCategory?: string;
    hasField?: string;
    hasDate?: boolean;
    /** The block also tags an entity of this type (e.g. a Work → Writings). */
    alsoTagsType?: string;
  };
}

export interface TemplateDef {
  id: string;
  name: string;
  extends?: string;
  /** Sub-folder of entities/ that profiles of this type are stored in. */
  folder?: string;
  color?: string;
  fields: FieldDef[];
  sections: string[];
  rules?: SectionRule[];
}

/** Template after inheritance has been applied. */
export interface ResolvedTemplate extends TemplateDef {
  lineage: string[];
}

export interface RelationTypeDef {
  id: string;
  label: string;
  inverse: string;
  category: string;
  lineage?: boolean;
}

export interface VaultSettings {
  name: string;
  mode: 'scholarship' | 'fantasy' | 'blank';
  owner?: string;
  defaultEntityType: string;
  lastUsedType?: string;
  autoLink?: boolean;
  stopList?: string[];
  /** Active scan: suggest filing as you write and import. */
  scan?: { active?: boolean; detectors?: Partial<Record<'mention' | 'ambiguous' | 'keyword' | 'theme' | 'scripture' | 'major' | 'new-name', boolean>> };
}

export type BlockKind = 'paragraph' | 'heading' | 'list' | 'quote' | 'code';

export type BlockStatus = 'approved' | 'pending' | 'rejected' | 'deleted' | 'archived';

export interface BlockHistoryEntry {
  at: string;
  by: string;
  text: string;
}

/** Authorship record kept for every block (spec 18.5). */
export interface BlockMeta {
  author: string;
  created: string;
  modified: string;
  modifiedBy: string;
  status: BlockStatus;
  approvedBy?: string;
  approvedAt?: string;
  history: BlockHistoryEntry[];
}

export type FiledVia = 'inline' | 'section' | 'direct' | 'relation';

export interface Filing {
  entityId: string;
  via: FiledVia;
  section?: string;
}

export interface BlockWarning {
  from: number;
  to: number;
  message: string;
  code: 'unresolved-tag' | 'ambiguous-tag' | 'field-no-entity' | 'unknown-field' | 'relation-incomplete' | 'unknown-relation' | 'unclosed';
}

export interface FieldAssignment {
  entityId: string;
  field: string;
  valueText: string;
  sort?: number;
  entityRef?: string;
  blockId: string;
}

export interface RelationRecord {
  subject: string;
  type: string;
  object: string;
  topic?: string;
  blockId: string;
}

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  keywords: string[];
  summary: string;
  fields: Record<string, unknown>;
  file: string;
  created?: string;
  order?: Record<string, string[]>;
}

export interface EntryRecord {
  id: string;
  title: string;
  file: string;
  status: EntryStatus;
  created?: string;
}

export type EntryStatus = 'idea' | 'draft' | 'revised' | 'final';

export interface BlockRecord {
  id: string;
  file: string;
  /** Owning entry id or entity id. */
  owner: { kind: DocKind; id: string };
  position: number;
  kind: BlockKind;
  headingLevel?: number;
  text: string;
  filedTo: Filing[];
  links: string[];
  optOuts: string[];
  fields: FieldAssignment[];
  relations: RelationRecord[];
  warnings: BlockWarning[];
  eventDate?: { text: string; sort?: number };
  pinned: boolean;
  /** Paragraph marks (`!key`, `!check`). */
  marks: string[];
  /** Phrases marked important inside the paragraph (`!!…!!`). */
  keyPhrases: string[];
  /** Scripture references found in the paragraph. */
  scripture: Array<{ book: string; chapter: number; verseStart?: number; verseEnd?: number; chapterEnd?: number; onward?: boolean; label: string; quoted: boolean; compare: boolean }>;
}

export interface BinderNode {
  kind: 'folder' | 'entry';
  /** Folder: vault-relative directory path. Entry: entry id. */
  id: string;
  name: string;
  path: string;
  status?: EntryStatus;
  words: number;
  children: BinderNode[];
}

export interface EntityChip {
  id: string;
  name: string;
  type: string;
  typeName: string;
  aliases: string[];
  color: string;
}

/** How a document looks on the page. Stored in the entry's frontmatter as `format:`. */
export interface DocFormat {
  font?: string;
  size?: number;
  lineHeight?: number;
  paragraphs?: 'spaced' | 'indented';
  align?: 'left' | 'justify';
  width?: 'narrow' | 'normal' | 'wide';
}

export type ViewKind = 'timeline' | 'family' | 'lineage' | 'tech' | 'radial' | 'web';

/** A saved timeline or chart (views/<id>.yaml). It stores settings, never content. */
export interface ViewDef {
  id: string;
  name: string;
  kind: ViewKind;
  /** Centre of a radial chart, or the person a family tree starts from. */
  root?: string;
  /** How many steps out from the root. */
  depth?: number;
  /** Lineage trees: which kind of link to follow (teacher, parent, overlord, leads_to, or a relationship id). */
  relation?: string;
  /** Only these relationship categories (radial / web). */
  categories?: string[];
  /** Only entities of these types. */
  types?: string[];
  /** Timelines: one lane per type, or one per entity. */
  lanes?: 'type' | 'entity';
}

/** Where a block lives: your writing, an entity's own page, or an imported source. */
export type DocKind = 'entry' | 'entity' | 'library';

/** An imported, read-only source in library/ (spec 12.1). */
export interface LibraryRecord {
  id: string;
  title: string;
  file: string;
  kind: 'bible' | 'text';
  /** Folder under library/ (a Bible translation, or '' for single texts). */
  collection: string;
  author?: string;
  date?: string;
  translation?: string;
  book?: string;
  /** The Work/Source page made for this text. */
  page?: string;
}
