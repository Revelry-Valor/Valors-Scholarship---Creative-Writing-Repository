// The Research pane: a lookup beside the page you are writing. It reads your Library
// (and, if you ask, other projects' Libraries) and shows whole paragraphs with the
// relevant words highlighted. The canon study adds a book × author table.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { BlockText } from './BlockText';
import { insertParagraph } from '../editor/Editor';
import { CANON_WORKS, STANCES, cellStance, type Stance } from '../../../core/lookup';
import type { ScanScope, SavedLookup } from '../../../core/vault';
import type { DocKind } from '../../../core/types';

type Result = ApiResult<'lookup'>;
type Hit = Result['hits'][number];

const SCOPES: Array<{ label: string; scope: ScanScope }> = [
  { label: 'the Library', scope: { library: true } },
  { label: 'my writing', scope: { writing: true } },
  { label: 'everything', scope: { all: true } },
];

const EXAMPLES: Array<{ label: string; q: Omit<SavedLookup, 'name'> }> = [
  { label: 'Canon of Scripture: which books did each author receive?', q: { text: '', concept: 'canon', scope: { library: true } } },
  { label: 'Every paragraph citing Romans 3', q: { text: 'Rom 3', scope: { all: true } } },
  { label: 'Baptism of infants', q: { text: '"infant baptism" infants baptiz*', scope: { library: true } } },
];

export function ResearchPane() {
  const app = useApp();
  const dialogs = useDialogs();
  const [text, setText] = useState('');
  const [concept, setConcept] = useState('');
  const [scope, setScope] = useState<ScanScope>({ library: true });
  const [matchAll, setMatchAll] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [others, setOthers] = useState<Array<{ path: string; name: string }>>([]);
  const [themes, setThemes] = useState<Array<{ id: string; label: string }>>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedLookup[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'paragraphs' | 'table'>('paragraphs');
  const [only, setOnly] = useState<{ label: string; ids: string[] } | null>(null);
  const [context, setContext] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getTriggers().then((t) => setThemes(t.map((x) => ({ id: x.id, label: x.label }))));
    api.listLibrary().then((l) => setCollections([...new Set(l.map((x) => x.collection).filter(Boolean))]));
    api.listLookups().then(setSaved);
    api.appState().then((st) => setOthers(st.recent.filter((r) => r.path !== app.info.root).map((r) => ({ path: r.path, name: r.name }))));
    input.current?.focus();
  }, [app.info.root]);

  const run = async (q?: Omit<SavedLookup, 'name'>) => {
    const query = q ?? { text, concept: concept || undefined, scope, matchAll, projects };
    if (q) {
      setText(q.text);
      setConcept(q.concept ?? '');
      setScope(q.scope ?? { library: true });
      setMatchAll(!!q.matchAll);
      setProjects(q.projects ?? []);
    }
    if (!query.text.trim() && !query.concept) return;
    setBusy(true);
    setOnly(null);
    try {
      const r = await api.lookup({ text: query.text, concept: query.concept, scope: query.scope, matchAll: query.matchAll }, { projects: query.projects });
      setRes(r);
      setView(r.canon && r.canon.works.length ? 'table' : 'paragraphs');
    } catch (e) {
      app.notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const name = await dialogs.prompt({ title: 'Save this lookup', label: 'Name', initial: concept === 'canon' ? 'Canon of Scripture' : text, okLabel: 'Save' });
    if (!name) return;
    setSaved(await api.saveLookup({ name, text, concept: concept || undefined, scope, matchAll, projects }));
    app.notify(`Saved “${name}”`);
  };

  const scopeKey = JSON.stringify(scope);
  const scopeOptions = [...SCOPES, ...collections.map((c) => ({ label: `Library: ${c}`, scope: { collection: c } as ScanScope }))];

  const hits = useMemo(() => (res ? (only ? res.hits.filter((h) => only.ids.includes(h.blockId)) : res.hits) : []), [res, only]);

  return (
    <div className="research">
      <header className="research-head">
        <h2>Research</h2>
        <select
          className="input small"
          value=""
          aria-label="Saved lookups"
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('saved:')) {
              const l = saved.find((x) => x.name === v.slice(6));
              if (l) void run(l);
            } else if (v.startsWith('ex:')) void run(EXAMPLES[Number(v.slice(3))].q);
          }}
        >
          <option value="">Saved lookups…</option>
          {saved.map((l) => (
            <option key={l.name} value={`saved:${l.name}`}>
              {l.name}
            </option>
          ))}
          <optgroup label="Examples">
            {EXAMPLES.map((x, i) => (
              <option key={x.label} value={`ex:${i}`}>
                {x.label}
              </option>
            ))}
          </optgroup>
        </select>
        <button className="icon-btn" title="Close research" onClick={() => app.setPanels({ research: false })}>
          ×
        </button>
      </header>
      <form
        className="research-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input ref={input} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder='Words, "exact phrases", stems*, -exclude, or verses (Rom 3:23)' />
        <div className="research-row">
          <select className="input small" value={concept} onChange={(e) => setConcept(e.target.value)} aria-label="Add a concept">
            <option value="">Just these words</option>
            <option value="canon">+ Canon of Scripture study</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                + {t.label} words
              </option>
            ))}
          </select>
          <span className="muted small">in</span>
          <select className="input small" value={scopeKey} onChange={(e) => setScope(JSON.parse(e.target.value))} aria-label="Where to look">
            {scopeOptions.map((o) => (
              <option key={o.label} value={JSON.stringify(o.scope)}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="inline-check small">
            <input type="checkbox" checked={matchAll} onChange={(e) => setMatchAll(e.target.checked)} /> every word
          </label>
        </div>
        {others.length > 0 && (
          <details className="research-projects">
            <summary className="small">
              Also read other projects' Libraries{projects.length ? ` (${projects.length})` : ''}
            </summary>
            {others.map((o) => (
              <label key={o.path} className="inline-check small">
                <input type="checkbox" checked={projects.includes(o.path)} onChange={(e) => setProjects((p) => (e.target.checked ? [...p, o.path] : p.filter((x) => x !== o.path)))} /> {o.name}
              </label>
            ))}
            <p className="muted small">Read-only: nothing is linked between projects.</p>
          </details>
        )}
        <div className="research-row">
          <button className="btn btn-primary small" type="submit" disabled={busy}>
            {busy ? 'Reading…' : 'Look up'}
          </button>
          <button className="btn small btn-ghost" type="button" onClick={save} disabled={!text.trim() && !concept}>
            Save lookup
          </button>
        </div>
      </form>

      {res && (
        <div className="research-results">
          <div className="research-tabs">
            <button className={`filter-chip ${view === 'paragraphs' ? 'on' : ''}`} onClick={() => setView('paragraphs')}>
              ¶ Paragraphs {res.total.toLocaleString()}
            </button>
            {res.canon && (
              <button className={`filter-chip ${view === 'table' ? 'on' : ''}`} onClick={() => setView('table')}>
                ▦ Canon table {res.canon.works.length}
              </button>
            )}
            <span className="spacer" />
            {view === 'paragraphs' && (
              <label className="inline-check small">
                <input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} /> show the paragraphs around
              </label>
            )}
          </div>
          {view === 'table' && res.canon ? (
            <CanonTableView
              table={res.canon}
              onCell={(label, ids) => {
                setOnly({ label, ids });
                setView('paragraphs');
              }}
            />
          ) : (
            <>
              {only && (
                <p className="research-only">
                  Showing {only.label}{' '}
                  <button className="linkish small" onClick={() => setOnly(null)}>
                    show all
                  </button>
                </p>
              )}
              {!hits.length && <p className="muted">Nothing found. Try fewer words, a stem like baptiz*, or look in everything.</p>}
              <HitList hits={hits} context={context} />
              {res.total > res.hits.length && <p className="muted small">Showing the best {res.hits.length} of {res.total.toLocaleString()} paragraphs.</p>}
            </>
          )}
        </div>
      )}
      {!res && (
        <div className="research-help muted small">
          <p>Look something up without leaving your page. Results are whole paragraphs with the matching words highlighted, grouped by work and author.</p>
          <p>
            <strong>Canon of Scripture study</strong> reads every paragraph that names a biblical or early Christian writing and notes whether the author receives it, doubts it or rejects it, then builds a table of books against authors.
          </p>
          <p>Import Bibles and the Fathers' works into the Library first (sidebar → Library → +).</p>
        </div>
      )}
    </div>
  );
}

function HitList({ hits, context }: { hits: Hit[]; context: boolean }) {
  const app = useApp();
  const dialogs = useDialogs();
  let last = '';
  const fileTo = async (h: Hit) => {
    const entityId = await dialogs.pick({ title: 'File this paragraph to…', items: [...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color })) });
    if (!entityId) return;
    await api.annotateLibraryBlock(h.blockId, { entityId });
    app.notify(`Filed to ${app.entityById.get(entityId)?.name}`);
  };
  const quote = async (h: Hit) => {
    const q = await api.quoteFor(h.blockId);
    if (insertParagraph(q)) app.notify('Quotation added to your page');
    else {
      await navigator.clipboard?.writeText(q).catch(() => undefined);
      app.notify('No document open to write in, so the quotation was copied');
    }
  };
  return (
    <div className="hit-list">
      {hits.map((h) => {
        const src = `${h.source.project ?? ''}|${h.source.kind}:${h.source.id}`;
        const head = src !== last;
        last = src;
        const foreign = !!h.source.project;
        return (
          <div key={`${src}|${h.blockId}`}>
            {head && (
              <h3 className="hit-source">
                {h.source.author && <span className="hit-author">{h.source.author}</span>}
                <span>{h.source.title}</span>
                {h.source.project && <span className="hit-project">{h.source.project}</span>}
              </h3>
            )}
            <article className="hit">
              {context && h.before && (
                <div className="hit-context">
                  <BlockText text={h.before} />
                </div>
              )}
              <div className="hit-text">
                <BlockText text={h.text} highlights={h.spans} />
              </div>
              {context && h.after && (
                <div className="hit-context">
                  <BlockText text={h.after} />
                </div>
              )}
              <footer className="hit-actions">
                <span className="muted small">{h.terms.slice(0, 6).join(' · ')}</span>
                <span className="spacer" />
                {!foreign && (
                  <>
                    <button className="foot-btn" title="Add this as a quotation, with its source, to the page you are writing" onClick={() => quote(h)}>
                      ❝ Quote
                    </button>
                    {h.source.kind === 'library' && (
                      <>
                        <button className="foot-btn" onClick={() => fileTo(h)}>
                          File to…
                        </button>
                        <button className="foot-btn" title="Mark important" onClick={() => api.annotateLibraryBlock(h.blockId, { mark: 'key' })}>
                          ★
                        </button>
                      </>
                    )}
                    <button className="foot-btn" onClick={() => app.openTab({ kind: h.source.kind as DocKind, id: h.source.id, focusBlock: h.blockId })}>
                      Open
                    </button>
                  </>
                )}
              </footer>
            </article>
          </div>
        );
      })}
    </div>
  );
}

function CanonTableView({ table, onCell }: { table: NonNullable<Result['canon']>; onCell: (label: string, ids: string[]) => void }) {
  const order = new Map(CANON_WORKS.map((w, i) => [w.id, i]));
  const works = [...table.works].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const [hide, setHide] = useState<Set<Stance>>(new Set(['mentioned']));
  let group = '';
  if (!works.length) return <p className="muted">No early writings named in these paragraphs yet.</p>;
  return (
    <div className="canon-wrap">
      <div className="canon-legend">
        {STANCES.map((s) => (
          <button key={s.id} className={`filter-chip st-${s.id} ${hide.has(s.id) ? '' : 'on'}`} onClick={() => setHide((h) => (h.has(s.id) ? new Set([...h].filter((x) => x !== s.id)) : new Set(h).add(s.id)))}>
            <span className={`st st-${s.id}`}>{s.mark}</span> {s.label}
          </button>
        ))}
      </div>
      <div className="canon-scroll">
        <table className="canon-table">
          <thead>
            <tr>
              <th />
              {table.columns.map((c) => (
                <th key={c.key} title={c.label}>
                  <span>{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {works.map((w) => {
              const row = table.cells[w.id] ?? {};
              const showGroup = w.group !== group;
              group = w.group;
              return [
                showGroup ? (
                  <tr key={`g-${w.group}`} className="canon-group">
                    <td colSpan={table.columns.length + 1}>{w.group}</td>
                  </tr>
                ) : null,
                <tr key={w.id}>
                  <th scope="row">{w.label}</th>
                  {table.columns.map((c) => {
                    const cell = row[c.key];
                    if (!cell) return <td key={c.key} />;
                    const st = cellStance(cell);
                    if (hide.has(st)) return <td key={c.key} />;
                    const mark = STANCES.find((s) => s.id === st)!;
                    const detail = (Object.entries(cell.stances) as Array<[Stance, number]>).map(([k, n]) => `${STANCES.find((s) => s.id === k)!.label}: ${n}`).join('\n');
                    return (
                      <td key={c.key}>
                        <button className={`st st-${st}`} title={`${w.label} in ${c.label}\n${detail}\nClick to read the paragraphs`} onClick={() => onCell(`${w.label} in ${c.label}`, cell.blockIds)}>
                          {mark.mark}
                          {cell.blockIds.length > 1 && <sub>{cell.blockIds.length}</sub>}
                        </button>
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Read from the wording around each name (received, disputed, spurious, cited…). Click a mark to read the paragraphs and check the reading for yourself.</p>
    </div>
  );
}

/** Drag handle between the page and the Research pane. */
export function ResearchSplitter() {
  const app = useApp();
  const onDown = (e: RPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = app.panels.researchWidth ?? 520;
    const move = (ev: PointerEvent) => app.setPanels({ researchWidth: Math.max(340, Math.min(window.innerWidth * 0.7, start + (startX - ev.clientX))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="research-splitter" onPointerDown={onDown} role="separator" aria-orientation="vertical" title="Drag to resize" />;
}
