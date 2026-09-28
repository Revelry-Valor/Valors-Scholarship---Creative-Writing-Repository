// The main window: sidebar | tabs + document | right panel, with a status bar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, type Tab } from '../state';
import { Sidebar } from './Sidebar';
import { EntryView } from './EntryView';
import { ProfileView } from './ProfileView';
import { SearchView } from './SearchView';
import { RightPanel } from './Panels';
import { Palette, type Command } from './Palette';
import { useDialogs } from './Dialogs';
import { applyTheme, currentTheme, type Theme } from '../theme';
import { ContextMenu, type MenuSpec } from './Menu';
import { TemplateEditor } from './TemplateEditor';
import { ViewPage } from '../charts/ViewPage';
import { newView, addType } from './ViewsSidebar';

export function Workspace({ onCloseVault }: { onCloseVault: () => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [palette, setPalette] = useState<'switch' | 'command' | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const [navOpen, setNavOpen] = useState(false);
  const [cmdMenu, setCmdMenu] = useState<MenuSpec>(null);
  useEffect(() => setNavOpen(false), [app.active]);

  const activeTab = app.tabs.find((t) => t.key === app.active) ?? null;

  const newEntity = useCallback(
    async (presetName?: string) => {
      const type = await dialogs.pick({
        title: presetName ? `Create “${presetName}” as…` : 'New entity — pick a type',
        items: app.nameData.templates.map((x) => ({ label: x.name, detail: x.sections.slice(0, 4).join(' · '), value: x.id, color: x.color })),
      });
      if (!type) return;
      const name = presetName ?? (await dialogs.prompt({ title: `New ${app.templates.get(type)?.name ?? type}`, placeholder: 'Name', okLabel: 'Create' }));
      if (!name) return;
      try {
        const chip = await api.createEntity({ name, type });
        await app.refreshNames();
        app.openTab({ kind: 'entity', id: chip.id });
      } catch (err) {
        app.notify((err as Error).message, 'error');
      }
    },
    [app, dialogs],
  );

  const newEntry = useCallback(async () => {
    const title = await dialogs.prompt({ title: 'New document', placeholder: 'Title', okLabel: 'Create' });
    if (!title) return;
    const e = await api.createEntry({ title });
    app.openTab({ kind: 'entry', id: e.id });
  }, [app, dialogs]);

  const toggleReference = useCallback(() => {
    if (app.panels.right === 'reference' && !app.panels.pinnedReference) app.setPanels({ right: null });
    else app.setPanels({ right: 'reference' });
  }, [app]);

  const setAuthor = useCallback(async () => {
    const st = await api.appState();
    const name = await dialogs.prompt({ title: 'Your name', label: 'Every block you write is signed with this name (spec: authorship is recorded from day one).', initial: st.author, okLabel: 'Save' });
    if (name) {
      await api.setAuthor(name);
      app.notify(`Signing new blocks as ${name}`);
    }
  }, [app, dialogs]);

  const cycleTheme = useCallback(() => {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  const commands: Command[] = useMemo(
    () => [
      { id: 'new-entry', label: 'New document', hint: 'Ctrl+N', run: newEntry },
      { id: 'new-entity', label: 'New entity', hint: 'Ctrl+Shift+E', run: () => newEntity() },
      { id: 'search', label: 'Search all writing', hint: 'Ctrl+Shift+F', run: () => app.openTab({ kind: 'search', query: '' }) },
      { id: 'goto', label: 'Go to entry or entity', hint: 'Ctrl+O', run: () => setTimeout(() => setPalette('switch'), 0) },
      { id: 'ref', label: 'Toggle markup quick reference', hint: 'F1', run: toggleReference },
      { id: 'context', label: 'Toggle “This block” panel', hint: 'Ctrl+\\', run: () => app.setPanels({ right: app.panels.right ? null : 'context' }) },
      { id: 'focus', label: app.focusMode ? 'Leave focus mode' : 'Focus mode (hide panels)', hint: 'Ctrl+Shift+Enter', run: () => app.setFocusMode(!app.focusMode) },
      { id: 'raw', label: app.rawMarkup ? 'Show chips (hide raw markup)' : 'Show raw markup', hint: 'Ctrl+E', run: () => app.setRawMarkup(!app.rawMarkup) },
      { id: 'close-tab', label: 'Close tab', hint: 'Ctrl+W', run: () => app.active && app.closeTab(app.active) },
      { id: 'theme', label: `Theme: ${theme} → ${theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'}`, run: cycleTheme },
      { id: 'new-view', label: 'New timeline or tree (family, lineage, tech, radial, web)…', run: () => newView(app, dialogs) },
      { id: 'add-type', label: 'Add a type (Settlement, Race, Species, Flora, Fauna, Technology…)', run: () => addType(app, dialogs) },
      {
        id: 'template',
        label: 'Edit a template (facts and sections)…',
        run: async () => {
          const type = await dialogs.pick({ title: 'Edit which template?', items: app.nameData.templates.map((t) => ({ label: t.name, detail: `${t.fields.length} facts · ${t.sections.length} sections`, value: t.id, color: t.color })) });
          if (type) await dialogs.show((close) => <TemplateEditor typeId={type} onClose={() => close(null)} />);
        },
      },
      {
        id: 'upgrade',
        label: 'Add the newest starter facts to my templates (family, friends…)',
        run: async () => {
          const added = await api.upgradeTemplates();
          app.notify(added.length ? `Added: ${added.slice(0, 6).join(', ')}${added.length > 6 ? ` and ${added.length - 6} more` : ''}` : 'Your templates already have everything');
          await app.refreshNames();
        },
      },
      { id: 'author', label: 'Set your name (block signatures)', run: setAuthor },
      {
        id: 'rebuild',
        label: 'Rebuild index',
        run: async () => {
          const r = await api.rebuildIndex();
          app.notify(`Index rebuilt: ${r.blocks.toLocaleString()} blocks in ${r.ms} ms`);
          await app.refreshNames();
        },
      },
      { id: 'reveal', label: 'Show vault folder on disk', run: async () => app.notify(`Vault folder: ${await api.revealInFolder()}`) },
      { id: 'switch', label: 'Switch project…', run: onCloseVault },
      ...(window.__lrBackend
        ? [
            {
              id: 'reset-demo',
              label: 'Reset the sample project (erases your changes in this browser)',
              run: async () => {
                const ok = await dialogs.choose({
                  title: 'Reset the sample project?',
                  message: <p>Everything you wrote in this browser is erased and the original sample comes back.</p>,
                  choices: [
                    { label: 'Reset', value: true, kind: 'danger' },
                    { label: 'Cancel', value: false, kind: 'primary' },
                  ],
                });
                if (ok) window.__lrBackend?.reset();
              },
            },
          ]
        : []),
    ],
    [app, dialogs, newEntity, newEntry, toggleReference, theme, cycleTheme, setAuthor, onCloseVault],
  );

  useEffect(() => {
    const onCommand = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; name?: string };
      if (d.id === 'new-entity') newEntity(d.name);
    };
    window.addEventListener('lr:command', onCommand);
    return () => window.removeEventListener('lr:command', onCommand);
  }, [newEntity]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (document.querySelector('.modal-backdrop')) return;
      let handled = true;
      if (e.key === 'F1') toggleReference();
      else if (mod && !e.shiftKey && k === 'o') setPalette('switch');
      else if (mod && (k === 'k' || (e.shiftKey && k === 'p'))) setPalette('command');
      else if (mod && !e.shiftKey && k === 'n') newEntry();
      else if (mod && e.shiftKey && k === 'e') newEntity();
      else if (mod && e.shiftKey && k === 'f') app.openTab({ kind: 'search', query: '' });
      else if (mod && !e.shiftKey && k === 'e') app.setRawMarkup(!app.rawMarkup);
      else if (mod && e.key === '\\') app.setPanels({ right: app.panels.right ? null : 'context' });
      else if (mod && e.shiftKey && e.key === 'Enter') app.setFocusMode(!app.focusMode);
      else if (e.key === 'Escape' && app.focusMode && !document.querySelector('.cm-tooltip-autocomplete')) app.setFocusMode(false);
      else if (mod && k === 'w') {
        if (app.active) app.closeTab(app.active);
      } else if (mod && e.key === 'Tab') {
        const i = app.tabs.findIndex((t) => t.key === app.active);
        const n = app.tabs.length;
        if (n) app.setActive(app.tabs[(i + (e.shiftKey ? n - 1 : 1)) % n].key);
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [app, newEntry, newEntity, toggleReference]);

  const tabTitle = (t: Tab) => {
    if (t.kind === 'entity') return app.entityById.get(t.id)?.name ?? '…';
    if (t.kind === 'search') return 'Search';
    if (t.kind === 'view') return <ViewTitle id={t.id} />;
    return null;
  };

  return (
    <div className={`workspace ${app.panels.right && !app.focusMode ? 'with-right' : ''} ${navOpen ? 'nav-open' : ''} ${app.focusMode ? 'focus-mode' : ''}`}>
      <Sidebar onSwitchVault={onCloseVault} />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <div className="center">
        <div className="tabbar" role="tablist">
          <button className="nav-toggle" aria-label="Show binder and entities" onClick={() => setNavOpen((x) => !x)}>
            ☰
          </button>
          {app.tabs.map((t) => (
            <div
              key={t.key}
              role="tab"
              aria-selected={t.key === app.active}
              className={`tab ${t.key === app.active ? 'active' : ''} tab-${t.kind}`}
              onClick={() => app.setActive(t.key)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  app.closeTab(t.key);
                }
              }}
            >
              {t.kind === 'entity' && <span className="dot" style={{ background: app.entityById.get(t.id)?.color }} />}
              <span className="tab-title">{tabTitle(t) ?? <EntryTitle id={(t as { id: string }).id} />}</span>
              <button
                className="tab-close"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  app.closeTab(t.key);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <span className="spacer" />
          <div className="topbar-actions">
            <button className="top-btn" onClick={() => setPalette('switch')} title="Jump to any entry or entity (Ctrl+O)">
              ⌕ Go to… <kbd>Ctrl+O</kbd>
            </button>
            <button
              className={`top-btn ${cmdMenu ? 'on' : ''}`}
              title="Every command, with its keyboard shortcut"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setCmdMenu({ x: r.right - 300, y: r.bottom + 4, items: commands.map((c) => ({ label: c.label, hint: c.hint, run: c.run })) });
              }}
            >
              ☰ Commands ▾
            </button>
            <button
              className={`top-btn ${app.panels.right === 'reference' ? 'on' : ''}`}
              title="Markup and keyboard reference (F1)"
              onClick={() => app.setPanels({ right: app.panels.right === 'reference' ? null : 'reference' })}
            >
              ? Guide
            </button>
            <button className={`top-btn ${app.panels.right === 'context' ? 'on' : ''}`} title="Where the paragraph at the cursor is filed (Ctrl+\\)" onClick={() => app.setPanels({ right: app.panels.right === 'context' ? null : 'context' })}>
              ◧ Block
            </button>
          </div>
        </div>
        <div className="doc-area">
          {activeTab?.kind === 'entry' && <EntryView key={activeTab.key} id={activeTab.id} focusBlock={activeTab.focusBlock} />}
          {activeTab?.kind === 'entity' && <ProfileView key={activeTab.key} id={activeTab.id} focusBlock={activeTab.focusBlock} />}
          {activeTab?.kind === 'search' && <SearchView query={activeTab.query} />}
          {activeTab?.kind === 'view' && <ViewPage key={activeTab.key} id={activeTab.id} />}
          {!activeTab && <Welcome onNewEntry={newEntry} onNewEntity={() => newEntity()} onGoto={() => setPalette('switch')} />}
        </div>
      </div>
      <RightPanel />
      <StatusBar onAuthor={setAuthor} theme={theme} onTheme={cycleTheme} />
      {palette && <Palette mode={palette} commands={commands} onClose={() => setPalette(null)} />}
      <ContextMenu spec={cmdMenu} onClose={() => setCmdMenu(null)} />
      <div className="toasts" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewTitle({ id }: { id: string }) {
  const app = useApp();
  const [name, setName] = useState('…');
  useEffect(() => {
    api.listViews().then((vs) => setName(vs.find((v) => v.id === id)?.name ?? '(deleted)'));
  }, [id, app.version]);
  return <>{name}</>;
}

function EntryTitle({ id }: { id: string }) {
  const app = useApp();
  const [title, setTitle] = useState('…');
  useEffect(() => {
    api
      .getEntry(id)
      .then((e) => setTitle(e.title))
      .catch(() => setTitle('(missing)'));
  }, [id, app.version]);
  return <>{title}</>;
}

function Welcome({ onNewEntry, onNewEntity, onGoto }: { onNewEntry: () => void; onNewEntity: () => void; onGoto: () => void }) {
  const app = useApp();
  const c = app.info.counts;
  return (
    <div className="welcome">
      <h1>{app.info.settings.name}</h1>
      <p className="muted">
        {c.entries} entr{c.entries === 1 ? 'y' : 'ies'} · {c.entities} entit{c.entities === 1 ? 'y' : 'ies'} · {c.blocks} block{c.blocks === 1 ? '' : 's'}
      </p>
      <div className="welcome-actions">
        <button className="welcome-card" onClick={onNewEntry}>
          <strong>Write</strong>
          <span>Start a new entry. Tag people, places and topics as you go with @.</span>
          <kbd>Ctrl+N</kbd>
        </button>
        <button className="welcome-card" onClick={onNewEntity}>
          <strong>Create a profile</strong>
          <span>A person, work, place or topic. Profiles fill themselves from your writing.</span>
          <kbd>Ctrl+Shift+E</kbd>
        </button>
        <button className="welcome-card" onClick={onGoto}>
          <strong>Find</strong>
          <span>Jump to anything by name or alias, or search every paragraph.</span>
          <kbd>Ctrl+O</kbd>
        </button>
      </div>
      <div className="welcome-howto">
        <h2>How it works</h2>
        <ol>
          <li>
            Write naturally. Type <code>@</code> and a name to tag a paragraph — <code>@@</code> creates someone new.
          </li>
          <li>
            A heading like <code>## Apple Scouch @</code> files every paragraph beneath it to that person.
          </li>
          <li>The coloured stripe in the margin shows where each paragraph will appear.</li>
          <li>Open any profile: it is assembled live from those paragraphs. Edit one there and it changes everywhere.</li>
        </ol>
      </div>
    </div>
  );
}

function StatusBar({ onAuthor, theme, onTheme }: { onAuthor: () => void; theme: Theme; onTheme: () => void }) {
  const app = useApp();
  const c = app.info.counts;
  const saveLabel = { saved: 'Saved', saving: 'Saving…', unsaved: 'Editing…', error: 'Save failed' }[app.saveState];
  return (
    <footer className="statusbar">
      <span className={`save-state save-${app.saveState}`}>{saveLabel}</span>
      {window.__lrBackend && <span className="demo-note">Sample project · saved in this browser only</span>}
      <span>
        {c.entries} entries · {c.entities} entities · {c.blocks.toLocaleString()} blocks
      </span>
      <span className="spacer" />
      <button className={`status-btn ${app.rawMarkup ? 'on' : ''}`} onClick={() => app.setRawMarkup(!app.rawMarkup)} title="Ctrl+E">
        {app.rawMarkup ? 'Raw markup' : 'Chips'}
      </button>
      <button className="status-btn" onClick={() => app.setPanels({ right: app.panels.right === 'reference' ? null : 'reference' })} title="F1">
        Markup help
      </button>
      <button className="status-btn" onClick={onTheme} title="Theme">
        {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
      </button>
      <button className="status-btn" onClick={onAuthor} title="Your name signs every block you write">
        ✍ author
      </button>
      <span className="muted path" title={app.info.root}>
        {app.info.root}
      </span>
    </footer>
  );
}
