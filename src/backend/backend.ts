// The backend the UI talks to. The Electron main process exposes it over IPC;
// the browser dev server exposes the same methods over HTTP. One method table,
// so the two can never drift apart.

import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { Vault, type BinderParent, type ChangeEvent } from '../core/vault';
import { buildProfile, blockView, keyDetails, quickSwitch, searchBlocks, type KeyDetailFilters, type SearchFilters } from '../core/views';
import { STARTER_PACKS } from '../core/templates';
import { DEFAULT_AUTOCORRECT, NAME_STOPWORDS, type AutocorrectPrefs } from '../core/autocorrect';
import type { EntryStatus, TemplateDef, ViewDef } from '../core/types';
import { buildGraph, buildTimeline } from '../core/graph';
import type { TriggerTheme } from '../core/triggers';
import { lookup, quoteFor, type LookupQuery, type LookupResult } from '../core/lookup';
import type { SavedLookup } from '../core/vault';
import { entityTable, parallelView, type EvidenceStance } from '../core/compare';

export interface RecentVault {
  path: string;
  name: string;
  openedAt: string;
}

export interface AppConfig {
  author: string;
  recent: RecentVault[];
  lastVault?: string;
  prefs?: UserPrefs;
}

export interface UserPrefs {
  spellcheck: boolean;
  autocorrect: AutocorrectPrefs;
}

export type BackendEvent = ({ type: 'changed' } & ChangeEvent) | { type: 'vault-opened' } | { type: 'vault-closed' };

export class Backend {
  vault: Vault | null = null;
  config: AppConfig = { author: safeUser(), recent: [] };
  private watcher: FSWatcher | null = null;
  private listeners = new Set<(e: BackendEvent) => void>();
  private unsub: (() => void) | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Other projects opened read-only for cross-project lookups. */
  private others = new Map<string, { vault: Vault; at: number }>();

  constructor(
    private configDir: string,
    private hooks: { pickFolder?: () => Promise<string | null>; revealPath?: (p: string) => void; onPrefs?: (p: UserPrefs) => void; onVaultOpened?: (words: string[]) => void } = {},
  ) {}

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.configDir, 'config.json'), 'utf8');
      this.config = { ...this.config, ...JSON.parse(raw) };
    } catch {
      // First launch.
    }
  }

  private async saveConfig() {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(path.join(this.configDir, 'config.json'), JSON.stringify(this.config, null, 2));
  }

  onEvent(fn: (e: BackendEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: BackendEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private v(): Vault {
    if (!this.vault) throw new Error('No vault is open');
    return this.vault;
  }

  // ------------------------------------------------------------ method table

  readonly methods = {
    appState: async () => ({
      author: this.config.author,
      recent: this.config.recent.filter((r) => existsSync(r.path)),
      lastVault: this.config.lastVault,
      defaultParent: path.join(os.homedir(), 'Documents', 'Living Repository'),
      packs: STARTER_PACKS.map((p) => ({ id: p.id, name: p.name, description: p.description, types: p.templates.map((t) => t.name) })),
      vault: this.vault ? this.vault.info() : null,
      canPickFolder: !!this.hooks.pickFolder,
    }),
    getPrefs: async (): Promise<UserPrefs> => ({
      spellcheck: this.config.prefs?.spellcheck ?? true,
      autocorrect: { ...DEFAULT_AUTOCORRECT, ...(this.config.prefs?.autocorrect ?? {}) },
    }),
    setPrefs: async (prefs: UserPrefs) => {
      this.config.prefs = prefs;
      await this.saveConfig();
      this.hooks.onPrefs?.(prefs);
      return prefs;
    },
    spellingWords: async () => {
      // Every word of every entity name, so the spell checker never flags your people and places.
      if (!this.vault) return [];
      const words = new Set<string>();
      for (const e of this.vault.entities.values()) for (const n of [e.name, ...e.aliases]) for (const w of n.split(/[\s-]+/)) if (/^[\p{L}'’]{2,}$/u.test(w) && !NAME_STOPWORDS.has(w.toLowerCase())) words.add(w);
      return [...words];
    },
    setAuthor: async (name: string) => {
      this.config.author = name.trim() || safeUser();
      if (this.vault) this.vault.author = this.config.author;
      await this.saveConfig();
      return this.config.author;
    },
    pickFolder: async () => (this.hooks.pickFolder ? this.hooks.pickFolder() : null),
    revealInFolder: async (rel?: string) => {
      const target = rel ? this.v().abs(rel) : this.v().root;
      this.hooks.revealPath?.(target);
      return target;
    },
    createVault: async (opts: { parent: string; name: string; pack: 'scholarship' | 'fantasy' | 'blank' }) => {
      const dir = path.join(opts.parent, opts.name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Vault');
      await Vault.create(dir, { name: opts.name, pack: opts.pack, author: this.config.author });
      return this.methods.openVault(dir);
    },
    openVault: async (dir: string) => {
      await this.closeVault();
      const vault = await Vault.open(dir, { author: this.config.author });
      this.vault = vault;
      this.unsub = vault.onChange((e) => this.emit({ type: 'changed', ...e }));
      this.startWatcher(vault);
      this.config.recent = [{ path: vault.root, name: vault.settings.name, openedAt: new Date().toISOString() }, ...this.config.recent.filter((r) => r.path !== vault.root)].slice(0, 12);
      this.config.lastVault = vault.root;
      await this.saveConfig();
      this.emit({ type: 'vault-opened' });
      this.hooks.onVaultOpened?.(await this.methods.spellingWords());
      return vault.info();
    },
    closeVault: async () => {
      await this.closeVault();
      this.config.lastVault = undefined;
      await this.saveConfig();
      this.emit({ type: 'vault-closed' });
      return true;
    },
    forgetRecent: async (p: string) => {
      this.config.recent = this.config.recent.filter((r) => r.path !== p);
      await this.saveConfig();
      return true;
    },

    vaultInfo: async () => this.v().info(),
    nameData: async () => this.v().nameData(),
    rebuildIndex: async () => this.v().rebuildIndex(),

    binder: async () => this.v().getBinder(),
    createEntry: async (opts: { title: string; parent?: BinderParent; index?: number }) => this.v().createEntry(opts),
    getEntry: async (id: string) => this.v().getEntry(id),
    saveEntry: async (id: string, body: string) => this.v().saveEntry(id, body),
    updateEntry: async (id: string, patch: Parameters<Vault['updateEntry']>[1]) => this.v().updateEntry(id, patch),
    deleteEntry: async (id: string) => this.v().deleteEntry(id),
    createFolder: async (opts: { name: string; parent?: BinderParent }) => this.v().createFolder(opts),
    renameFolder: async (p: string, name: string) => this.v().renameFolder(p, name),
    deleteFolder: async (p: string) => this.v().deleteFolder(p),
    moveNode: async (node: { kind: 'folder' | 'entry'; id: string }, parent: BinderParent, index?: number) => this.v().moveNode(node, parent, index),

    listEntities: async () => this.v().nameData().entities,
    createEntity: async (opts: { name: string; type: string; aliases?: string[] }) => this.v().createEntity(opts),
    updateEntity: async (id: string, patch: Parameters<Vault['updateEntity']>[1]) => this.v().updateEntity(id, patch),
    renameEntity: async (id: string, name: string) => this.v().renameEntity(id, name),
    deleteEntity: async (id: string) => this.v().deleteEntity(id),
    profile: async (id: string) => buildProfile(this.v(), id),
    ensureSkeleton: async (id: string) => this.v().ensureSkeleton(id),
    getTemplate: async (id: string) => this.v().rawTemplate(id),
    saveTemplate: async (def: TemplateDef) => this.v().saveTemplate(def),
    upgradeTemplates: async () => this.v().upgradeTemplates(),
    availableTemplates: async () => this.v().availableTemplates(),
    addTemplate: async (opts: { id?: string; name?: string }) => this.v().addTemplate(opts),
    listViews: async () => this.v().listViews(),
    createView: async (opts: Parameters<Vault['createView']>[0]) => this.v().createView(opts),
    saveView: async (def: ViewDef) => this.v().saveView(def),
    deleteView: async (id: string) => this.v().deleteView(id),
    keyDetails: async (filters?: KeyDetailFilters) => keyDetails(this.v(), filters),
    importLibrary: async (opts: { title: string; text?: string; dataBase64?: string; filename?: string; kind?: 'auto' | 'bible' | 'text'; author?: string; date?: string; translation?: string; makePage?: boolean }) => {
      let text = opts.text ?? '';
      if (opts.dataBase64 && /\.docx$/i.test(opts.filename ?? '')) text = await docxToText(opts.dataBase64);
      if (!text.trim()) throw new Error('That file has no text I can read.');
      return this.v().importLibrary({ ...opts, text });
    },
    listLibrary: async () => this.v().listLibrary(),
    getLibraryDoc: async (id: string) => this.v().getLibraryDoc(id),
    deleteLibrary: async (target: { id?: string; collection?: string }) => this.v().deleteLibrary(target),
    annotateLibraryBlock: async (blockId: string, action: { entityId?: string; section?: string; mark?: 'key' | 'check' | 'claim' }) => this.v().annotateLibraryBlock(blockId, action),
    scan: async (scope: Parameters<Vault['scan']>[0], opts?: Parameters<Vault['scan']>[1]) => this.v().scan(scope, opts),
    acceptSuggestion: async (id: string, choice?: { entityId?: string; type?: string; section?: string }) => this.v().acceptSuggestion(id, choice),
    dismissSuggestion: async (id: string, mode?: 'once' | 'here' | 'everywhere') => this.v().dismissSuggestion(id, mode),
    scanSettings: async () => this.v().scanSettings(),
    setScanSettings: async (patch: Parameters<Vault['setScanSettings']>[0]) => this.v().setScanSettings(patch),
    getTriggers: async () => this.v().getTriggers(),
    saveTriggers: async (themes: TriggerTheme[]) => this.v().saveTriggers(themes),
    resetTriggers: async () => this.v().resetTriggers(),
    lookup: async (q: LookupQuery, opts?: { projects?: string[] }): Promise<LookupResult> => {
      const v = this.v();
      const res = lookup(v, q);
      for (const p of opts?.projects ?? []) {
        if (p === v.root) continue;
        const other = await this.otherVault(p);
        if (!other) continue;
        // Other projects stay separate: only their Library is read, nothing is linked.
        const r = lookup(other, { ...q, scope: { library: true } }, other.settings.name);
        res.hits.push(...r.hits);
        res.total += r.total;
        if (r.canon && res.canon) {
          for (const w of r.canon.works) if (!res.canon.works.some((x) => x.id === w.id)) res.canon.works.push(w);
          res.canon.columns.push(...r.canon.columns);
          for (const [w, row] of Object.entries(r.canon.cells)) res.canon.cells[w] = { ...(res.canon.cells[w] ?? {}), ...row };
        }
      }
      return res;
    },
    quoteFor: async (blockId: string) => quoteFor(this.v(), blockId),
    listLookups: async () => this.v().listLookups(),
    saveLookup: async (l: SavedLookup) => this.v().saveLookup(l),
    deleteLookup: async (name: string) => this.v().deleteLookup(name),
    entityTable: async (def: Pick<ViewDef, 'types' | 'fields'>) => entityTable(this.v(), def),
    parallel: async (def: Pick<ViewDef, 'columns' | 'align'>) => parallelView(this.v(), def),
    contradictions: async () => this.v().contradictions(),
    listClaims: async () => this.v().listClaims(),
    addEvidence: async (claimId: string, blockId: string, stance: EvidenceStance, note?: string) => this.v().addEvidence(claimId, blockId, stance, note),
    removeEvidence: async (claimId: string, blockId: string) => this.v().removeEvidence(claimId, blockId),
    toggleClaim: async (blockId: string) => this.v().toggleClaim(blockId),
    graph: async () => buildGraph(this.v()),
    timeline: async () => buildTimeline(this.v()),
    getEntityNotes: async (id: string) => {
      const e = this.v().entities.get(id);
      if (!e) throw new Error(`No entity ${id}`);
      return { body: this.v().files.get(e.file)?.body ?? '' };
    },
    saveEntityNotes: async (id: string, body: string) => this.v().saveEntityNotes(id, body),
    addProfileNote: async (id: string, section: string | undefined, text: string) => this.v().addProfileNote(id, section, text),

    getBlock: async (id: string) => blockView(this.v(), this.v().getBlock(id)),
    blockPages: async (id: string) => this.v().blockPages(id),
    updateBlock: async (id: string, text: string) => this.v().updateBlock(id, text),
    deleteBlock: async (id: string) => this.v().deleteBlock(id),
    removeTag: async (blockId: string, entityId: string) => this.v().removeTag(blockId, entityId),
    blockHistory: async (id: string) => this.v().blockHistory(id),
    restoreBlockVersion: async (id: string, index: number) => this.v().restoreBlockVersion(id, index),

    quickSwitch: async (q: string) => quickSwitch(this.v(), q),
    search: async (q: string, filters?: SearchFilters) => searchBlocks(this.v(), q, filters),
  };

  private async otherVault(p: string): Promise<Vault | null> {
    const cur = this.others.get(p);
    if (cur && Date.now() - cur.at < 120_000) return cur.vault;
    if (!Vault.isVault(p)) return null;
    try {
      const vault = await Vault.open(p, { author: this.config.author });
      this.others.set(p, { vault, at: Date.now() });
      return vault;
    } catch {
      return null;
    }
  }

  async call(method: string, args: unknown[]): Promise<unknown> {
    const fn = (this.methods as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
    if (typeof fn !== 'function' || !Object.prototype.hasOwnProperty.call(this.methods, method)) throw new Error(`Unknown method ${method}`);
    return fn(...(args ?? []));
  }

  async restoreLastVault(): Promise<void> {
    if (this.config.lastVault && Vault.isVault(this.config.lastVault)) {
      try {
        await this.methods.openVault(this.config.lastVault);
      } catch {
        this.vault = null;
      }
    }
  }

  private startWatcher(vault: Vault) {
    this.watcher = watch(vault.root, {
      ignoreInitial: true,
      ignored: (p: string) => /[\\/](\.index|\.meta|\.trash|\.git|node_modules)([\\/]|$)/.test(p),
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    const onFs = (p: string) => {
      if (!/\.(md|ya?ml)$/.test(p)) return;
      clearTimeout(this.timers.get(p));
      this.timers.set(
        p,
        setTimeout(() => {
          this.timers.delete(p);
          vault.handleExternalChange(p).catch((err) => console.error('re-index failed', p, err));
        }, 150),
      );
    };
    this.watcher.on('add', onFs).on('change', onFs).on('unlink', onFs);
  }

  async closeVault() {
    this.unsub?.();
    this.unsub = null;
    await this.watcher?.close();
    this.watcher = null;
    this.vault = null;
  }
}

function safeUser(): string {
  try {
    return os.userInfo().username || 'me';
  } catch {
    return 'me';
  }
}

export type BackendMethods = Backend['methods'];

/** Plain text from a Word document (works in Node and in the browser demo). */
async function docxToText(b64: string): Promise<string> {
  const mod = (await import('mammoth')) as unknown as { default?: MammothLike } & MammothLike;
  const mammoth = mod.default ?? mod;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const input = typeof Buffer !== 'undefined' ? { buffer: Buffer.from(bytes) } : { arrayBuffer: bytes.buffer };
  const r = await mammoth.extractRawText(input);
  return r.value;
}

interface MammothLike {
  extractRawText(input: { buffer?: unknown; arrayBuffer?: ArrayBuffer }): Promise<{ value: string }>;
}
