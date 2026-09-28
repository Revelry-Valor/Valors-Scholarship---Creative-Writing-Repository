// A Vault is one self-contained repository: a folder on disk (spec 13).
//
//   entries/        free writing, nested folders and sub-documents (the binder)
//   entities/<type folder>/   one .md per entity (profile + direct notes)
//   templates/      type definitions (.yaml)
//   relations.yaml  relationship types with inverse labels
//   settings.yaml   vault settings
//   binder.yaml     manual ordering of the binder
//   .meta/          block authorship and history (keep)
//   .index/         generated, safe to delete
//
// Markdown files are the source of truth. Everything else in this class is an
// in-memory index built from them, and can be rebuilt at any time.

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { analyzeBlocks, type AnalysisContext, type PendingCreate } from './analysis';
import {
  applyEdits,
  blockSource,
  newId,
  parseFile,
  planBlockIds,
  removeBlockFromBody,
  replaceBlockInBody,
  slugify,
  splitBlocks,
  stringifyFile,
  type ParsedBlock,
} from './document';
import { countWords, formatTag, normalizeName, plainText, tokenize, type TagToken } from './markup';
import { MetaStore } from './meta';
import { NameTable } from './names';
import { colorFor, fallbackTemplate, resolveTemplates, STARTER_PACKS, type StarterPack } from './templates';
import type {
  BinderNode,
  BlockRecord,
  DocFormat,
  EntityChip,
  EntityRecord,
  EntryRecord,
  EntryStatus,
  RelationRecord,
  RelationTypeDef,
  ResolvedTemplate,
  TemplateDef,
  VaultSettings,
} from './types';

export const VAULT_MARKER = 'settings.yaml';

interface FileState {
  kind: 'entry' | 'entity';
  ownerId: string;
  blocks: ParsedBlock[];
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ChangeEvent {
  /** Vault-relative files that changed. */
  files: string[];
  /** True when entity names/types changed, so name tables should be refreshed. */
  entities: boolean;
  /** True when the binder structure changed. */
  binder?: boolean;
  external?: boolean;
}

export interface VaultInfo {
  root: string;
  settings: VaultSettings;
  templates: ResolvedTemplate[];
  relationTypes: RelationTypeDef[];
  counts: { entries: number; entities: number; blocks: number };
}

export interface NameData {
  entities: EntityChip[];
  templates: ResolvedTemplate[];
  relationTypes: RelationTypeDef[];
  settings: VaultSettings;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

export class Vault {
  settings!: VaultSettings;
  templateDefs: TemplateDef[] = [];
  templates = new Map<string, ResolvedTemplate>();
  relationTypes = new Map<string, RelationTypeDef>();
  entries = new Map<string, EntryRecord>();
  entities = new Map<string, EntityRecord>();
  blocks = new Map<string, BlockRecord>();
  files = new Map<string, FileState>();
  names = new NameTable();
  meta: MetaStore;
  binderOrder: Record<string, string[]> = {};
  /** Content we last wrote per file, so the watcher can ignore our own writes. */
  private written = new Map<string, string>();
  private listeners = new Set<(e: ChangeEvent) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly root: string,
    public author: string,
  ) {
    this.meta = new MetaStore(path.join(root, '.meta', 'blocks'));
  }

  // ---------------------------------------------------------------- lifecycle

  static isVault(dir: string): boolean {
    return existsSync(path.join(dir, VAULT_MARKER)) && existsSync(path.join(dir, 'templates'));
  }

  static async create(root: string, opts: { name: string; pack: StarterPack['id'] | StarterPack; author: string }): Promise<Vault> {
    const pack = typeof opts.pack === 'string' ? STARTER_PACKS.find((p) => p.id === opts.pack) : opts.pack;
    if (!pack) throw new Error(`Unknown starter pack ${String(opts.pack)}`);
    if (Vault.isVault(root)) throw new Error('That folder already contains a vault.');
    await fs.mkdir(root, { recursive: true });
    for (const d of ['entries', 'entities', 'library', 'templates', 'attachments', '.meta']) await fs.mkdir(path.join(root, d), { recursive: true });
    for (const t of pack.templates) {
      await fs.writeFile(path.join(root, 'templates', `${t.id}.yaml`), YAML.stringify(t, { lineWidth: 0 }));
    }
    await fs.writeFile(path.join(root, 'relations.yaml'), YAML.stringify(pack.relations, { lineWidth: 0 }));
    const settings: VaultSettings = { name: opts.name, owner: opts.author, autoLink: true, stopList: [], ...pack.settings };
    await fs.writeFile(path.join(root, 'settings.yaml'), YAML.stringify(settings));
    await fs.writeFile(path.join(root, 'binder.yaml'), YAML.stringify({ order: {} }));
    await fs.writeFile(
      path.join(root, '.gitignore'),
      '# The index is generated and safe to delete.\n.index/\n.trash/\n',
    );
    return Vault.open(root, { author: opts.author });
  }

  static async open(root: string, opts: { author: string }): Promise<Vault> {
    if (!Vault.isVault(root)) throw new Error(`${root} is not a vault (no settings.yaml / templates folder).`);
    const v = new Vault(path.resolve(root), opts.author);
    await v.rebuildIndex();
    return v;
  }

  onChange(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ChangeEvent) {
    for (const fn of this.listeners) fn(e);
  }

  /** Run vault mutations one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  abs(rel: string): string {
    return path.join(this.root, ...rel.split('/'));
  }

  // ---------------------------------------------------------------- index

  async rebuildIndex(): Promise<{ ms: number; blocks: number }> {
    const t0 = Date.now();
    await this.loadConfig();
    await this.meta.load();
    this.entries.clear();
    this.entities.clear();
    this.blocks.clear();
    this.files.clear();

    const entityFiles = await this.walk('entities');
    for (const rel of entityFiles) await this.loadEntityFile(rel);
    this.rebuildNames();
    const entryFiles = await this.walk('entries');
    for (const rel of entryFiles) await this.loadEntryFile(rel);

    // Blocks created outside the app get ids written back once.
    for (const rel of [...this.files.keys()]) await this.ensureBlockIds(rel);
    this.analyzeAll();
    await this.createPending();
    await this.meta.flush();
    await fs.mkdir(this.abs('.index'), { recursive: true }).catch(() => undefined);
    const ms = Date.now() - t0;
    await fs
      .writeFile(this.abs('.index/README.txt'), `Generated index folder. Safe to delete; it is rebuilt when the vault opens.\nLast rebuild: ${new Date().toISOString()} (${ms} ms, ${this.blocks.size} blocks)\n`)
      .catch(() => undefined);
    return { ms, blocks: this.blocks.size };
  }

  private async loadConfig() {
    this.settings = YAML.parse(await fs.readFile(this.abs('settings.yaml'), 'utf8')) as VaultSettings;
    this.settings.defaultEntityType ??= 'person';
    try {
      const rel = YAML.parse(await fs.readFile(this.abs('relations.yaml'), 'utf8')) as RelationTypeDef[];
      this.relationTypes = new Map((rel ?? []).map((r) => [r.id, r]));
    } catch {
      this.relationTypes = new Map();
    }
    this.templateDefs = [];
    for (const f of await fs.readdir(this.abs('templates')).catch(() => [] as string[])) {
      if (!/\.ya?ml$/.test(f)) continue;
      try {
        const def = YAML.parse(await fs.readFile(this.abs(`templates/${f}`), 'utf8')) as TemplateDef;
        if (def?.id) this.templateDefs.push({ ...def, fields: def.fields ?? [], sections: def.sections ?? [] });
      } catch {
        // Skip broken template files; entities of that type fall back to a generic template.
      }
    }
    this.templates = resolveTemplates(this.templateDefs);
    try {
      const b = YAML.parse(await fs.readFile(this.abs('binder.yaml'), 'utf8'));
      this.binderOrder = b?.order ?? {};
    } catch {
      this.binderOrder = {};
    }
  }

  private async walk(relDir: string): Promise<string[]> {
    const out: string[] = [];
    const rec = async (rel: string) => {
      let items: import('node:fs').Dirent[] = [];
      try {
        items = await fs.readdir(this.abs(rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        if (it.name.startsWith('.')) continue;
        const r = `${rel}/${it.name}`;
        if (it.isDirectory()) await rec(r);
        else if (it.name.endsWith('.md')) out.push(r);
      }
    };
    await rec(relDir);
    return out.sort();
  }

  private async readRel(rel: string): Promise<string> {
    return (await fs.readFile(this.abs(rel), 'utf8')).replace(/\r\n/g, '\n');
  }

  private async writeRel(rel: string, content: string) {
    await fs.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    this.written.set(rel, content);
    await fs.writeFile(this.abs(rel), content);
  }

  private async loadEntityFile(rel: string, content?: string) {
    content ??= await this.readRel(rel);
    const parsed = parseFile(content);
    const fm = parsed.frontmatter;
    let id = typeof fm.id === 'string' ? fm.id : '';
    const clash = id && this.entities.has(id) && this.entities.get(id)!.file !== rel && existsSync(this.abs(this.entities.get(id)!.file));
    if (!id || clash) {
      id = this.freshEntityId();
      fm.id = id;
      await this.writeRel(rel, stringifyFile(fm, parsed.body));
    }
    const name = String(fm.name ?? path.basename(rel, '.md'));
    const rec: EntityRecord = {
      id,
      type: String(fm.type ?? this.settings.defaultEntityType),
      name,
      aliases: Array.isArray(fm.aliases) ? fm.aliases.map(String) : [],
      keywords: Array.isArray(fm.keywords) ? fm.keywords.map(String) : [],
      summary: typeof fm.summary === 'string' ? fm.summary : '',
      fields: (fm.fields as Record<string, unknown>) ?? {},
      file: rel,
      created: typeof fm.created === 'string' ? fm.created : undefined,
      order: (fm.order as Record<string, string[]>) ?? undefined,
    };
    this.entities.set(id, rec);
    this.files.set(rel, { kind: 'entity', ownerId: id, blocks: parsed.blocks, frontmatter: fm, body: parsed.body });
  }

  private async loadEntryFile(rel: string, content?: string) {
    content ??= await this.readRel(rel);
    const parsed = parseFile(content);
    const fm = parsed.frontmatter;
    let id = typeof fm.id === 'string' ? fm.id : '';
    const clash = id && [...this.entries.values()].some((e) => e.id === id && e.file !== rel);
    if (!id || clash) {
      id = newId('n');
      fm.id = id;
      fm.title ??= path.basename(rel, '.md');
      fm.created ??= new Date().toISOString().slice(0, 10);
      await this.writeRel(rel, stringifyFile(fm, parsed.body));
    }
    this.entries.set(id, {
      id,
      title: String(fm.title ?? path.basename(rel, '.md')),
      file: rel,
      status: (fm.status as EntryStatus) ?? 'draft',
      created: typeof fm.created === 'string' ? fm.created : fm.created instanceof Date ? fm.created.toISOString().slice(0, 10) : undefined,
    });
    this.files.set(rel, { kind: 'entry', ownerId: id, blocks: parsed.blocks, frontmatter: fm, body: parsed.body });
  }

  private freshEntityId(): string {
    let id = newId('e');
    while (this.entities.has(id)) id = newId('e');
    return id;
  }

  private blockOwnerFile(id: string): string | undefined {
    for (const [rel, st] of this.files) if (st.blocks.some((b) => b.id === id)) return rel;
    return undefined;
  }

  private async ensureBlockIds(rel: string) {
    const st = this.files.get(rel)!;
    const edits = planBlockIds(st.body, (id) => {
      const other = this.blockOwnerFile(id);
      return !!other && other !== rel;
    });
    if (!edits.length) return;
    const body = applyEdits(st.body, edits);
    await this.writeRel(rel, stringifyFile(st.frontmatter, body));
    st.body = body;
    st.blocks = splitBlocks(body);
  }

  private rebuildNames() {
    this.names = new NameTable([...this.entities.values()].map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: e.type })));
  }

  analysisContext(directOwner?: string): AnalysisContext {
    return {
      resolver: this.names,
      templates: this.templates,
      relationTypes: this.relationTypes,
      entityType: (id) => this.entities.get(id)?.type,
      directOwner,
    };
  }

  private pending: PendingCreate[] = [];

  private analyzeFile(rel: string) {
    const st = this.files.get(rel);
    if (!st) return;
    for (const [id, b] of this.blocks) if (b.file === rel) this.blocks.delete(id);
    const ctx = this.analysisContext(st.kind === 'entity' ? st.ownerId : undefined);
    const analyzed = analyzeBlocks(st.blocks, ctx);
    st.blocks.forEach((pb, i) => {
      if (!pb.id) return;
      const a = analyzed[i];
      this.pending.push(...a.creates);
      this.meta.touch(pb.id, pb.text, this.author);
      this.blocks.set(pb.id, {
        id: pb.id,
        file: rel,
        owner: { kind: st.kind, id: st.ownerId },
        position: i,
        kind: pb.kind,
        headingLevel: pb.headingLevel,
        text: pb.text,
        filedTo: a.filedTo,
        links: a.links,
        optOuts: a.optOuts,
        fields: a.fields.map((f) => ({ ...f, blockId: pb.id! })),
        relations: a.relations.map((r) => ({ ...r, blockId: pb.id! })),
        warnings: a.warnings,
        eventDate: a.eventDate,
        pinned: a.pinned,
      });
    });
  }

  private analyzeAll() {
    this.blocks.clear();
    for (const rel of this.files.keys()) this.analyzeFile(rel);
  }

  /** Create entities for `@@Name` and `#topic` markers that don't resolve yet. */
  private async createPending(): Promise<string[]> {
    const pending = this.pending;
    this.pending = [];
    const created: string[] = [];
    const seen = new Set<string>();
    for (const p of pending) {
      const key = normalizeName(p.name);
      if (seen.has(key) || this.names.resolve(p.name).status !== 'missing') continue;
      seen.add(key);
      const type = p.via === 'topic' ? this.topicType() : this.settings.lastUsedType ?? this.settings.defaultEntityType;
      // "#grace-and-repentance" creates the topic "Grace and repentance".
      const name = p.via === 'topic' ? p.name.charAt(0).toUpperCase() + p.name.slice(1) : p.name;
      const e = await this.writeNewEntity(name, type);
      created.push(e.id);
    }
    if (created.length) {
      this.rebuildNames();
      this.analyzeAll();
      this.pending = [];
    }
    return created;
  }

  topicType(): string {
    if (this.templates.has('topic')) return 'topic';
    return [...this.templates.keys()].find((k) => k.includes('topic')) ?? this.settings.defaultEntityType;
  }

  // ---------------------------------------------------------------- info

  info(): VaultInfo {
    return {
      root: this.root,
      settings: this.settings,
      templates: [...this.templates.values()],
      relationTypes: [...this.relationTypes.values()],
      counts: { entries: this.entries.size, entities: this.entities.size, blocks: this.blocks.size },
    };
  }

  template(typeId: string): ResolvedTemplate {
    return this.templates.get(typeId) ?? fallbackTemplate(typeId);
  }

  chip(e: EntityRecord): EntityChip {
    const t = this.template(e.type);
    return { id: e.id, name: e.name, type: e.type, typeName: t.name, aliases: e.aliases, color: colorFor(e.id) };
  }

  nameData(): NameData {
    return {
      entities: [...this.entities.values()].map((e) => this.chip(e)),
      templates: [...this.templates.values()],
      relationTypes: [...this.relationTypes.values()],
      settings: this.settings,
    };
  }

  // ---------------------------------------------------------------- entries

  getEntry(id: string) {
    const e = this.entries.get(id);
    if (!e) throw new Error(`No entry ${id}`);
    const st = this.files.get(e.file)!;
    const format = (st.frontmatter.format && typeof st.frontmatter.format === 'object' ? st.frontmatter.format : {}) as DocFormat;
    return { ...e, body: st.body, words: this.wordsOf(e.file), format };
  }

  private wordsOf(rel: string): number {
    const st = this.files.get(rel);
    if (!st) return 0;
    let n = 0;
    for (const b of st.blocks) n += countWords(plainText(b.text, this.names));
    return n;
  }

  private entryDir(e: EntryRecord): string {
    return e.file.replace(/\.md$/, '');
  }

  private async uniquePath(dir: string, base: string, ext = '.md'): Promise<string> {
    let n = 1;
    let rel = `${dir}/${base}${ext}`;
    while (existsSync(this.abs(rel)) || (ext === '' && existsSync(this.abs(`${rel}.md`)))) {
      n++;
      rel = `${dir}/${base} ${n}${ext}`;
    }
    return rel;
  }

  createEntry(opts: { title: string; parent?: BinderParent; body?: string; index?: number }) {
    return this.exclusive(async () => {
      const dir = this.parentDir(opts.parent);
      const rel = await this.uniquePath(dir, slugify(opts.title || 'Untitled'));
      const id = newId('n');
      const fm = { id, title: opts.title || 'Untitled', created: new Date().toISOString().slice(0, 10), status: 'draft' };
      await this.writeRel(rel, stringifyFile(fm, opts.body ?? ''));
      await this.loadEntryFile(rel);
      await this.ensureBlockIds(rel);
      this.analyzeFile(rel);
      await this.createPending();
      this.addToOrder(this.relDirKey(dir), path.basename(rel), opts.index);
      await this.saveBinderOrder();
      await this.meta.flush();
      this.emit({ files: [rel], entities: false, binder: true });
      return this.getEntry(id);
    });
  }

  /**
   * Save an entry's body from the editor. Missing block ids are added, `@@` and
   * `#topic` markers create entities, and history is recorded. Returns the body
   * as saved (which differs from the input only if ids had to be added/fixed).
   */
  saveEntry(id: string, body: string) {
    return this.exclusive(async () => {
      const e = this.entries.get(id);
      if (!e) throw new Error(`No entry ${id}`);
      return this.saveBody(e.file, body);
    });
  }

  saveEntityNotes(id: string, body: string) {
    return this.exclusive(async () => {
      const e = this.entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      return this.saveBody(e.file, body);
    });
  }

  private async saveBody(rel: string, body: string) {
    const st = this.files.get(rel)!;
    body = body.replace(/\r\n/g, '\n');
    const edits = planBlockIds(body, (bid) => {
      const other = this.blocks.get(bid)?.file;
      return !!other && other !== rel && this.files.get(other)!.blocks.some((b) => b.id === bid);
    });
    const finalBody = applyEdits(body, edits);
    const removed = st.blocks.filter((b) => b.id && !splitBlocks(finalBody).some((nb) => nb.id === b.id)).map((b) => b.id!);
    st.body = finalBody;
    st.blocks = splitBlocks(finalBody);
    await this.writeRel(rel, stringifyFile(st.frontmatter, finalBody));
    this.analyzeFile(rel);
    for (const bid of removed) if (!this.blocks.has(bid)) this.meta.setStatus(bid, 'deleted', this.author);
    const created = await this.createPending();
    await this.meta.flush();
    this.emit({ files: [rel], entities: created.length > 0 });
    return { body: finalBody, changed: finalBody !== body, created: created.map((cid) => this.chip(this.entities.get(cid)!)) };
  }

  updateEntry(id: string, patch: { title?: string; status?: EntryStatus; format?: DocFormat | null }) {
    return this.exclusive(async () => {
      const e = this.entries.get(id);
      if (!e) throw new Error(`No entry ${id}`);
      const st = this.files.get(e.file)!;
      if (patch.status) st.frontmatter.status = patch.status;
      if (patch.format !== undefined) st.frontmatter.format = patch.format && Object.keys(patch.format).length ? patch.format : undefined;
      let rel = e.file;
      if (patch.title !== undefined && patch.title.trim() && patch.title !== e.title) {
        st.frontmatter.title = patch.title.trim();
        const dir = path.posix.dirname(rel);
        const target = await this.uniquePath(dir, slugify(patch.title));
        await this.writeRel(rel, stringifyFile(st.frontmatter, st.body));
        await this.moveFileWithChildren(rel, target);
        this.renameInOrder(this.relDirKey(dir), path.basename(rel), path.basename(target));
        await this.saveBinderOrder();
        await this.rebuildIndex();
        rel = target;
      } else {
        await this.writeRel(rel, stringifyFile(st.frontmatter, st.body));
        await this.loadEntryFile(rel);
        this.analyzeFile(rel);
      }
      this.emit({ files: [rel], entities: false, binder: true });
      return this.getEntry(id);
    });
  }

  deleteEntry(id: string) {
    return this.exclusive(async () => {
      const e = this.entries.get(id);
      if (!e) throw new Error(`No entry ${id}`);
      await this.toTrash(e.file);
      const kids = this.entryDir(e);
      if (existsSync(this.abs(kids))) await this.toTrash(kids);
      await this.rebuildIndex();
      this.emit({ files: [e.file], entities: false, binder: true });
    });
  }

  private async toTrash(rel: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = this.abs(`.trash/${stamp}/${rel}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(this.abs(rel), dest);
  }

  // ---------------------------------------------------------------- binder

  private parentDir(parent?: BinderParent): string {
    if (!parent || parent.kind === 'root') return 'entries';
    if (parent.kind === 'folder') return parent.path;
    const e = this.entries.get(parent.id);
    if (!e) throw new Error(`No entry ${parent.id}`);
    return this.entryDir(e);
  }

  private relDirKey(dir: string): string {
    return dir === 'entries' ? '' : dir.replace(/^entries\//, '');
  }

  private addToOrder(key: string, name: string, index?: number) {
    const list = (this.binderOrder[key] ??= []).filter((n) => n !== name);
    if (index === undefined || index < 0 || index > list.length) list.push(name);
    else list.splice(index, 0, name);
    this.binderOrder[key] = list;
  }

  private renameInOrder(key: string, from: string, to: string) {
    const list = this.binderOrder[key];
    if (!list) return;
    const i = list.indexOf(from);
    if (i >= 0) list[i] = to;
  }

  private async saveBinderOrder() {
    await this.writeRel('binder.yaml', YAML.stringify({ order: this.binderOrder }));
  }

  async getBinder(): Promise<BinderNode[]> {
    const byFile = new Map([...this.entries.values()].map((e) => [e.file, e]));
    const build = async (dir: string): Promise<BinderNode[]> => {
      let items: import('node:fs').Dirent[] = [];
      try {
        items = await fs.readdir(this.abs(dir), { withFileTypes: true });
      } catch {
        return [];
      }
      const names = new Set(items.map((i) => i.name));
      const nodes: Array<BinderNode & { key: string }> = [];
      for (const it of items) {
        if (it.name.startsWith('.')) continue;
        const rel = `${dir}/${it.name}`;
        if (it.isDirectory()) {
          if (names.has(`${it.name}.md`)) continue; // children of a document
          const children = await build(rel);
          nodes.push({ kind: 'folder', id: rel, name: it.name, path: rel, words: children.reduce((n, c) => n + c.words, 0), children, key: it.name });
        } else if (it.name.endsWith('.md')) {
          const e = byFile.get(rel);
          if (!e) continue;
          const kidsDir = rel.replace(/\.md$/, '');
          const children = names.has(it.name.replace(/\.md$/, '')) ? await build(kidsDir) : [];
          const own = this.wordsOf(rel);
          nodes.push({ kind: 'entry', id: e.id, name: e.title, path: rel, status: e.status, words: own + children.reduce((n, c) => n + c.words, 0), children, key: it.name });
        }
      }
      const order = this.binderOrder[this.relDirKey(dir)] ?? [];
      nodes.sort((a, b) => {
        const ia = order.indexOf(a.key);
        const ib = order.indexOf(b.key);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
        return a.name.localeCompare(b.name);
      });
      return nodes.map(({ key: _k, ...n }) => n);
    };
    return build('entries');
  }

  createFolder(opts: { name: string; parent?: BinderParent; index?: number }) {
    return this.exclusive(async () => {
      const dir = this.parentDir(opts.parent);
      const rel = await this.uniquePath(dir, slugify(opts.name || 'New folder'), '');
      await fs.mkdir(this.abs(rel), { recursive: true });
      this.addToOrder(this.relDirKey(dir), path.posix.basename(rel), opts.index);
      await this.saveBinderOrder();
      this.emit({ files: [], entities: false, binder: true });
      return rel;
    });
  }

  renameFolder(folderPath: string, name: string) {
    return this.exclusive(async () => {
      const dir = path.posix.dirname(folderPath);
      const target = await this.uniquePath(dir, slugify(name), '');
      await fs.rename(this.abs(folderPath), this.abs(target));
      this.renameInOrder(this.relDirKey(dir), path.posix.basename(folderPath), path.posix.basename(target));
      this.remapOrderKeys(folderPath, target);
      await this.saveBinderOrder();
      await this.rebuildIndex();
      this.emit({ files: [], entities: false, binder: true });
      return target;
    });
  }

  deleteFolder(folderPath: string) {
    return this.exclusive(async () => {
      if (!folderPath.startsWith('entries/')) throw new Error('Not a binder folder');
      await this.toTrash(folderPath);
      await this.rebuildIndex();
      this.emit({ files: [], entities: false, binder: true });
    });
  }

  private remapOrderKeys(fromDir: string, toDir: string) {
    const from = this.relDirKey(fromDir);
    const to = this.relDirKey(toDir);
    for (const k of Object.keys(this.binderOrder)) {
      if (k === from || k.startsWith(`${from}/`)) {
        this.binderOrder[to + k.slice(from.length)] = this.binderOrder[k];
        delete this.binderOrder[k];
      }
    }
  }

  private async moveFileWithChildren(fromRel: string, toRel: string) {
    if (fromRel === toRel) return;
    await fs.mkdir(path.dirname(this.abs(toRel)), { recursive: true });
    await fs.rename(this.abs(fromRel), this.abs(toRel));
    const fromKids = fromRel.replace(/\.md$/, '');
    const toKids = toRel.replace(/\.md$/, '');
    if (existsSync(this.abs(fromKids))) {
      await fs.rename(this.abs(fromKids), this.abs(toKids));
      this.remapOrderKeys(fromKids, toKids);
    }
  }

  /** Drag-and-drop in the binder: reorder or re-nest a node. */
  moveNode(node: { kind: 'folder' | 'entry'; id: string }, parent: BinderParent, index?: number) {
    return this.exclusive(async () => {
      const destDir = this.parentDir(parent);
      let fromRel: string;
      if (node.kind === 'entry') {
        const e = this.entries.get(node.id);
        if (!e) throw new Error(`No entry ${node.id}`);
        fromRel = e.file;
        if (destDir === this.entryDir(e) || destDir.startsWith(`${this.entryDir(e)}/`)) throw new Error('Cannot move a document inside itself');
      } else {
        fromRel = node.id;
        if (destDir === fromRel || destDir.startsWith(`${fromRel}/`)) throw new Error('Cannot move a folder inside itself');
      }
      const fromDir = path.posix.dirname(fromRel);
      const name = path.posix.basename(fromRel);
      let toRel = `${destDir}/${name}`;
      if (fromDir !== destDir) {
        toRel = node.kind === 'entry' ? await this.uniquePath(destDir, name.replace(/\.md$/, '')) : await this.uniquePath(destDir, name, '');
        if (node.kind === 'entry') await this.moveFileWithChildren(fromRel, toRel);
        else {
          await fs.mkdir(this.abs(destDir), { recursive: true });
          await fs.rename(this.abs(fromRel), this.abs(toRel));
          this.remapOrderKeys(fromRel, toRel);
        }
        const oldKey = this.relDirKey(fromDir);
        this.binderOrder[oldKey] = (this.binderOrder[oldKey] ?? []).filter((n) => n !== name);
      } else if (!this.binderOrder[this.relDirKey(destDir)]?.length) {
        // First manual reorder in this folder: freeze the current (alphabetical) order.
        const current = (await this.getBinderAt(destDir)).map((n) => path.posix.basename(n.path));
        this.binderOrder[this.relDirKey(destDir)] = current;
      }
      this.addToOrder(this.relDirKey(destDir), path.posix.basename(toRel), index);
      await this.saveBinderOrder();
      if (fromRel !== toRel) await this.rebuildIndex();
      this.emit({ files: [toRel], entities: false, binder: true });
    });
  }

  private async getBinderAt(dir: string): Promise<BinderNode[]> {
    const find = (nodes: BinderNode[]): BinderNode[] | undefined => {
      if (dir === 'entries') return nodes;
      for (const n of nodes) {
        const kids = n.kind === 'entry' ? n.path.replace(/\.md$/, '') : n.path;
        if (kids === dir) return n.children;
        const r = find(n.children);
        if (r) return r;
      }
      return undefined;
    };
    return find(await this.getBinder()) ?? [];
  }

  // ---------------------------------------------------------------- entities

  private async writeNewEntity(name: string, type: string, extra: { aliases?: string[]; summary?: string } = {}): Promise<EntityRecord> {
    const tpl = this.template(type);
    const dir = `entities/${tpl.folder ?? 'other'}`;
    const rel = await this.uniquePath(dir, slugify(name));
    const id = this.freshEntityId();
    const fm: Record<string, unknown> = {
      id,
      type,
      name,
      aliases: extra.aliases ?? [],
      created: new Date().toISOString().slice(0, 10),
    };
    if (extra.summary) fm.summary = extra.summary;
    fm.fields = {};
    fm.skeleton = true;
    const body = this.skeletonFor(tpl, '');
    await this.writeRel(rel, stringifyFile(fm, body));
    await this.loadEntityFile(rel);
    await this.ensureBlockIds(rel);
    return this.entities.get(id)!;
  }

  /** The template's sections as headings, like the blank pages of a document template. */
  private skeletonFor(tpl: ResolvedTemplate, body: string): string {
    const have = new Set(
      splitBlocks(body)
        .filter((b) => b.kind === 'heading')
        .map((b) => plainText(b.text).toLowerCase()),
    );
    const missing = tpl.sections.filter((sec) => sec !== 'Summary' && !have.has(sec.toLowerCase()));
    if (!missing.length) return body;
    const add = missing.map((sec) => `## ${sec}`).join('\n\n');
    return body.trim() ? `${body.trimEnd()}\n\n${add}\n` : `${add}\n`;
  }

  /**
   * Give an older profile its template headings once, so it opens as a document.
   * Afterwards the headings are yours: delete or add them freely.
   */
  ensureSkeleton(id: string) {
    return this.exclusive(async () => {
      const e = this.entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      const st = this.files.get(e.file)!;
      if (st.frontmatter.skeleton) return false;
      st.frontmatter.skeleton = true;
      const body = this.skeletonFor(this.template(e.type), st.body);
      await this.writeRel(e.file, stringifyFile(st.frontmatter, body));
      st.body = body;
      st.blocks = splitBlocks(body);
      await this.ensureBlockIds(e.file);
      this.analyzeFile(e.file);
      await this.meta.flush();
      this.emit({ files: [e.file], entities: false });
      return true;
    });
  }

  // ---------------------------------------------------------------- templates

  /** Save an edited type definition (fields and sections) back to templates/<id>.yaml. */
  saveTemplate(def: TemplateDef) {
    return this.exclusive(async () => {
      if (!def.id || !/^[a-z0-9][a-z0-9-]*$/.test(def.id)) throw new Error('A template id uses lowercase letters, digits and dashes');
      if (!def.name?.trim()) throw new Error('A template needs a name');
      const clean: TemplateDef = {
        ...def,
        fields: (def.fields ?? []).filter((f) => f.key && f.label),
        sections: (def.sections ?? []).map((x) => x.trim()).filter(Boolean),
      };
      await this.writeRel(`templates/${def.id}.yaml`, YAML.stringify(clean, { lineWidth: 0 }));
      await this.loadConfig();
      this.analyzeAll();
      await this.meta.flush();
      this.emit({ files: [`templates/${def.id}.yaml`], entities: true });
      return this.template(def.id);
    });
  }

  rawTemplate(id: string): TemplateDef {
    const def = this.templateDefs.find((t) => t.id === id);
    if (!def) throw new Error(`No template ${id}`);
    return def;
  }

  /**
   * Bring in fields, sections and relationship types that newer starter packs added,
   * without removing or changing anything you edited. Returns what was added.
   */
  upgradeTemplates() {
    return this.exclusive(async () => {
      const pack = STARTER_PACKS.find((p) => p.id === this.settings.mode);
      const added: string[] = [];
      if (!pack) return added;
      for (const starter of pack.templates) {
        const mine = this.templateDefs.find((t) => t.id === starter.id);
        if (!mine) continue;
        const keys = new Set((mine.fields ?? []).map((f) => f.key));
        const newFields = (starter.fields ?? []).filter((f) => !keys.has(f.key));
        // Upgrade two-way links on fields you already have.
        let changedInverse = false;
        for (const f of mine.fields ?? []) {
          const sf = starter.fields.find((x) => x.key === f.key);
          if (sf?.inverse && !f.inverse) {
            f.inverse = sf.inverse;
            changedInverse = true;
          }
        }
        if (!newFields.length && !changedInverse) continue;
        mine.fields = [...(mine.fields ?? []), ...newFields];
        await this.writeRel(`templates/${mine.id}.yaml`, YAML.stringify(mine, { lineWidth: 0 }));
        added.push(...newFields.map((f) => `${mine.name}: ${f.label}`));
      }
      const relIds = new Set(this.relationTypes.keys());
      const newRels = pack.relations.filter((r) => !relIds.has(r.id));
      if (newRels.length) {
        await this.writeRel('relations.yaml', YAML.stringify([...this.relationTypes.values(), ...newRels], { lineWidth: 0 }));
        added.push(...newRels.map((r) => `Relationship: ${r.label}`));
      }
      if (added.length) {
        await this.loadConfig();
        this.analyzeAll();
        await this.meta.flush();
        this.emit({ files: [], entities: true });
      }
      return added;
    });
  }

  createEntity(opts: { name: string; type: string; aliases?: string[]; summary?: string }) {
    return this.exclusive(async () => {
      const name = opts.name.trim();
      if (!name) throw new Error('A name is required');
      const existing = this.names.resolve(name);
      if (existing.status === 'ok' && normalizeName(this.entities.get(existing.id)!.name) === normalizeName(name)) {
        return this.chip(this.entities.get(existing.id)!);
      }
      if (!this.templates.has(opts.type)) throw new Error(`Unknown type ${opts.type}`);
      const e = await this.writeNewEntity(name, opts.type, opts);
      if (opts.type !== this.topicType()) {
        this.settings.lastUsedType = opts.type;
        await this.writeRel('settings.yaml', YAML.stringify(this.settings));
      }
      this.rebuildNames();
      this.analyzeAll();
      await this.meta.flush();
      this.emit({ files: [e.file], entities: true });
      return this.chip(e);
    });
  }

  updateEntity(id: string, patch: { aliases?: string[]; summary?: string; keywords?: string[]; fields?: Record<string, unknown>; type?: string }) {
    return this.exclusive(async () => {
      const e = this.entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      const st = this.files.get(e.file)!;
      const fm = st.frontmatter;
      if (patch.aliases) fm.aliases = patch.aliases.map((a) => a.trim()).filter(Boolean);
      if (patch.summary !== undefined) fm.summary = patch.summary || undefined;
      if (patch.keywords) fm.keywords = patch.keywords;
      if (patch.fields) {
        const cur = (fm.fields as Record<string, unknown>) ?? {};
        for (const [k, v] of Object.entries(patch.fields)) {
          if (v === null || v === '' || (Array.isArray(v) && !v.length)) delete cur[k];
          else cur[k] = v;
        }
        fm.fields = cur;
      }
      let rel = e.file;
      if (patch.type && patch.type !== e.type) {
        if (!this.templates.has(patch.type)) throw new Error(`Unknown type ${patch.type}`);
        fm.type = patch.type;
        const target = await this.uniquePath(`entities/${this.template(patch.type).folder}`, slugify(e.name));
        await this.writeRel(rel, stringifyFile(fm, st.body));
        await fs.mkdir(path.dirname(this.abs(target)), { recursive: true });
        await fs.rename(this.abs(rel), this.abs(target));
        this.files.delete(rel);
        rel = target;
      } else {
        await this.writeRel(rel, stringifyFile(fm, st.body));
      }
      await this.loadEntityFile(rel);
      this.rebuildNames();
      this.analyzeAll();
      await this.meta.flush();
      this.emit({ files: [rel], entities: true });
      return this.chip(this.entities.get(id)!);
    });
  }

  /**
   * Rename an entity (spec 4.2, T14): every tag in every file is rewritten and
   * the old name is kept as an alias.
   */
  renameEntity(id: string, newName: string) {
    return this.exclusive(async () => {
      const e = this.entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      newName = newName.trim();
      if (!newName || newName === e.name) return this.chip(e);
      const clash = this.names.resolve(newName);
      if (clash.status === 'ok' && clash.id !== id && normalizeName(this.entities.get(clash.id)!.name) === normalizeName(newName)) {
        throw new Error(`"${newName}" is already the name of another entity`);
      }
      const oldName = e.name;
      const oldNames = this.names;
      const after = new NameTable(
        [...this.entities.values()].map((x) =>
          x.id === id ? { id, name: newName, aliases: [...new Set([...x.aliases, oldName])] } : { id: x.id, name: x.name, aliases: x.aliases },
        ),
      );
      const changed: string[] = [];
      for (const [rel, st] of this.files) {
        const newBody = rewriteReferences(st.body, id, oldName, newName, oldNames, after);
        let fmChanged = false;
        if (st.kind === 'entity' && st.frontmatter.fields) {
          const s = JSON.stringify(st.frontmatter.fields);
          const fields = rewriteFieldRefs(st.frontmatter.fields as Record<string, unknown>, id, newName, oldNames);
          if (JSON.stringify(fields) !== s) {
            st.frontmatter.fields = fields;
            fmChanged = true;
          }
        }
        if (st.ownerId === id && st.kind === 'entity') {
          st.frontmatter.name = newName;
          st.frontmatter.aliases = [...new Set([...(e.aliases ?? []), oldName])];
          fmChanged = true;
        }
        if (newBody !== st.body || fmChanged) {
          await this.writeRel(rel, stringifyFile(st.frontmatter, newBody));
          changed.push(rel);
        }
      }
      // Move the profile file to match the new name.
      const target = await this.uniquePath(path.posix.dirname(e.file), slugify(newName));
      await fs.rename(this.abs(e.file), this.abs(target));
      await this.rebuildIndex();
      this.emit({ files: [...changed, target], entities: true });
      return this.chip(this.entities.get(id)!);
    });
  }

  deleteEntity(id: string) {
    return this.exclusive(async () => {
      const e = this.entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      await this.toTrash(e.file);
      await this.rebuildIndex();
      this.emit({ files: [e.file], entities: true });
    });
  }

  // ---------------------------------------------------------------- blocks

  getBlock(id: string): BlockRecord {
    const b = this.blocks.get(id);
    if (!b) throw new Error(`No block ${id}`);
    return b;
  }

  sourceTitle(b: BlockRecord): string {
    return b.owner.kind === 'entry' ? this.entries.get(b.owner.id)?.title ?? b.file : this.entities.get(b.owner.id)?.name ?? b.file;
  }

  /** Every page a block appears on: its home plus each profile it is filed to. */
  blockPages(id: string): Array<{ kind: 'entry' | 'entity'; id: string; title: string }> {
    const b = this.getBlock(id);
    const pages: Array<{ kind: 'entry' | 'entity'; id: string; title: string }> = [{ kind: b.owner.kind, id: b.owner.id, title: this.sourceTitle(b) }];
    for (const f of b.filedTo) {
      if (b.owner.kind === 'entity' && f.entityId === b.owner.id) continue;
      pages.push({ kind: 'entity', id: f.entityId, title: this.entities.get(f.entityId)?.name ?? f.entityId });
    }
    return pages;
  }

  /** Edit a shared block from any page; saved to its home file (spec 8, T7). */
  updateBlock(id: string, text: string) {
    return this.exclusive(async () => {
      const b = this.getBlock(id);
      const st = this.files.get(b.file)!;
      const clean = text.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trimEnd();
      const body = replaceBlockInBody(st.body, id, clean);
      if (body === null) throw new Error(`Block ${id} not found in ${b.file}`);
      return this.saveBody(b.file, body);
    });
  }

  deleteBlock(id: string) {
    return this.exclusive(async () => {
      const b = this.getBlock(id);
      const st = this.files.get(b.file)!;
      const body = removeBlockFromBody(st.body, id);
      if (body === null) throw new Error(`Block ${id} not found`);
      return this.saveBody(b.file, body);
    });
  }

  /** Take a block off one profile only (the ✕ on a profile view). */
  removeTag(blockId: string, entityId: string) {
    return this.exclusive(async () => {
      const b = this.getBlock(blockId);
      const f = b.filedTo.find((x) => x.entityId === entityId);
      if (!f) return { body: '', changed: false, created: [] };
      if (f.via === 'direct') throw new Error('This note is written on the profile itself. Delete it instead, or move it to an entry.');
      let text = b.text;
      const tokens = tokenize(text, this.names).filter(
        (t): t is TagToken => t.kind === 'tag' && !t.bare && !t.optOut && this.names.resolve(t.name).status === 'ok' && (this.names.resolve(t.name) as { id: string }).id === entityId,
      );
      for (const t of [...tokens].reverse()) text = text.slice(0, t.from) + (t.display ?? t.name) + text.slice(t.to);
      // Topic chips
      for (const t of tokenize(text, this.names).reverse()) {
        if (t.kind === 'topic') {
          const r = this.names.resolve(t.name);
          if (r.status === 'ok' && r.id === entityId) text = text.slice(0, t.from) + t.name + text.slice(t.to);
        }
      }
      // Still filed through a section heading? Opt out for this block only.
      const st = this.files.get(b.file)!;
      const probe = st.blocks.map((pb) => (pb.id === blockId ? { ...pb, text } : pb));
      const analyzed = analyzeBlocks(probe, this.analysisContext(st.kind === 'entity' ? st.ownerId : undefined));
      const idx = probe.findIndex((pb) => pb.id === blockId);
      if (analyzed[idx].filedTo.some((x) => x.entityId === entityId)) {
        const e = this.entities.get(entityId)!;
        text = `${text} ${formatTag(e.name).replace(/^@/, '@-')}`;
      }
      const body = replaceBlockInBody(st.body, blockId, text)!;
      return this.saveBody(b.file, body);
    });
  }

  blockHistory(id: string) {
    const meta = this.meta.get(id);
    return meta ?? null;
  }

  restoreBlockVersion(id: string, index: number) {
    const meta = this.meta.get(id);
    const h = meta?.history[index];
    if (!h) throw new Error('No such version');
    return this.updateBlock(id, h.text);
  }

  /** Append a direct note to a profile section (writes into the entity's own file). */
  addProfileNote(entityId: string, section: string | undefined, text: string) {
    return this.exclusive(async () => {
      const e = this.entities.get(entityId);
      if (!e) throw new Error(`No entity ${entityId}`);
      const st = this.files.get(e.file)!;
      const blocks = st.blocks;
      let body = st.body;
      const clean = text.trim();
      if (!clean) return { body, changed: false, created: [] };
      if (section) {
        const hi = blocks.findIndex((b) => b.kind === 'heading' && plainText(b.text).toLowerCase() === section.toLowerCase());
        if (hi >= 0) {
          const level = blocks[hi].headingLevel ?? 2;
          let end = hi;
          for (let k = hi + 1; k < blocks.length; k++) {
            if (blocks[k].kind === 'heading' && (blocks[k].headingLevel ?? 2) <= level) break;
            end = k;
          }
          const at = blocks[end].to;
          body = `${body.slice(0, at)}\n\n${clean}${body.slice(at)}`;
        } else {
          body = `${body.trimEnd()}${body.trim() ? '\n\n' : ''}## ${section}\n\n${clean}\n`;
        }
      } else {
        body = `${body.trimEnd()}${body.trim() ? '\n\n' : ''}${clean}\n`;
      }
      return this.saveBody(e.file, body);
    });
  }

  // ---------------------------------------------------------------- external edits

  /** Called by the file watcher. Re-indexes a file edited outside the program (T20). */
  async handleExternalChange(absPath: string): Promise<boolean> {
    const rel = toPosix(path.relative(this.root, absPath));
    if (rel.startsWith('..') || rel.startsWith('.index') || rel.startsWith('.meta') || rel.startsWith('.trash')) return false;
    return this.exclusive(async () => {
      let content: string | null = null;
      try {
        content = (await fs.readFile(absPath, 'utf8')).replace(/\r\n/g, '\n');
      } catch {
        content = null;
      }
      if (content !== null && this.written.get(rel) === content) return false;
      if (content !== null) this.written.set(rel, content);
      if (rel.endsWith('.yaml') || content === null || !this.files.has(rel)) {
        // Config changes, deletions and new files: rebuild everything.
        await this.rebuildIndex();
        this.emit({ files: [rel], entities: true, binder: true, external: true });
        return true;
      }
      const st = this.files.get(rel)!;
      if (st.kind === 'entity') {
        this.entities.delete(st.ownerId);
        this.files.delete(rel);
        await this.loadEntityFile(rel, content);
        this.rebuildNames();
        await this.ensureBlockIds(rel);
        this.analyzeAll();
      } else {
        this.files.delete(rel);
        this.entries.delete(st.ownerId);
        await this.loadEntryFile(rel, content);
        await this.ensureBlockIds(rel);
        this.analyzeFile(rel);
      }
      const created = await this.createPending();
      await this.meta.flush();
      this.emit({ files: [rel], entities: st.kind === 'entity' || created.length > 0, binder: true, external: true });
      return true;
    });
  }

  // ---------------------------------------------------------------- queries used by views

  blocksFiledTo(entityId: string): BlockRecord[] {
    const out: BlockRecord[] = [];
    for (const b of this.blocks.values()) if (b.filedTo.some((f) => f.entityId === entityId)) out.push(b);
    return out;
  }

  blocksLinking(entityId: string): BlockRecord[] {
    const out: BlockRecord[] = [];
    for (const b of this.blocks.values()) if (b.links.includes(entityId)) out.push(b);
    return out;
  }

  relationsOf(entityId: string): RelationRecord[] {
    const out: RelationRecord[] = [];
    for (const b of this.blocks.values()) for (const r of b.relations) if (r.subject === entityId || r.object === entityId) out.push(r);
    return out;
  }
}

export type BinderParent = { kind: 'root' } | { kind: 'folder'; path: string } | { kind: 'entry'; id: string };

// ---------------------------------------------------------------- rename helpers

function rewriteReferences(body: string, id: string, oldName: string, newName: string, before: NameTable, after: NameTable): string {
  const blocks = splitBlocks(body);
  let out = body;
  for (const b of [...blocks].reverse()) {
    const text = b.text;
    const tokens = tokenize(text, before);
    const edits: Array<{ from: number; to: number; insert: string }> = [];
    const refersToEntity = (name: string) => {
      const r = before.resolve(name);
      return r.status === 'ok' && r.id === id;
    };
    const stillResolves = (name: string) => {
      const r = after.resolve(name);
      return r.status === 'ok' && r.id === id && normalizeName(name) !== normalizeName(oldName);
    };
    for (const t of tokens) {
      if (t.kind === 'tag' && !t.bare && refersToEntity(t.name) && !stillResolves(t.name)) {
        const prefix = t.create ? '@@' : t.optOut ? '@-' : '@';
        let tag = formatTag(newName).replace(/^@/, prefix);
        if (t.display) tag = tag.startsWith(`${prefix}[`) ? `${tag.slice(0, -1)}|${t.display}]` : `${tag}|${/\s/.test(t.display) ? `[${t.display}]` : t.display}`;
        if (t.section) tag += `::${/\s/.test(t.section) ? `[${t.section}]` : t.section}`;
        edits.push({ from: t.from, to: t.to, insert: tag });
      } else if (t.kind === 'tag' && t.bare && b.kind === 'heading') {
        const title = text.replace(/^#{1,6}\s+/, '').replace(/\s@\s*$/, '').trim();
        if (refersToEntity(title) && normalizeName(title) === normalizeName(oldName)) {
          const at = text.indexOf(title);
          edits.push({ from: at, to: at + title.length, insert: newName });
        }
      } else if (t.kind === 'link' && refersToEntity(t.name) && !stillResolves(t.name)) {
        edits.push({ from: t.from, to: t.to, insert: `[[${newName}${t.display ? `|${t.display}` : ''}]]` });
      } else if (t.kind === 'topic' && refersToEntity(t.name) && !stillResolves(t.name)) {
        edits.push({ from: t.from, to: t.to, insert: `#${newName.trim().replace(/\s+/g, '-').toLowerCase()}` });
      } else if (t.kind === 'field') {
        let raw = text.slice(t.from, t.to);
        const orig = raw;
        if (t.entity && refersToEntity(t.entity) && !stillResolves(t.entity)) {
          const dot = raw.indexOf(`${t.entity}.`);
          if (dot >= 0) raw = raw.slice(0, dot) + newName + raw.slice(dot + t.entity.length);
        }
        const v = t.value.replace(/^@+/, '');
        if (t.value.startsWith('@') && refersToEntity(v) && !stillResolves(v)) raw = raw.replace(`@${v}`, `@${newName}`);
        if (raw !== orig) edits.push({ from: t.from, to: t.to, insert: raw });
      }
    }
    if (!edits.length) continue;
    const newText = applyEdits(text, edits);
    out = out.slice(0, b.from) + blockSource({ text: newText, id: b.id }) + out.slice(b.to);
  }
  return out;
}

function rewriteFieldRefs(fields: Record<string, unknown>, id: string, newName: string, before: NameTable): Record<string, unknown> {
  const fix = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith('@')) {
      const r = before.resolve(v.slice(1));
      if (r.status === 'ok' && r.id === id) return `@${newName}`;
    }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  return fix(fields) as Record<string, unknown>;
}
