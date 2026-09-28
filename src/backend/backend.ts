// The backend the UI talks to. The Electron main process exposes it over IPC;
// the browser dev server exposes the same methods over HTTP. One method table,
// so the two can never drift apart.

import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { Vault, type BinderParent, type ChangeEvent } from '../core/vault';
import { buildProfile, blockView, quickSwitch, searchBlocks, type SearchFilters } from '../core/views';
import { STARTER_PACKS } from '../core/templates';
import type { EntryStatus, TemplateDef, ViewDef } from '../core/types';
import { buildGraph, buildTimeline } from '../core/graph';

export interface RecentVault {
  path: string;
  name: string;
  openedAt: string;
}

export interface AppConfig {
  author: string;
  recent: RecentVault[];
  lastVault?: string;
}

export type BackendEvent = ({ type: 'changed' } & ChangeEvent) | { type: 'vault-opened' } | { type: 'vault-closed' };

export class Backend {
  vault: Vault | null = null;
  config: AppConfig = { author: safeUser(), recent: [] };
  private watcher: FSWatcher | null = null;
  private listeners = new Set<(e: BackendEvent) => void>();
  private unsub: (() => void) | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private configDir: string,
    private hooks: { pickFolder?: () => Promise<string | null>; revealPath?: (p: string) => void } = {},
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
