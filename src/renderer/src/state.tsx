// App-wide state: the open vault's name table, tabs, panels and dialogs.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onBackendEvent, type ApiResult } from './api';
import { NameTable } from '../../core/names';
import type { AnalysisContext } from '../../core/analysis';
import type { EntityChip, ResolvedTemplate, RelationTypeDef } from '../../core/types';
import type { BackendEvent } from '../../backend/backend';
import type { ScanScope } from '../../core/vault';

export type Tab =
  | { key: string; kind: 'entry'; id: string; focusBlock?: string }
  | { key: string; kind: 'entity'; id: string; focusBlock?: string }
  | { key: string; kind: 'search'; query: string }
  | { key: string; kind: 'view'; id: string }
  | { key: string; kind: 'library'; id: string; focusBlock?: string }
  | { key: string; kind: 'marks' }
  | { key: string; kind: 'review'; scope: ScanScope; label: string }
  | { key: string; kind: 'triggers' }
  | { key: string; kind: 'claims' }
  | { key: string; kind: 'conflicts' };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TabInput = DistributiveOmit<Tab, 'key'>;

export type NameData = ApiResult<'nameData'>;
export type VaultInfo = ApiResult<'vaultInfo'>;

export interface CurrentBlock {
  entryId?: string;
  text: string;
  id?: string;
  filedTo: Array<{ entityId: string; via: string; section?: string }>;
  warnings: Array<{ message: string; code: string }>;
  fields: Array<{ entityId: string; field: string; valueText: string }>;
  relations: Array<{ subject: string; type: string; object: string }>;
  creates: Array<{ name: string; via: string }>;
}

interface AppState {
  info: VaultInfo;
  nameData: NameData;
  names: NameTable;
  entityById: Map<string, EntityChip>;
  templates: Map<string, ResolvedTemplate>;
  relationTypes: Map<string, RelationTypeDef>;
  analysisContext: (directOwner?: string) => AnalysisContext;
  /** Increments whenever the vault changes; views refetch on it. */
  version: number;
  lastEvent: BackendEvent | null;
  refreshNames: () => Promise<void>;
  tabs: Tab[];
  active: string | null;
  openTab: (t: TabInput, opts?: { newTab?: boolean }) => void;
  closeTab: (key: string) => void;
  setActive: (key: string) => void;
  panels: { right: 'context' | 'reference' | 'suggest' | 'lexicon' | null; pinnedReference: boolean; research?: boolean; researchWidth?: number };
  setPanels: (p: Partial<AppState['panels']>) => void;
  rawMarkup: boolean;
  setRawMarkup: (v: boolean) => void;
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  currentBlock: CurrentBlock | null;
  setCurrentBlock: (b: CurrentBlock | null) => void;
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  setSaveState: (s: AppState['saveState']) => void;
  notify: (msg: string, kind?: 'info' | 'error') => void;
  toasts: Array<{ id: number; msg: string; kind: 'info' | 'error' }>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

function tabKey(t: TabInput): string {
  return t.kind === 'search' || t.kind === 'marks' || t.kind === 'review' || t.kind === 'triggers' || t.kind === 'claims' || t.kind === 'conflicts' ? t.kind : `${t.kind}:${t.id}`;
}

function loadTabs(root: string): { tabs: Tab[]; active: string | null } {
  try {
    const raw = localStorage.getItem(`lr.tabs.${root}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { tabs: [], active: null };
}

export function AppProvider({ info: initialInfo, children }: { info: VaultInfo; children: ReactNode }) {
  const [info, setInfo] = useState(initialInfo);
  const [nameData, setNameData] = useState<NameData | null>(null);
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<BackendEvent | null>(null);
  const initial = useMemo(() => loadTabs(initialInfo.root), [initialInfo.root]);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [active, setActiveState] = useState<string | null>(initial.active);
  const [panels, setPanelsState] = useState<AppState['panels']>(() => {
    try {
      return JSON.parse(localStorage.getItem('lr.panels') ?? '') as AppState['panels'];
    } catch {
      return { right: 'context', pinnedReference: false };
    }
  });
  const [rawMarkup, setRawMarkup] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<CurrentBlock | null>(null);
  const [saveState, setSaveState] = useState<AppState['saveState']>('saved');
  const [toasts, setToasts] = useState<AppState['toasts']>([]);
  const toastId = useRef(0);

  const refreshNames = useCallback(async () => {
    const [nd, vi] = await Promise.all([api.nameData(), api.vaultInfo()]);
    setNameData(nd);
    setInfo(vi);
  }, []);

  useEffect(() => {
    refreshNames();
    return onBackendEvent((e) => {
      setLastEvent(e);
      if (e.type === 'changed') {
        if (e.entities) refreshNames();
        else api.vaultInfo().then(setInfo);
        setVersion((n) => n + 1);
      }
    });
  }, [refreshNames]);

  useEffect(() => {
    try {
      localStorage.setItem(`lr.tabs.${info.root}`, JSON.stringify({ tabs: tabs.map((t) => ({ ...t, focusBlock: undefined })), active }));
    } catch {
      // storage unavailable
    }
  }, [tabs, active, info.root]);

  const setPanels = useCallback((p: Partial<AppState['panels']>) => {
    setPanelsState((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem('lr.panels', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const openTab = useCallback((t: TabInput, opts?: { newTab?: boolean }) => {
    const key = tabKey(t);
    setTabs((cur) => {
      const existing = cur.findIndex((x) => x.key === key);
      const tab = { ...t, key } as Tab;
      if (existing >= 0) {
        const copy = [...cur];
        copy[existing] = tab;
        return copy;
      }
      return [...cur, tab];
    });
    setActiveState(key);
    void opts;
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((cur) => {
      const i = cur.findIndex((t) => t.key === key);
      const next = cur.filter((t) => t.key !== key);
      setActiveState((a) => (a === key ? next[Math.min(i, next.length - 1)]?.key ?? null : a));
      return next;
    });
  }, []);

  const notify = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const derived = useMemo(() => {
    if (!nameData) return null;
    const names = new NameTable(nameData.entities.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: e.type })));
    const entityById = new Map(nameData.entities.map((e) => [e.id, e]));
    const templates = new Map(nameData.templates.map((t) => [t.id, t]));
    const relationTypes = new Map(nameData.relationTypes.map((r) => [r.id, r]));
    const analysisContext = (directOwner?: string): AnalysisContext => ({
      resolver: names,
      templates,
      relationTypes,
      entityType: (id) => entityById.get(id)?.type,
      directOwner,
    });
    return { names, entityById, templates, relationTypes, analysisContext };
  }, [nameData]);

  // Drop tabs whose target was deleted.
  useEffect(() => {
    if (!derived) return;
    setTabs((cur) => cur.filter((t) => t.kind !== 'entity' || derived.entityById.has(t.id)));
  }, [derived]);

  if (!nameData || !derived) return <div className="boot">Opening vault…</div>;

  const value: AppState = {
    info,
    nameData,
    ...derived,
    version,
    lastEvent,
    refreshNames,
    tabs,
    active,
    openTab,
    closeTab,
    setActive: setActiveState,
    panels,
    setPanels,
    rawMarkup,
    setRawMarkup,
    focusMode,
    setFocusMode,
    currentBlock,
    setCurrentBlock,
    saveState,
    setSaveState,
    notify,
    toasts,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
