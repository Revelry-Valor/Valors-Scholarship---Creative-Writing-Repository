// The active scan's review queue (spec 7 "How I review suggestions", 12.1).
// Nothing is filed until you say so: A accept · X dismiss · N never in this document.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { BlockText } from './BlockText';
import { SUGGESTION_KINDS, type SuggestionKind } from '../../../core/scan';
import type { ScanScope } from '../../../core/vault';
import type { DocKind } from '../../../core/types';

type ScanResult = ApiResult<'scan'>;
export type Found = ScanResult['suggestions'][number];
type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

const KIND_ICON: Record<SuggestionKind, string> = { mention: '@', ambiguous: '?', keyword: '⌗', theme: '✦', scripture: '✝', major: '★', 'new-name': '+', activity: '✎' };
const kindLabel = (k: SuggestionKind) => SUGGESTION_KINDS.find((x) => x.id === k)?.label ?? k;

/** Open the review queue for part of the project. */
export function openReview(app: App, scope: ScanScope, label: string) {
  app.openTab({ kind: 'review', scope, label });
}

/** One suggestion: the paragraph with the match highlighted, why, and what to do. */
export function SuggestionCard({ s, compact, focused, onFocus, onResolved }: { s: Found; compact?: boolean; focused?: boolean; onFocus?: () => void; onResolved: (id: string) => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState(() => app.nameData.templates.find((t) => /person|father|character/.test(t.id))?.id ?? app.nameData.templates[0]?.id ?? '');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: false });
  }, [focused]);

  const target = s.entityIds.length === 1 ? app.entityById.get(s.entityIds[0]) : undefined;

  const accept = useCallback(
    async (choice?: { entityId?: string; type?: string; section?: string }) => {
      setBusy(true);
      try {
        const r = await api.acceptSuggestion(s.id, choice);
        const name = choice?.entityId ? app.entityById.get(choice.entityId)?.name : r.createdPage?.name ?? target?.name;
        app.notify(s.kind === 'major' ? 'Marked important' : `${r.createdPage ? `Created ${r.createdPage.name} and filed` : 'Filed'}${name && !r.createdPage ? ` to ${name}` : ''}${choice?.section ? ` · ${choice.section}` : ''}`);
        if (r.createdPage) await app.refreshNames();
        onResolved(s.id);
      } catch (e) {
        app.notify((e as Error).message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [s, app, target, onResolved],
  );

  const dismiss = useCallback(
    async (mode: 'once' | 'here' | 'everywhere') => {
      await api.dismissSuggestion(s.id, mode);
      onResolved(s.id);
    },
    [s.id, onResolved],
  );

  const pickSection = async (entityId?: string) => {
    const id = entityId ?? s.entityIds[0];
    const e = id ? app.entityById.get(id) : undefined;
    const tpl = e ? app.templates.get(e.type) : undefined;
    if (!tpl?.sections.length) return accept({ entityId: id });
    const section = await dialogs.pick({ title: `Which part of ${e!.name}?`, items: [{ label: 'No particular section', value: '' }, ...tpl.sections.map((x) => ({ label: x, value: x }))] });
    if (section === null) return;
    await accept({ entityId: id, section: section || undefined });
  };

  const otherPage = async () => {
    const id = await dialogs.pick({
      title: 'File this paragraph to…',
      items: [...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color })),
    });
    if (id) await pickSection(id);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || busy) return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'enter') {
      e.preventDefault();
      if (s.kind === 'ambiguous') void otherPage();
      else if (s.kind === 'new-name') void accept({ type });
      else if (s.kind === 'activity') void accept({ section: s.section });
      else void accept();
    } else if (k === 'x' || k === 'delete') {
      e.preventDefault();
      void dismiss('once');
    } else if (k === 'n') {
      e.preventDefault();
      void dismiss('here');
    } else if (k === 's' && s.entityIds.length === 1) {
      e.preventDefault();
      void pickSection();
    }
  };

  const openSource = () => app.openTab({ kind: s.source.kind as DocKind, id: s.source.id, focusBlock: s.blockId });

  return (
    <article ref={ref} className={`sg-card kind-${s.kind} ${compact ? 'compact' : ''} ${focused ? 'focused' : ''}`} tabIndex={0} onFocus={onFocus} onKeyDown={onKey} aria-busy={busy}>
      <header className="sg-head">
        <span className={`sg-kind kind-${s.kind}`} title={SUGGESTION_KINDS.find((x) => x.id === s.kind)?.hint}>
          {KIND_ICON[s.kind]} {kindLabel(s.kind)}
        </span>
        <span className="sg-why">{s.why}</span>
        {s.count > 1 && s.kind !== 'theme' && <span className="count">×{s.count}</span>}
      </header>
      <div className="sg-text" onDoubleClick={openSource} title="Double-click to open where it is">
        <BlockText text={s.text} highlights={s.spans} />
      </div>
      <footer className="sg-actions">
        {s.kind === 'activity' && target && (
          <>
            <button className="btn small btn-primary" disabled={busy} onClick={() => accept({ section: s.section })} title="A">
              <span className="dot" style={{ background: target.color }} /> File under {s.section} on {target.name}
            </button>
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                const section = await dialogs.prompt({ title: `Which section of ${target.name}?`, initial: s.section, okLabel: 'File' });
                if (section) await accept({ section });
              }}
            >
              Other section…
            </button>
          </>
        )}
        {s.kind === 'major' && (
          <button className="btn small btn-primary" disabled={busy} onClick={() => accept()}>
            ★ Mark important
          </button>
        )}
        {s.kind === 'ambiguous' &&
          s.entityIds.map((id) => {
            const e = app.entityById.get(id);
            return (
              <button key={id} className="btn small" disabled={busy} onClick={() => accept({ entityId: id })}>
                <span className="dot" style={{ background: e?.color }} /> {e?.name ?? id}
              </button>
            );
          })}
        {s.kind === 'new-name' && (
          <>
            <select className="input small" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type of page">
              {app.nameData.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className="btn small btn-primary" disabled={busy} onClick={() => accept({ type })}>
              Create “{s.create}”
            </button>
          </>
        )}
        {(s.kind === 'mention' || s.kind === 'keyword' || s.kind === 'scripture' || s.kind === 'theme') && (
          <>
            <button className="btn small btn-primary" disabled={busy} onClick={() => accept()} title="A">
              {target ? (
                <>
                  <span className="dot" style={{ background: target.color }} /> {s.kind === 'mention' ? 'Link' : 'File to'} {target.name}
                </>
              ) : (
                <>Create “{s.create}” and file</>
              )}
            </button>
            {target && app.templates.get(target.type)?.sections.length ? (
              <button className="btn small" disabled={busy} onClick={() => pickSection()} title="S: file to one part of the page">
                Section…
              </button>
            ) : null}
          </>
        )}
        {s.kind !== 'major' && s.kind !== 'new-name' && s.kind !== 'activity' && (
          <button className="btn small btn-ghost" disabled={busy} onClick={otherPage}>
            Other page…
          </button>
        )}
        <span className="spacer" />
        {!compact && (
          <button className="linkish small" onClick={openSource}>
            {s.source.title}
          </button>
        )}
        <button className="icon-btn" title="Dismiss (X)" disabled={busy} onClick={() => dismiss('once')}>
          ✕
        </button>
        <button className="linkish small muted" title="Never suggest this in this document (N)" onClick={() => dismiss('here')}>
          never here
        </button>
        {(s.kind === 'new-name' || s.kind === 'mention' || s.kind === 'ambiguous') && (
          <button className="linkish small muted" title="Never suggest this anywhere" onClick={() => dismiss('everywhere')}>
            never
          </button>
        )}
      </footer>
    </article>
  );
}

function useScan(scope: ScanScope | null, deps: unknown[]) {
  const app = useApp();
  const [res, setRes] = useState<ScanResult | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const key = JSON.stringify(scope);
  useEffect(() => {
    if (!scope) {
      setRes(null);
      return;
    }
    let live = true;
    const tm = setTimeout(() => {
      api
        .scan(scope)
        .then((r) => live && setRes(r))
        .catch(() => live && setRes({ suggestions: [], total: 0, truncated: false }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(tm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, app.version, ...deps]);
  useEffect(() => setHidden(new Set()), [res]);
  const list = useMemo(() => res?.suggestions.filter((s) => !hidden.has(s.id)) ?? null, [res, hidden]);
  const resolve = useCallback((id: string) => setHidden((h) => new Set(h).add(id)), []);
  return { res, list, resolve };
}

/** A keyboard-driven list: ↑/↓ or J/K move between cards. */
function CardList({ list, compact, resolve }: { list: Found[]; compact?: boolean; resolve: (id: string) => void }) {
  const [focus, setFocus] = useState(-1);
  const onResolved = (id: string) => {
    resolve(id);
    // Keep the keyboard on the next card.
    setFocus((f) => Math.min(f, list.length - 2));
  };
  const nav = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j') {
      e.preventDefault();
      setFocus((f) => Math.min(list.length - 1, f + 1));
    } else if (k === 'ArrowUp' || k === 'k') {
      e.preventDefault();
      setFocus((f) => Math.max(0, f - 1));
    }
  };
  let lastSource = '';
  return (
    <div className="sg-list" onKeyDown={nav}>
      {list.map((s, i) => {
        const src = `${s.source.kind}:${s.source.id}`;
        const head = !compact && src !== lastSource;
        lastSource = src;
        return (
          <div key={s.id}>
            {head && <h3 className="sg-source">{s.source.title}</h3>}
            <SuggestionCard s={s} compact={compact} focused={focus === i} onFocus={() => setFocus(i)} onResolved={onResolved} />
          </div>
        );
      })}
    </div>
  );
}

/** The right-bar list for the document you are in. */
export function SuggestionsPanel() {
  const app = useApp();
  const tab = app.tabs.find((t) => t.key === app.active);
  const scope: ScanScope | null = tab && (tab.kind === 'entry' || tab.kind === 'entity' || tab.kind === 'library') ? { doc: { kind: tab.kind, id: tab.id } } : null;
  const { list, res } = useScan(scope, []);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => setDone(new Set()), [res]);
  if (!scope) return <p className="muted panel-body">Open a document or an imported text to see what could be filed.</p>;
  const shown = list?.filter((s) => !hiddenKinds.has(s.kind) && !done.has(s.id)) ?? null;
  const counts = new Map<string, number>();
  for (const s of list ?? []) if (!done.has(s.id)) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  return (
    <div className="panel-body sg-panel">
      <p className="muted small">
        Things in this document that could be filed or marked. <kbd>A</kbd> accept · <kbd>X</kbd> dismiss · <kbd>N</kbd> never here · <kbd>S</kbd> choose section
      </p>
      <div className="sg-filters">
        {SUGGESTION_KINDS.filter((k) => counts.get(k.id)).map((k) => (
          <button
            key={k.id}
            className={`filter-chip ${hiddenKinds.has(k.id) ? '' : 'on'}`}
            onClick={() => setHiddenKinds((h) => (h.has(k.id) ? new Set([...h].filter((x) => x !== k.id)) : new Set(h).add(k.id)))}
          >
            {KIND_ICON[k.id]} {counts.get(k.id)}
          </button>
        ))}
      </div>
      {shown === null && <p className="muted">Scanning…</p>}
      {shown && !shown.length && <p className="muted">Nothing to suggest here. Names, trigger words and key statements are already filed or dismissed.</p>}
      {shown && <CardList list={shown} compact resolve={(id) => setDone((d) => new Set(d).add(id))} />}
      <div className="sg-panel-foot">
        <button className="btn small" onClick={() => app.openTab({ kind: 'triggers' })}>
          ✦ Trigger words…
        </button>
      </div>
    </div>
  );
}

const SCOPES: Array<{ label: string; scope: ScanScope }> = [
  { label: 'All my writing', scope: { writing: true } },
  { label: 'The whole Library', scope: { library: true } },
  { label: 'Everything', scope: { all: true } },
];

/** The review queue page: one import, a collection, your writing, or everything. */
export function ReviewPage({ scope, label }: { scope: ScanScope; label: string }) {
  const app = useApp();
  const { res, list, resolve } = useScan(scope, []);
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<ApiResult<'scanSettings'> | null>(null);
  const [collections, setCollections] = useState<string[]>([]);
  useEffect(() => {
    api.scanSettings().then(setSettings);
    api.listLibrary().then((l) => setCollections([...new Set(l.map((x) => x.collection).filter(Boolean))]));
  }, [app.version]);
  const counts = new Map<string, number>();
  for (const s of list ?? []) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const shown = list?.filter((s) => !kinds.size || kinds.has(s.kind)) ?? null;
  const setDetector = async (k: SuggestionKind, on: boolean) => setSettings(await api.setScanSettings({ detectors: { [k]: on } }));

  return (
    <div className="review-page">
      <header className="review-head">
        <h1>Review suggestions</h1>
        <div className="review-scope">
          <span className="muted">Scanning</span>
          <select
            className="input"
            value={JSON.stringify(scope)}
            onChange={(e) => {
              const opt = [...SCOPES, ...collections.map((c) => ({ label: `Library: ${c}`, scope: { collection: c } }))].find((o) => JSON.stringify(o.scope) === e.target.value);
              if (opt) openReview(app, opt.scope, opt.label);
            }}
          >
            {![...SCOPES.map((o) => o.scope), ...collections.map((c) => ({ collection: c }))].some((o) => JSON.stringify(o) === JSON.stringify(scope)) && <option value={JSON.stringify(scope)}>{label}</option>}
            {SCOPES.map((o) => (
              <option key={o.label} value={JSON.stringify(o.scope)}>
                {o.label}
              </option>
            ))}
            {collections.map((c) => (
              <option key={c} value={JSON.stringify({ collection: c })}>
                Library: {c}
              </option>
            ))}
          </select>
          {res && (
            <span className="muted small">
              {res.total.toLocaleString()} suggestion{res.total === 1 ? '' : 's'}
              {res.truncated ? ` (showing the first ${res.suggestions.length.toLocaleString()})` : ''}
            </span>
          )}
        </div>
        <p className="muted small">
          The program found these but changed nothing. In your own writing, accepting turns the words into a chip where they stand; in an imported text, the tag is added at the end of the paragraph so the source stays as written. Keys: <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>A</kbd> accept · <kbd>S</kbd> choose a section · <kbd>X</kbd> dismiss · <kbd>N</kbd> never in this document.
        </p>
        <div className="sg-filters">
          <button className={`filter-chip ${kinds.size ? '' : 'on'}`} onClick={() => setKinds(new Set())}>
            All {list?.length ?? ''}
          </button>
          {SUGGESTION_KINDS.map((k) => (
            <button
              key={k.id}
              className={`filter-chip ${kinds.has(k.id) ? 'on' : ''} ${counts.get(k.id) ? '' : 'empty'}`}
              title={k.hint}
              onClick={() => setKinds((cur) => (cur.has(k.id) ? new Set([...cur].filter((x) => x !== k.id)) : new Set(cur).add(k.id)))}
            >
              {KIND_ICON[k.id]} {k.label} {counts.get(k.id) ?? 0}
            </button>
          ))}
        </div>
        {settings && (
          <details className="review-settings">
            <summary>Scan settings</summary>
            <label className="check-row">
              <input type="checkbox" checked={settings.active} onChange={async (e) => setSettings(await api.setScanSettings({ active: e.target.checked }))} />
              <span>
                Active scan
                <small>Scan each text as you import it and open this review, and keep a live list for the document you are writing in (right bar ✦ Suggestions).</small>
              </span>
            </label>
            <div className="detector-grid">
              {SUGGESTION_KINDS.map((k) => (
                <label key={k.id} className="check-row small">
                  <input type="checkbox" checked={settings.detectors[k.id]} onChange={(e) => setDetector(k.id, e.target.checked)} />
                  <span>
                    {KIND_ICON[k.id]} {k.label}
                    <small>{k.hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <button className="btn small" onClick={() => app.openTab({ kind: 'triggers' })}>
              ✦ Edit trigger words…
            </button>
          </details>
        )}
      </header>
      {shown === null && <p className="muted review-empty">Scanning…</p>}
      {shown && !shown.length && <p className="muted review-empty">Nothing left to review here.</p>}
      {shown && <CardList list={shown} resolve={resolve} />}
    </div>
  );
}

/** After an import: scan it and ask what to file, if the active scan is on. */
export async function afterImport(app: App, ids: string[], title: string, force?: boolean) {
  const st = await api.scanSettings();
  if (!st.active && !force) return;
  const r = await api.scan({ ids }, { limit: 1 });
  if (r.total) {
    app.notify(`Active scan: ${r.total.toLocaleString()} suggestion${r.total === 1 ? '' : 's'} in ${title}`);
    openReview(app, { ids }, title);
  } else app.notify(`Active scan: nothing to file in ${title}`);
}

/** Trigger words: themes of words the scan looks for, each pointing at a page. */
export function TriggerWordsPage() {
  const app = useApp();
  const dialogs = useDialogs();
  const [themes, setThemes] = useState<ApiResult<'getTriggers'> | null>(null);
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const [wordsText, setWordsText] = useState('');
  useEffect(() => {
    api.getTriggers().then(setThemes);
  }, []);
  const loaded = !!themes;
  useEffect(() => {
    if (themes?.[sel]) setWordsText(themes[sel].words.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, loaded]);
  if (!themes) return <div className="loading">Loading…</div>;
  const t = themes[sel];
  const patch = (p: Partial<(typeof themes)[number]>) => {
    setThemes(themes.map((x, i) => (i === sel ? { ...x, ...p } : x)));
    setDirty(true);
  };
  const save = async () => {
    setThemes(await api.saveTriggers(themes));
    setDirty(false);
    app.notify('Trigger words saved');
  };
  const pages = app.nameData.entities.map((e) => e.name).sort();
  const total = themes.reduce((n, x) => n + x.words.length, 0);
  const visible = themes.map((x, i) => [x, i] as const).filter(([x]) => !filter || x.label.toLowerCase().includes(filter.toLowerCase()) || x.words.some((w) => w.includes(filter.toLowerCase())));

  return (
    <div className="triggers-page">
      <header className="review-head">
        <h1>Trigger words</h1>
        <p className="muted small">
          When a paragraph uses enough words from a theme, the scan offers to file it to that theme's page. Words ending in <code>*</code> match any ending (<code>baptiz*</code> finds baptize, baptized, baptizing). {themes.length} themes · {total.toLocaleString()} words.
        </p>
        <div className="triggers-actions">
          <input className="input" placeholder="Find a word or theme…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button
            className="btn small"
            onClick={() => {
              setThemes([...themes, { id: '', label: 'New theme', words: [], enabled: true }]);
              setSel(themes.length);
              setDirty(true);
            }}
          >
            + Theme
          </button>
          <button
            className="btn small btn-ghost"
            onClick={async () => {
              const ok = await dialogs.choose({ title: 'Put back the built-in word lists?', message: <p>Built-in themes return to their original words. Themes you added yourself are kept.</p>, choices: [{ label: 'Put them back', value: true, kind: 'primary' }, { label: 'Cancel', value: false }] });
              if (ok) {
                const next = await api.resetTriggers();
                setThemes(next);
                setWordsText(next[sel]?.words.join('\n') ?? '');
                setDirty(false);
              }
            }}
          >
            Restore built-in lists
          </button>
          <span className="spacer" />
          <button className="btn btn-primary small" disabled={!dirty} onClick={save}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </header>
      <div className="triggers-body">
        <ul className="theme-list">
          {visible.map(([x, i]) => (
            <li key={`${x.id}-${i}`} className={`${i === sel ? 'on' : ''} ${x.enabled === false ? 'off' : ''}`} onClick={() => setSel(i)}>
              <span className="theme-name">{x.label}</span>
              <span className="count">{x.words.length}</span>
            </li>
          ))}
        </ul>
        {t && (
          <section className="theme-edit">
            <div className="import-grid">
              <label>
                Theme
                <input className="input" value={t.label} onChange={(e) => patch({ label: e.target.value })} />
              </label>
              <label>
                Files to the page
                <input className="input" list="trigger-pages" value={t.entity ?? ''} placeholder={`${t.label} (made when first used)`} onChange={(e) => patch({ entity: e.target.value || undefined })} />
                <datalist id="trigger-pages">
                  {pages.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label>
                Words needed
                <select className="input" value={t.min ?? 2} onChange={(e) => patch({ min: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} different word{n === 1 ? '' : 's'} in a paragraph
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={t.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span>Scan for this theme</span>
            </label>
            <label className="modal-label" htmlFor="theme-words">
              Words and phrases ({t.words.length}) — one per line or separated by commas
            </label>
            <textarea
              id="theme-words"
              className="input theme-words"
              value={wordsText}
              onChange={(e) => {
                setWordsText(e.target.value);
                patch({
                  words: e.target.value
                    .split(/[,\n]/)
                    .map((x) => x.trim().toLowerCase())
                    .filter(Boolean),
                });
              }}
              rows={18}
              spellCheck={false}
            />
            <div className="theme-foot">
              <button
                className="btn small btn-ghost danger"
                onClick={() => {
                  setThemes(themes.filter((_, i) => i !== sel));
                  setSel(Math.max(0, sel - 1));
                  setDirty(true);
                }}
              >
                Delete theme
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Live count for the top-bar button while the active scan is on. */
export function SuggestBadge() {
  const app = useApp();
  const tab = app.tabs.find((t) => t.key === app.active);
  const doc = tab && (tab.kind === 'entry' || tab.kind === 'entity' || tab.kind === 'library') ? { kind: tab.kind, id: tab.id } : null;
  const [n, setN] = useState(0);
  const docKey = doc ? `${doc.kind}:${doc.id}` : '';
  useEffect(() => {
    if (!doc) {
      setN(0);
      return;
    }
    let live = true;
    const tm = setTimeout(async () => {
      try {
        const st = await api.scanSettings();
        const r = st.active ? await api.scan({ doc }, { limit: 1 }) : { total: 0 };
        if (live) setN(r.total);
      } catch {
        // no vault
      }
    }, 900);
    return () => {
      live = false;
      clearTimeout(tm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, app.version]);
  return n ? <span className="sg-badge">{n > 99 ? '99+' : n}</span> : null;
}
