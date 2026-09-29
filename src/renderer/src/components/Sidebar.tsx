// Left panel: the binder (nested folders and documents) and the entities of this vault.
import { useCallback, useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { ContextMenu, type MenuSpec } from './Menu';
import { STATUSES } from './EntryView';
import { ViewsSection, addType } from './ViewsSidebar';
import { LibrarySection } from './Library';
import type { BinderNode, EntryStatus } from '../../../core/types';

type Parent = { kind: 'root' } | { kind: 'folder'; path: string } | { kind: 'entry'; id: string };
type DropPos = 'before' | 'after' | 'inside';

function loadSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function Sidebar({ onSwitchVault }: { onSwitchVault: () => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [tree, setTree] = useState<BinderNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadSet(`lr.collapsed.${app.info.root}`));
  const [menu, setMenu] = useState<MenuSpec>(null);
  const [drag, setDrag] = useState<{ node: BinderNode } | null>(null);
  const [drop, setDrop] = useState<{ key: string; pos: DropPos } | null>(null);
  const [filter, setFilter] = useState('');
  const [typesCollapsed, setTypesCollapsed] = useState<Set<string>>(() => loadSet(`lr.typesCollapsed.${app.info.root}`));

  const reload = useCallback(() => api.binder().then(setTree), []);
  useEffect(() => {
    reload();
  }, [reload, app.version]);

  const toggle = (key: string) => {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      try {
        localStorage.setItem(`lr.collapsed.${app.info.root}`, JSON.stringify([...n]));
      } catch {
        // ignore
      }
      return n;
    });
  };

  const nodeKey = (n: BinderNode) => `${n.kind}:${n.id}`;
  const asParent = (n: BinderNode): Parent => (n.kind === 'folder' ? { kind: 'folder', path: n.path } : { kind: 'entry', id: n.id });

  const newEntry = async (parent: Parent = { kind: 'root' }) => {
    const title = await dialogs.prompt({ title: 'New document', placeholder: 'Title', okLabel: 'Create' });
    if (!title) return;
    const e = await api.createEntry({ title, parent });
    if (parent.kind !== 'root') setCollapsed((c) => new Set([...c].filter((k) => k !== (parent.kind === 'folder' ? `folder:${parent.path}` : `entry:${parent.id}`))));
    app.openTab({ kind: 'entry', id: e.id });
    reload();
  };

  const newFolder = async (parent: Parent = { kind: 'root' }) => {
    const name = await dialogs.prompt({ title: 'New folder', placeholder: 'Folder name', okLabel: 'Create' });
    if (!name) return;
    await api.createFolder({ name, parent });
    reload();
  };

  const rename = async (n: BinderNode) => {
    const name = await dialogs.prompt({ title: `Rename ${n.kind === 'folder' ? 'folder' : 'document'}`, initial: n.name, okLabel: 'Rename' });
    if (!name || name === n.name) return;
    if (n.kind === 'folder') await api.renameFolder(n.path, name);
    else await api.updateEntry(n.id, { title: name });
    reload();
  };

  const remove = async (n: BinderNode) => {
    const kids = n.children.length;
    const ok = await dialogs.choose({
      title: `Delete “${n.name}”?`,
      message: <p>{kids ? `It contains ${kids} item${kids === 1 ? '' : 's'}, which will be deleted too. ` : ''}Files move to the vault's .trash folder, so you can recover them from disk.</p>,
      choices: [
        { label: 'Delete', value: true, kind: 'danger' },
        { label: 'Cancel', value: false, kind: 'primary' },
      ],
    });
    if (!ok) return;
    if (n.kind === 'folder') await api.deleteFolder(n.path);
    else {
      await api.deleteEntry(n.id);
      app.closeTab(`entry:${n.id}`);
    }
    reload();
  };

  const setStatus = async (n: BinderNode, status: EntryStatus) => {
    await api.updateEntry(n.id, { status });
    reload();
  };

  const openMenu = (e: { clientX: number; clientY: number; preventDefault(): void }, n: BinderNode | null) => {
    e.preventDefault();
    if (!n) {
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'New document', hint: 'Ctrl+N', run: () => newEntry() },
          { label: 'New folder', run: () => newFolder() },
        ],
      });
      return;
    }
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: n.kind === 'folder' ? 'New document here' : 'New sub-document', run: () => newEntry(asParent(n)) },
        { label: 'New folder inside', run: () => newFolder(asParent(n)) },
        'sep',
        ...(n.kind === 'entry' ? STATUSES.map((s) => ({ label: `Status: ${s.label}${n.status === s.id ? ' ✓' : ''}`, run: () => setStatus(n, s.id) })) : []),
        ...(n.kind === 'entry' ? (['sep'] as const) : []),
        { label: 'Rename', hint: 'F2', run: () => rename(n) },
        { label: 'Delete…', hint: 'Del', danger: true, run: () => remove(n) },
      ],
    });
  };

  // ---------------- drag & drop
  const onDragOver = (e: DragEvent, n: BinderNode) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const pos: DropPos = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    setDrop({ key: nodeKey(n), pos });
  };

  const findParent = (target: BinderNode, nodes = tree, parent: Parent = { kind: 'root' }): { parent: Parent; index: number } | null => {
    const i = nodes.findIndex((x) => nodeKey(x) === nodeKey(target));
    if (i >= 0) return { parent, index: i };
    for (const n of nodes) {
      const r = findParent(target, n.children, asParent(n));
      if (r) return r;
    }
    return null;
  };

  const onDrop = async (e: DragEvent, target: BinderNode) => {
    e.preventDefault();
    const d = drag;
    const pos = drop?.pos;
    setDrag(null);
    setDrop(null);
    if (!d || !pos || nodeKey(d.node) === nodeKey(target)) return;
    try {
      if (pos === 'inside') {
        await api.moveNode({ kind: d.node.kind, id: d.node.kind === 'folder' ? d.node.path : d.node.id }, asParent(target), target.children.length);
        setCollapsed((c) => new Set([...c].filter((k) => k !== nodeKey(target))));
      } else {
        const loc = findParent(target)!;
        const from = findParent(d.node)!;
        let index = loc.index + (pos === 'after' ? 1 : 0);
        const sameParent = JSON.stringify(loc.parent) === JSON.stringify(from.parent);
        if (sameParent && from.index < index) index--;
        await api.moveNode({ kind: d.node.kind, id: d.node.kind === 'folder' ? d.node.path : d.node.id }, loc.parent, index);
      }
      reload();
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  // ---------------- keyboard
  const flat = useMemo(() => {
    const out: BinderNode[] = [];
    const walk = (ns: BinderNode[]) => {
      for (const n of ns) {
        out.push(n);
        if (n.children.length && !collapsed.has(nodeKey(n))) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree, collapsed]);

  const onTreeKey = (e: KeyboardEvent, n: BinderNode) => {
    const i = flat.findIndex((x) => nodeKey(x) === nodeKey(n));
    const focus = (k: number) => (document.querySelector(`[data-node="${nodeKey(flat[k])}"]`) as HTMLElement | null)?.focus();
    if (e.key === 'ArrowDown' && i < flat.length - 1) focus(i + 1);
    else if (e.key === 'ArrowUp' && i > 0) focus(i - 1);
    else if (e.key === 'ArrowRight' && n.children.length && collapsed.has(nodeKey(n))) toggle(nodeKey(n));
    else if (e.key === 'ArrowLeft' && n.children.length && !collapsed.has(nodeKey(n))) toggle(nodeKey(n));
    else if (e.key === 'Enter' && n.kind === 'entry') app.openTab({ kind: 'entry', id: n.id });
    else if (e.key === 'Enter') toggle(nodeKey(n));
    else if (e.key === 'F2') rename(n);
    else if (e.key === 'Delete') remove(n);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu({ clientX: r.left + 40, clientY: r.bottom, preventDefault: () => undefined }, n);
    } else return;
    e.preventDefault();
  };

  const activeEntry = app.tabs.find((t) => t.key === app.active);

  const renderNode = (n: BinderNode, depth: number) => {
    const key = nodeKey(n);
    const open = !collapsed.has(key);
    const isActive = activeEntry?.kind === 'entry' && n.kind === 'entry' && activeEntry.id === n.id;
    const dropCls = drop?.key === key ? `drop-${drop.pos}` : '';
    return (
      <li key={key}>
        <div
          className={`tree-row ${isActive ? 'active' : ''} ${dropCls} ${n.kind}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          data-node={key}
          tabIndex={0}
          draggable
          onDragStart={(e) => {
            setDrag({ node: n });
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => {
            setDrag(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, n)}
          onDragLeave={() => setDrop((d) => (d?.key === key ? null : d))}
          onDrop={(e) => onDrop(e, n)}
          onClick={() => (n.kind === 'entry' ? app.openTab({ kind: 'entry', id: n.id }) : toggle(key))}
          onContextMenu={(e) => openMenu(e, n)}
          onKeyDown={(e) => onTreeKey(e, n)}
        >
          <button
            className={`twisty ${n.children.length ? '' : 'none'}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              toggle(key);
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {n.children.length ? (open ? '▾' : '▸') : ''}
          </button>
          <span className={`node-icon ${n.kind === 'entry' ? `status-${n.status}` : ''}`} title={n.kind === 'entry' ? n.status : 'folder'}>
            {n.kind === 'folder' ? '▤' : '●'}
          </span>
          <span className="node-name">{n.name}</span>
          <span className="node-words">{n.words ? n.words.toLocaleString() : ''}</span>
        </div>
        {n.children.length > 0 && open && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  // ---------------- entities by type
  const byType = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const groups = new Map<string, ApiResult<'listEntities'>>();
    for (const t of app.nameData.templates) groups.set(t.id, []);
    for (const e of app.nameData.entities) {
      if (q && !e.name.toLowerCase().includes(q) && !e.aliases.some((a) => a.toLowerCase().includes(q))) continue;
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type)!.push(e);
    }
    for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [app.nameData, filter]);

  const newEntity = async (type?: string) => {
    const t =
      type ??
      (await dialogs.pick({
        title: 'New entity — pick a type',
        items: app.nameData.templates.map((x) => ({ label: x.name, detail: x.sections.slice(0, 4).join(' · '), value: x.id, color: x.color })),
      }));
    if (!t) return;
    const tpl = app.templates.get(t);
    const name = await dialogs.prompt({ title: `New ${tpl?.name ?? t}`, placeholder: 'Name', okLabel: 'Create' });
    if (!name) return;
    try {
      const chip = await api.createEntity({ name, type: t });
      await app.refreshNames();
      app.openTab({ kind: 'entity', id: chip.id });
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  const toggleType = (id: string) =>
    setTypesCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(`lr.typesCollapsed.${app.info.root}`, JSON.stringify([...n]));
      } catch {
        // ignore
      }
      return n;
    });

  const activeEntity = activeEntry?.kind === 'entity' ? activeEntry.id : null;

  return (
    <nav className="sidebar" aria-label="Vault">
      <button className="vault-switch" onClick={onSwitchVault} title="Switch project">
        <span className="vault-mark">{app.info.settings.name.slice(0, 1).toUpperCase()}</span>
        <span className="vault-name">{app.info.settings.name}</span>
        {app.info.settings.mode.toLowerCase() !== app.info.settings.name.toLowerCase() && <span className="vault-mode">{app.info.settings.mode}</span>}
      </button>

      <div className="side-section">
        <div className="side-head">
          <span>Writing</span>
          <button className="icon-btn" title="New document (Ctrl+N)" onClick={() => newEntry()}>
            +
          </button>
          <button className="icon-btn" title="New folder" onClick={() => newFolder()}>
            ▤
          </button>
        </div>
        <ul
          className="tree"
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) openMenu(e, null);
          }}
          onDragOver={(e) => {
            if (drag && e.target === e.currentTarget) e.preventDefault();
          }}
          onDrop={async (e) => {
            if (!drag || e.target !== e.currentTarget) return;
            e.preventDefault();
            await api.moveNode({ kind: drag.node.kind, id: drag.node.kind === 'folder' ? drag.node.path : drag.node.id }, { kind: 'root' });
            setDrag(null);
            reload();
          }}
        >
          {tree.map((n) => renderNode(n, 0))}
          {!tree.length && (
            <li className="tree-empty">
              <button className="btn btn-ghost small" onClick={() => newEntry()}>
                + Write your first entry
              </button>
            </li>
          )}
        </ul>
      </div>

      <ViewsSection />
      <LibrarySection />

      <div className="side-section grow">
        <div className="side-head">
          <span>Entities</span>
          <button className="icon-btn" title="Add a type (Settlement, Flora, Fauna…)" onClick={() => addType(app, dialogs)}>
            ⊕
          </button>
          <button className="icon-btn" title="New entity (Ctrl+Shift+E)" onClick={() => newEntity()}>
            +
          </button>
        </div>
        <input className="side-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter entities" />
        <div className="entity-groups">
          {[...byType.entries()].map(([typeId, list]) => {
            const tpl = app.templates.get(typeId);
            if (!list.length && filter) return null;
            const closed = typesCollapsed.has(typeId);
            return (
              <div key={typeId} className="entity-group">
                <div className="group-head" onClick={() => toggleType(typeId)}>
                  <span className="twisty">{list.length ? (closed ? '▸' : '▾') : ''}</span>
                  <span>{tpl?.name ?? typeId}</span>
                  <span className="count">{list.length || ''}</span>
                  <button
                    className="icon-btn small"
                    title={`New ${tpl?.name ?? typeId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      newEntity(typeId);
                    }}
                  >
                    +
                  </button>
                </div>
                {!closed && (
                  <ul>
                    {list.map((e) => (
                      <li key={e.id}>
                        <button className={`entity-row ${activeEntity === e.id ? 'active' : ''}`} onClick={() => app.openTab({ kind: 'entity', id: e.id })}>
                          <span className="dot" style={{ background: e.color }} />
                          <span className="node-name">{e.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ContextMenu spec={menu} onClose={() => setMenu(null)} />
    </nav>
  );
}

export type { Parent };
