// Parallel accounts and extraction tables: saved views like the charts, drawn from your pages.
import { useEffect, useMemo, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from '../components/Dialogs';
import { BlockText } from '../components/BlockText';
import { COMPUTED_COLUMNS, tableCsv, wordDiff, type EntityTable } from '../../../core/compare';
import type { DocKind, ViewDef } from '../../../core/types';

type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;
type Column = NonNullable<ViewDef['columns']>[number];

function ViewHead({ def, setDef, update, icon, label, children }: { def: ViewDef; setDef: (d: ViewDef) => void; update: (p: Partial<ViewDef>) => void; icon: string; label: string; children?: React.ReactNode }) {
  const app = useApp();
  const dialogs = useDialogs();
  return (
    <div className="view-bar">
      <span className="view-kind">
        {icon} {label}
      </span>
      <input className="view-name" value={def.name} aria-label="View name" onChange={(e) => setDef({ ...def, name: e.target.value })} onBlur={() => update({ name: def.name.trim() || label })} />
      {children}
      <span className="spacer" />
      <button
        className="btn btn-ghost small"
        onClick={async () => {
          const ok = await dialogs.choose({ title: `Delete “${def.name}”?`, message: <p>Only this view's settings are removed. Nothing you wrote changes.</p>, choices: [{ label: 'Delete', value: true, kind: 'danger' }, { label: 'Cancel', value: false, kind: 'primary' }] });
          if (!ok) return;
          await api.deleteView(def.id);
          app.closeTab(`view:${def.id}`);
        }}
      >
        Delete
      </button>
    </div>
  );
}

/** Choose a column for a parallel view: a document, an imported text, a page, or a lookup. */
async function pickColumn(app: App, dialogs: Dialogs): Promise<Column | null> {
  const lib = await api.listLibrary();
  const binder = await api.binder();
  const entries: Array<{ id: string; name: string }> = [];
  const walk = (nodes: typeof binder) => {
    for (const n of nodes) {
      if (n.kind === 'entry') entries.push({ id: n.id, name: n.name });
      walk(n.children);
    }
  };
  walk(binder);
  const choice = await dialogs.pick<string>({
    title: 'Add a column',
    placeholder: 'A Bible, a Father’s work, your document, a page, or a lookup…',
    items: [
      { label: '⌕ A lookup (words or a verse)…', detail: 'every paragraph that matches', value: 'query' },
      ...lib.map((l) => ({ label: `${l.kind === 'bible' ? '✝' : '❡'} ${l.author ? `${l.author}, ` : ''}${l.title}`, detail: l.collection || 'Library', value: `library:${l.id}` })),
      ...entries.map((e) => ({ label: `✎ ${e.name}`, detail: 'your writing', value: `entry:${e.id}` })),
      ...[...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: `● ${e.name}`, detail: `${e.typeName} page`, value: `entity:${e.id}`, color: e.color })),
    ],
  });
  if (!choice) return null;
  if (choice === 'query') {
    const q = await dialogs.prompt({ title: 'Lookup column', label: 'Words, "phrases" or a verse (e.g. John 1:1-5, baptism)', okLabel: 'Add' });
    return q ? { query: q } : null;
  }
  const [kind, id] = choice.split(':') as [DocKind, string];
  return { source: { kind, id } };
}

const strip = (t: string) => t.replace(/^\[[^\]]+\]\s*/, '');

/** Mark what differs only when two passages are mostly alike (translations, parallel accounts). */
function differences(a: string, b: string): Array<[number, number]> | undefined {
  const d = wordDiff(a, b);
  const changed = d.reduce((n, [x, y]) => n + (y - x), 0);
  return changed > b.length * 0.5 ? undefined : d;
}

export function ParallelPage({ def, setDef, update }: { def: ViewDef; setDef: (d: ViewDef) => void; update: (p: Partial<ViewDef>) => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [data, setData] = useState<ApiResult<'parallel'> | null>(null);
  const [diff, setDiff] = useState((def.align ?? 'verse') !== 'order');
  const cols = def.columns ?? [];
  const key = JSON.stringify([cols, def.align]);
  useEffect(() => {
    api.parallel({ columns: cols, align: def.align }).then(setData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, app.version]);

  const add = async () => {
    const c = await pickColumn(app, dialogs);
    if (c) update({ columns: [...cols, c] });
  };
  const open = (c: { id: string; source: { kind: DocKind; id: string } }) => app.openTab({ kind: c.source.kind, id: c.source.id, focusBlock: c.id });

  return (
    <div className="view-page compare-page">
      <ViewHead def={def} setDef={setDef} update={update} icon="⫴" label="Parallel accounts">
        <label className="view-ctl">
          Line up
          <select value={def.align ?? 'verse'} onChange={(e) => update({ align: e.target.value as ViewDef['align'] })}>
            <option value="verse">by verse</option>
            <option value="tag">by the page they are filed to</option>
            <option value="order">in order</option>
          </select>
        </label>
        <label className="view-ctl inline-check">
          <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Show differences
        </label>
      </ViewHead>
      <div className="parallel-cols-bar">
        {cols.map((c, i) => (
          <span key={i} className="parallel-col-chip">
            {data?.columns[i]?.label ?? '…'}
            {i > 0 && (
              <button className="linkish" title="Move left" onClick={() => update({ columns: cols.map((x, j) => (j === i - 1 ? cols[i] : j === i ? cols[i - 1] : x)) })}>
                ←
              </button>
            )}
            <button className="linkish" title="Remove column" onClick={() => update({ columns: cols.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </span>
        ))}
        <button className="btn small" onClick={add}>
          + Column
        </button>
      </div>
      <div className="parallel-scroll">
        {!cols.length && (
          <div className="view-empty">
            <p>Put accounts side by side: two translations of a chapter, the four Gospels, what several Fathers say about the same verse, or your notes next to the source.</p>
            <button className="btn btn-primary" onClick={add}>
              + Add the first column
            </button>
          </div>
        )}
        {data && cols.length > 0 && !data.rows.length && <p className="view-empty">Nothing lines up yet. {def.align === 'verse' ? 'Line up by verse needs Bible texts or paragraphs that cite verses.' : ''}</p>}
        {data && data.rows.length > 0 && (
          <table className="parallel-table" style={{ ['--cols' as string]: cols.length }}>
            <thead>
              <tr>
                <th />
                {data.columns.map((c, i) => (
                  <th key={i}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const base = r.cells.find((c) => c.length)?.[0];
                return (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    {r.cells.map((cell, i) => (
                      <td key={i}>
                        {cell.map((c) => (
                          <div key={c.id} className="parallel-cell" onDoubleClick={() => open(c)} title="Double-click to open">
                            <BlockText text={strip(c.text)} highlights={diff && base && base.id !== c.id ? differences(strip(base.text), strip(c.text)) : undefined} />
                            {def.align !== 'order' && c.source.title !== data.columns[i].label && <span className="parallel-src">{c.source.title}</span>}
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data?.truncated && <p className="muted small">Showing the first rows only.</p>}
      </div>
    </div>
  );
}

export function TablePage({ def, setDef, update }: { def: ViewDef; setDef: (d: ViewDef) => void; update: (p: Partial<ViewDef>) => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [data, setData] = useState<EntityTable | null>(null);
  const [filter, setFilter] = useState('');
  const key = JSON.stringify([def.types, def.fields]);
  useEffect(() => {
    api.entityTable({ types: def.types, fields: def.fields }).then(setData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, app.version]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    let list = f ? data.rows.filter((r) => r.name.toLowerCase().includes(f) || Object.values(r.cells).some((c) => c.text.toLowerCase().includes(f))) : data.rows;
    if (def.sortBy) {
      const k = def.sortBy;
      const num = data.columns.find((c) => c.key === k)?.numeric;
      list = [...list].sort((a, b) => {
        const ca = k === '@name' ? { text: a.name } : a.cells[k];
        const cb = k === '@name' ? { text: b.name } : b.cells[k];
        const x = num ? (ca?.sort ?? Number.NEGATIVE_INFINITY) - (cb?.sort ?? Number.NEGATIVE_INFINITY) : (ca?.text ?? '').localeCompare(cb?.text ?? '');
        return def.sortDesc ? -x : x;
      });
    }
    return list;
  }, [data, filter, def.sortBy, def.sortDesc]);

  const sortBy = (k: string) => update(def.sortBy === k ? { sortDesc: !def.sortDesc } : { sortBy: k, sortDesc: false });
  const current = data?.columns.map((c) => c.key) ?? [];
  const addColumn = async () => {
    const types = app.nameData.templates.filter((t) => !def.types?.length || def.types.includes(t.id));
    const fields = new Map<string, string>();
    for (const t of types) for (const f of t.fields) if (!fields.has(f.key)) fields.set(f.key, f.label);
    const k = await dialogs.pick<string>({
      title: 'Add a column',
      items: [
        ...[...fields].filter(([key]) => !current.includes(key)).map(([key, label]) => ({ label, detail: 'fact', value: key })),
        ...COMPUTED_COLUMNS.filter((c) => !current.includes(c.key)).map((c) => ({ label: c.label, detail: c.hint, value: c.key })),
        { label: 'Count a word…', detail: 'how many of each page’s paragraphs use a word (baptism, grace*)', value: '#' },
      ],
    });
    if (!k) return;
    if (k === '#') {
      const w = await dialogs.prompt({ title: 'Count a word', label: 'A word, "phrase" or stem* to count in each page’s paragraphs', okLabel: 'Add' });
      if (w) update({ fields: [...current, `#${w.trim().toLowerCase()}`] });
    } else update({ fields: [...current, k] });
  };
  const download = () => {
    if (!data) return;
    const blob = new Blob([tableCsv({ ...data, rows })], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${def.name}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const types = app.nameData.templates;

  return (
    <div className="view-page compare-page">
      <ViewHead def={def} setDef={setDef} update={update} icon="▦" label="Table">
        <input className="input small table-filter" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn small" onClick={addColumn}>
          + Column
        </button>
        <button className="btn small btn-ghost" onClick={download} title="Download as a spreadsheet (CSV)">
          ⤓ CSV
        </button>
      </ViewHead>
      <div className="view-filters">
        <span className="filter-label">Rows</span>
        {types.map((t) => {
          const on = def.types?.includes(t.id);
          return (
            <button key={t.id} className={`filter-chip ${on ? 'on' : ''}`} style={{ ['--chip' as string]: t.color ?? 'var(--accent)' }} onClick={() => update({ types: on ? def.types!.filter((x) => x !== t.id) : [...(def.types ?? []), t.id] })}>
              {t.name}
            </button>
          );
        })}
        {!def.types?.length && <span className="muted small">every type</span>}
      </div>
      <div className="table-scroll">
        {data && (
          <table className="extract-table">
            <thead>
              <tr>
                <th onClick={() => sortBy('@name')} className={def.sortBy === '@name' ? 'sorted' : ''}>
                  Name {def.sortBy === '@name' ? (def.sortDesc ? '▾' : '▴') : ''}
                </th>
                {data.columns.map((c) => (
                  <th key={c.key} className={`${c.numeric ? 'num' : ''} ${def.sortBy === c.key ? 'sorted' : ''}`} onClick={() => sortBy(c.key)} title="Click to sort">
                    {c.label} {def.sortBy === c.key ? (def.sortDesc ? '▾' : '▴') : ''}
                    <button
                      className="col-x"
                      title="Remove column"
                      onClick={(e) => {
                        e.stopPropagation();
                        update({ fields: current.filter((x) => x !== c.key) });
                      }}
                    >
                      ✕
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <button className="linkish" onClick={() => app.openTab({ kind: 'entity', id: r.id })}>
                      <span className="dot" style={{ background: r.color }} /> {r.name}
                    </button>
                  </th>
                  {data.columns.map((c) => {
                    const cell = r.cells[c.key];
                    return (
                      <td key={c.key} className={`${c.numeric ? 'num' : ''} ${cell?.disputed ? 'disputed' : ''}`} title={cell?.disputed ? 'Sources disagree' : undefined}>
                        {cell?.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && !rows.length && <p className="view-empty">No pages {filter ? 'match the filter' : 'of these types yet'}.</p>}
      </div>
      <p className="muted small table-foot">
        {rows.length} row{rows.length === 1 ? '' : 's'} · values come from each page’s facts and from <code>{'{field: value}'}</code> in any paragraph; <span className="disputed-key">amber</span> where sources disagree.
      </p>
    </div>
  );
}
