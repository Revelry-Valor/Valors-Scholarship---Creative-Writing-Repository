// Decides where every block is filed (spec 4.2, 4.3, 5): inline tags, section
// owners from headings, opt-outs, fields, relationships and warnings.
// The indexer and the editor's context stripe both run this same code.

import { headingLevel, headingTitle, tokenize, normalizeName, type NameResolver, type Token, type TagToken } from './markup';
import { parseDate } from './dates';
import { isA } from './templates';
import type { BlockKind, BlockWarning, FieldAssignment, Filing, RelationRecord, RelationTypeDef, ResolvedTemplate } from './types';

export interface AnalysisContext {
  resolver: NameResolver;
  templates: Map<string, ResolvedTemplate>;
  relationTypes: Map<string, RelationTypeDef>;
  entityType(id: string): string | undefined;
  /** For an entity file: every block is filed to this entity directly. */
  directOwner?: string;
  /** Your documents, so [[Document title]] links to a document when no page has that name. */
  documentByTitle?(title: string): string | undefined;
}

export interface BlockInput {
  text: string;
  id?: string;
  kind: BlockKind;
  headingLevel?: number;
}

export interface PendingCreate {
  name: string;
  /** 'tag' for @@Name, 'topic' for #topic. */
  via: 'tag' | 'topic';
}

export interface AnalyzedBlock {
  tokens: Token[];
  filedTo: Filing[];
  links: string[];
  optOuts: string[];
  fields: FieldAssignment[];
  relations: RelationRecord[];
  warnings: BlockWarning[];
  creates: PendingCreate[];
  eventDate?: { text: string; sort?: number };
  pinned: boolean;
  marks: string[];
  keyPhrases: string[];
  scripture: Array<{ book: string; chapter: number; verseStart?: number; verseEnd?: number; chapterEnd?: number; onward?: boolean; label: string; quoted: boolean; compare: boolean }>;
  /** Title of the nearest heading above (or this heading's own title). */
  headingTitle?: string;
  /** Documents linked with [[Document title]]. */
  docLinks: string[];
  /** Live quotations: ![[Page]], ![[Document]], ![[#b-id]]. */
  embeds: Array<{ kind: 'block' | 'entity' | 'document' | 'missing'; id: string }>;
}

interface StackEntry {
  level: number;
  owners: string[];
  title: string;
}

const DATE_KEYS = new Set(['date', 'year']);

export function analyzeBlocks(blocks: BlockInput[], ctx: AnalysisContext): AnalyzedBlock[] {
  const stack: StackEntry[] = [];
  return blocks.map((b) => analyzeOne(b, stack, ctx));
}

function templateOf(ctx: AnalysisContext, entityId: string): ResolvedTemplate | undefined {
  const t = ctx.entityType(entityId);
  return t ? ctx.templates.get(t) : undefined;
}

function matchSection(ctx: AnalysisContext, entityId: string, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const tpl = templateOf(ctx, entityId);
  const key = name.trim().toLowerCase();
  return tpl?.sections.find((s) => s.toLowerCase() === key);
}

function analyzeOne(b: BlockInput, stack: StackEntry[], ctx: AnalysisContext): AnalyzedBlock {
  const text = b.text;
  const tokens = tokenize(text, ctx.resolver);
  const warnings: BlockWarning[] = [];
  const creates: PendingCreate[] = [];
  const links: string[] = [];
  const optOuts: string[] = [];
  const inline = new Map<string, { section?: string }>();
  const resolvedTags = new Map<TagToken, string>();
  let pinned = false;
  const marks: string[] = [];
  const keyPhrases: string[] = [];
  const scripture: AnalyzedBlock['scripture'] = [];
  const docLinks: string[] = [];
  const embeds: AnalyzedBlock['embeds'] = [];

  const level = b.kind === 'heading' ? b.headingLevel ?? headingLevel(text) : 0;
  let ownTitle: string | undefined;

  for (const t of tokens) {
    switch (t.kind) {
      case 'tag': {
        if (t.bare) break;
        const r = ctx.resolver.resolve(t.name);
        if (r.status === 'ok') {
          resolvedTags.set(t, r.id);
          if (t.optOut) optOuts.push(r.id);
          else if (!inline.has(r.id) || t.section) inline.set(r.id, { section: t.section });
        } else if (r.status === 'ambiguous') {
          warnings.push({ from: t.from, to: t.to, code: 'ambiguous-tag', message: `"${t.name}" matches ${r.ids.length} entities — pick one` });
        } else if (t.create) {
          creates.push({ name: t.name, via: 'tag' });
        } else {
          warnings.push({ from: t.from, to: t.to, code: 'unresolved-tag', message: `No entity named "${t.name}" — create it?` });
        }
        break;
      }
      case 'topic': {
        const r = ctx.resolver.resolve(t.name);
        if (r.status === 'ok') {
          if (!inline.has(r.id)) inline.set(r.id, {});
        } else if (r.status === 'ambiguous') {
          warnings.push({ from: t.from, to: t.to, code: 'ambiguous-tag', message: `"#${t.name}" matches ${r.ids.length} entities` });
        } else {
          creates.push({ name: t.name, via: 'topic' });
        }
        break;
      }
      case 'link': {
        const r = ctx.resolver.resolve(t.name);
        const doc = r.status === 'ok' ? undefined : ctx.documentByTitle?.(t.name);
        if (r.status === 'ok') links.push(r.id);
        else if (doc) docLinks.push(doc);
        else warnings.push({ from: t.from, to: t.to, code: r.status === 'ambiguous' ? 'ambiguous-tag' : 'unresolved-tag', message: `No page or document named "${t.name}"` });
        break;
      }
      case 'embed': {
        if (/^#b-[a-z0-9]+$/.test(t.target)) {
          embeds.push({ kind: 'block', id: t.target.slice(1) });
          break;
        }
        const r = ctx.resolver.resolve(t.target);
        const doc = r.status === 'ok' ? undefined : ctx.documentByTitle?.(t.target);
        if (r.status === 'ok') {
          embeds.push({ kind: 'entity', id: r.id });
          links.push(r.id);
        } else if (doc) {
          embeds.push({ kind: 'document', id: doc });
          docLinks.push(doc);
        } else {
          embeds.push({ kind: 'missing', id: t.target });
          warnings.push({ from: t.from, to: t.to, code: 'unresolved-tag', message: `Nothing named "${t.target}" to quote` });
        }
        break;
      }
      case 'pin':
        pinned = true;
        break;
      case 'mark':
        if (!marks.includes(t.mark)) marks.push(t.mark);
        break;
      case 'keyspan':
        keyPhrases.push(t.inner);
        break;
      case 'scripture': {
        const { from: _f, to: _t, ...ref } = t.ref;
        scripture.push(ref);
        break;
      }
      case 'unclosed':
        warnings.push({ from: t.from, to: t.to, code: 'unclosed', message: `Unclosed ${t.what}` });
        break;
      default:
        break;
    }
  }

  // Heading: update the section-owner stack (spec 4.3).
  if (level) {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    ownTitle = headingTitle(text, ctx.resolver);
    const owners = [...inline.keys()];
    if (tokens.some((t) => t.kind === 'tag' && t.bare)) {
      const r = ctx.resolver.resolve(ownTitle);
      if (r.status === 'ok') {
        if (!owners.includes(r.id)) owners.push(r.id);
      } else {
        const bare = tokens.find((t) => t.kind === 'tag' && t.bare)!;
        warnings.push({
          from: bare.from,
          to: bare.to,
          code: r.status === 'ambiguous' ? 'ambiguous-tag' : 'unresolved-tag',
          message: r.status === 'ambiguous' ? `"${ownTitle}" matches several entities` : `No entity named "${ownTitle}" — create it?`,
        });
      }
    }
    stack.push({ level, owners, title: ownTitle });
  }

  const nearestTitle = ownTitle ?? (stack.length ? stack[stack.length - 1].title : undefined);

  // Fields: {field: value} goes to the last tag before it, {Name.field: value} to Name.
  const fields: FieldAssignment[] = [];
  let eventDate: AnalyzedBlock['eventDate'];
  const blockId = b.id ?? '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'field') continue;
    let target: string | undefined;
    if (t.entity) {
      const r = ctx.resolver.resolve(t.entity);
      if (r.status === 'ok') target = r.id;
      else {
        warnings.push({ from: t.from, to: t.to, code: 'field-no-entity', message: `No entity named "${t.entity}"` });
        continue;
      }
    } else {
      for (let k = i - 1; k >= 0; k--) {
        const p = tokens[k];
        if (p.kind === 'tag' && !p.bare && !p.optOut && resolvedTags.has(p)) {
          target = resolvedTags.get(p);
          break;
        }
      }
    }
    const parsed = parseDate(t.value);
    if (DATE_KEYS.has(t.field) && !t.entity) {
      eventDate = { text: t.value, sort: parsed?.sort };
      const tpl = target ? templateOf(ctx, target) : undefined;
      if (!target || !tpl?.fields.some((fd) => fd.key === t.field)) continue;
    }
    if (!target) {
      warnings.push({ from: t.from, to: t.to, code: 'field-no-entity', message: 'No entity to assign this to — tag someone before it, or write {Name.field: value}' });
      continue;
    }
    const tpl = templateOf(ctx, target);
    const def = tpl?.fields.find((fd) => fd.key === t.field);
    if (!def) {
      warnings.push({ from: t.from, to: t.to, code: 'unknown-field', message: `"${t.field}" is not a field of ${tpl?.name ?? 'this type'} — add it to the template?` });
      continue;
    }
    const isDate = def.kind === 'date' || def.of === 'date';
    const isEntity = def.kind === 'entity' || def.of === 'entity';
    // A list of people is written {children: @Anna, @Ben}: one assignment per name.
    const parts = def.kind === 'list' ? t.value.split(/\s*[,;]\s*/).filter(Boolean) : [t.value];
    for (const part of parts) {
      let entityRef: string | undefined;
      if (isEntity || part.startsWith('@')) {
        const r = ctx.resolver.resolve(part.replace(/^@+/, '').replace(/^\[|\]$/g, ''));
        if (r.status === 'ok') entityRef = r.id;
        else if (isEntity) warnings.push({ from: t.from, to: t.to, code: 'unresolved-tag', message: `No entity named "${part.replace(/^@+/, '')}" — create it?` });
      }
      fields.push({
        entityId: target,
        field: def.key,
        valueText: part,
        sort: isDate ? parseDate(part)?.sort : def.kind === 'number' ? Number(part) || undefined : undefined,
        entityRef,
        blockId,
      });
    }
  }

  // A date written in the text ("May 4th 2026", "Jan/21/2024") dates the paragraph
  // when no {date: …} was given, so profiles and timelines put it in order.
  if (!eventDate) {
    const d = tokens.find((x) => x.kind === 'date');
    if (d && d.kind === 'date') eventDate = { text: d.date.text, sort: d.date.sort };
  }

  // Relationships: @A >relation> @B
  const relations: RelationRecord[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'relation') continue;
    const def = ctx.relationTypes.get(t.type);
    if (!def) {
      warnings.push({ from: t.from, to: t.to, code: 'unknown-relation', message: `Unknown relationship "${t.type}" — create relationship type?` });
      continue;
    }
    let subject: string | undefined;
    let object: string | undefined;
    for (let k = i - 1; k >= 0 && !subject; k--) {
      const p = tokens[k];
      if (p.kind === 'tag' && resolvedTags.has(p)) subject = resolvedTags.get(p);
      if (p.kind === 'relation') break;
    }
    for (let k = i + 1; k < tokens.length && !object; k++) {
      const p = tokens[k];
      if (p.kind === 'tag' && resolvedTags.has(p)) object = resolvedTags.get(p);
      if (p.kind === 'relation') break;
    }
    if (!subject || !object) {
      warnings.push({ from: t.from, to: t.to, code: 'relation-incomplete', message: 'A relationship needs a tag on each side: @A >relation> @B' });
      continue;
    }
    const topicTok = tokens.find((x) => x.kind === 'topic');
    let topic: string | undefined;
    if (topicTok && topicTok.kind === 'topic') {
      const r = ctx.resolver.resolve(topicTok.name);
      if (r.status === 'ok') topic = r.id;
    }
    relations.push({ subject, type: def.id, object, topic, blockId });
  }

  // Filing: section owners, then inline tags, then the file's own entity.
  const filed = new Map<string, Filing>();
  for (const id of stack.flatMap((s) => s.owners)) filed.set(id, { entityId: id, via: 'section' });
  for (const [id, info] of inline) filed.set(id, { entityId: id, via: 'inline', section: info.section });
  if (ctx.directOwner && !filed.has(ctx.directOwner)) filed.set(ctx.directOwner, { entityId: ctx.directOwner, via: 'direct' });
  for (const id of optOuts) filed.delete(id);

  for (const f of filed.values()) {
    const explicit = matchSection(ctx, f.entityId, f.section);
    if (f.section) {
      f.section = explicit ?? f.section;
      continue;
    }
    // The heading a block sits under becomes its section on the profile, like a chapter
    // heading in a document — unless that heading is the one naming this entity as owner.
    const top = stack[stack.length - 1];
    const headingNamesOwner = !!top && top.owners.includes(f.entityId);
    const adHoc = !headingNamesOwner && nearestTitle ? nearestTitle : undefined;
    f.section =
      matchSection(ctx, f.entityId, nearestTitle) ??
      ruleSection(ctx, f.entityId, { relations, eventDate, fields, filedIds: [...filed.keys(), ...links] }) ??
      adHoc;
  }

  return {
    tokens,
    filedTo: [...filed.values()],
    links: [...new Set(links)].filter((id) => !filed.has(id)),
    optOuts,
    fields,
    relations,
    warnings,
    creates,
    eventDate,
    pinned,
    marks,
    keyPhrases,
    scripture,
    headingTitle: nearestTitle,
    docLinks: [...new Set(docLinks)],
    embeds,
  };
}

function ruleSection(
  ctx: AnalysisContext,
  entityId: string,
  info: { relations: RelationRecord[]; eventDate?: { sort?: number }; fields: FieldAssignment[]; filedIds: string[] },
): string | undefined {
  const tpl = templateOf(ctx, entityId);
  for (const rule of tpl?.rules ?? []) {
    const w = rule.when;
    if (w.relationCategory) {
      const hit = info.relations.some(
        (r) => (r.subject === entityId || r.object === entityId) && ctx.relationTypes.get(r.type)?.category === w.relationCategory,
      );
      if (!hit) continue;
    }
    if (w.alsoTagsType) {
      const hit = info.filedIds.some((id) => id !== entityId && isA(ctx.templates, ctx.entityType(id) ?? '', w.alsoTagsType!));
      if (!hit) continue;
    }
    if (w.hasDate && info.eventDate?.sort === undefined) continue;
    if (w.hasField && !info.fields.some((f) => f.entityId === entityId && f.field === w.hasField)) continue;
    if (tpl?.sections.includes(rule.section)) return rule.section;
  }
  return undefined;
}

export function sameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
