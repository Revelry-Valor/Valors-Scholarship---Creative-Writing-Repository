// Helpers for the editor's `@` menu (spec 4.1). Pure functions, shared with tests.

import { tokenize, type NameResolver, type TagToken } from './markup';
import type { FieldDef, ResolvedTemplate } from './types';

/** The entity the next `{field: value}` would be assigned to: the last resolved tag before `pos`. */
export function lastTagBefore(text: string, pos: number, resolver: NameResolver): { id: string; name: string } | null {
  const tokens = tokenize(text, resolver).filter((t): t is TagToken => t.kind === 'tag' && !t.bare && !t.optOut && t.to <= pos);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const r = resolver.resolve(tokens[i].name);
    if (r.status === 'ok') return { id: r.id, name: tokens[i].name };
  }
  return null;
}

/** "Add a fact": the fields from that entity's template (T39). */
export function factPickerFields(
  text: string,
  pos: number,
  resolver: NameResolver,
  entityType: (id: string) => string | undefined,
  templates: Map<string, ResolvedTemplate>,
): { entityId: string; entityName: string; fields: FieldDef[] } | null {
  const tag = lastTagBefore(text, pos, resolver);
  if (!tag) return null;
  const type = entityType(tag.id);
  const tpl = type ? templates.get(type) : undefined;
  return { entityId: tag.id, entityName: tag.name, fields: tpl?.fields ?? [] };
}

/** Rows of the F1 quick-reference panel (spec 4.1 / 4.2). */
export const QUICK_REFERENCE: Array<{ syntax: string; meaning: string; example: string }> = [
  { syntax: '@Name', meaning: 'Tag this block with an existing entity', example: '@Apple Scouch taught here.' },
  { syntax: '@@Name', meaning: 'Create a new entity and tag this block', example: '@@Chamberlain Pineapple' },
  { syntax: '@Name|shown', meaning: 'Tag, but display other words', example: '@Apple Scouch|he' },
  { syntax: '@[Long name|shown]', meaning: 'Bracket form for any name', example: '@[grace and repentance]' },
  { syntax: '@Name::Section', meaning: 'File into a specific profile section', example: '@Scouch::Writings' },
  { syntax: '@-Name', meaning: 'Remove the section owner from this block', example: 'An aside. @-Scouch' },
  { syntax: '[[Name]]', meaning: 'Link without tagging (not filed to the profile)', example: 'see [[On the Vine]]' },
  { syntax: '{field: value}', meaning: 'Set a field on the last tagged entity', example: '@Pineapple {died: 1351}' },
  { syntax: '{Name.field: value}', meaning: 'Set a field on a named entity', example: '{Scouch.born: c. 1280}' },
  { syntax: '{year: 1313}', meaning: 'Date the event this block describes', example: 'in {year: 1313}' },
  { syntax: '@A >relation> @B', meaning: 'Record a relationship', example: '@Pineapple >disagrees_with> @Scouch' },
  { syntax: '#topic', meaning: 'Tag the block with a topic', example: '#grace-and-repentance' },
  { syntax: '## Heading @', meaning: 'Heading owns every block beneath it', example: '## Apple Scouch @' },
  { syntax: '## Heading @Name', meaning: 'Heading filed to Name', example: "### Pineapple's reply @Chamberlain Pineapple" },
  { syntax: '!key', meaning: 'Mark the paragraph important (Ctrl+Shift+K)', example: 'He burned the letters. !key' },
  { syntax: '!check', meaning: 'Mark the paragraph to verify later', example: 'Born in 1280? !check' },
  { syntax: '!!phrase!!', meaning: 'Mark just a phrase as important', example: 'the !!third letter!! survives' },
  { syntax: '^pin', meaning: 'Use this block as the profile summary', example: 'He was a gardener-bishop. ^pin' },
  { syntax: '%% note %%', meaning: 'Private margin note, never shown on views', example: '%% check the date %%' },
];
