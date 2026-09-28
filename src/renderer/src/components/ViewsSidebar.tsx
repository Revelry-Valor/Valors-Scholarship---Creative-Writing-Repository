// Sidebar section for saved timelines and trees, plus the "add a type" picker.
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { VIEW_KINDS } from '../charts/ViewPage';
import type { ViewKind } from '../../../core/types';

type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

export async function newView(app: App, dialogs: Dialogs) {
  const kind = await dialogs.pick<ViewKind>({
    title: 'New timeline or tree',
    items: VIEW_KINDS.map((k) => ({ label: `${k.icon}  ${k.label}`, detail: k.blurb, value: k.id })),
  });
  if (!kind) return;
  const label = VIEW_KINDS.find((k) => k.id === kind)!.label;
  const name = await dialogs.prompt({ title: `New ${label.toLowerCase()}`, initial: label, okLabel: 'Create' });
  if (!name) return;
  let root: string | undefined;
  if (kind === 'radial') {
    root =
      (await dialogs.pick({
        title: 'Who or what goes in the centre?',
        items: [...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color })),
      })) ?? undefined;
  }
  const def = await api.createView({ name, kind, root });
  app.openTab({ kind: 'view', id: def.id });
}

export async function addType(app: App, dialogs: Dialogs) {
  const available = await api.availableTemplates();
  const choice = await dialogs.pick<string>({
    title: 'Add a type to this project',
    placeholder: 'Settlement, Flora, Fauna…',
    items: [
      ...available.map((t) => ({ label: t.name, detail: `${t.from} · ${t.sections.slice(0, 3).join(', ')}`, value: t.id })),
      { label: 'A new, empty type…', detail: 'name it yourself; add facts and sections after', value: '__new' },
    ],
  });
  if (!choice) return;
  try {
    if (choice === '__new') {
      const name = await dialogs.prompt({ title: 'New type', placeholder: 'e.g. Heresy, Guild, Spell', okLabel: 'Create' });
      if (!name) return;
      await api.addTemplate({ name });
      app.notify(`Added the type ${name}. Edit its facts and sections from any of its pages.`);
    } else {
      const t = await api.addTemplate({ id: choice });
      app.notify(`Added ${t.name}`);
    }
    await app.refreshNames();
  } catch (err) {
    app.notify((err as Error).message, 'error');
  }
}

export function ViewsSection() {
  const app = useApp();
  const dialogs = useDialogs();
  const [views, setViews] = useState<ApiResult<'listViews'>>([]);
  useEffect(() => {
    api.listViews().then(setViews);
  }, [app.version]);
  const active = app.tabs.find((t) => t.key === app.active);
  return (
    <div className="side-section views-section">
      <div className="side-head">
        <span>Timelines &amp; Trees</span>
        <button className="icon-btn" title="New timeline or tree" onClick={() => newView(app, dialogs)}>
          +
        </button>
      </div>
      <ul className="tree">
        {views.map((v) => {
          const k = VIEW_KINDS.find((x) => x.id === v.kind);
          return (
            <li key={v.id}>
              <div className={`tree-row ${active?.kind === 'view' && active.id === v.id ? 'active' : ''}`} style={{ paddingLeft: 8 }} tabIndex={0} onClick={() => app.openTab({ kind: 'view', id: v.id })} onKeyDown={(e) => e.key === 'Enter' && app.openTab({ kind: 'view', id: v.id })}>
                <span className="twisty none" />
                <span className="node-icon view-icon" title={k?.label}>
                  {k?.icon}
                </span>
                <span className="node-name">{v.name}</span>
              </div>
            </li>
          );
        })}
        {!views.length && (
          <li className="tree-empty">
            <button className="btn btn-ghost small" onClick={() => newView(app, dialogs)}>
              + Family tree, timeline, radial chart…
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
