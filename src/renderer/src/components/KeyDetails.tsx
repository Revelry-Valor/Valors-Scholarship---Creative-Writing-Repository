// Important details: paragraphs marked !key / !check and phrases marked !!like this!!.
// Shown in a box at the top of every page they are about, and on one project-wide page.
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { BlockText } from './BlockText';
import type { BlockView } from '../../../core/views';

function open(app: ReturnType<typeof useApp>, b: BlockView) {
  app.openTab({ kind: b.source.kind, id: b.source.id, focusBlock: b.id });
}

function icon(b: BlockView) {
  if (b.marks.includes('key')) return <span className="kd-icon key" title="Important">★</span>;
  if (b.marks.includes('check')) return <span className="kd-icon check" title="To check">⚑</span>;
  return <span className="kd-icon phrase" title="Marked phrase">❖</span>;
}

/** The box at the top of a person's or topic's page. */
export function KeyDetailsBox({ items }: { items: BlockView[] }) {
  const app = useApp();
  if (!items.length) return null;
  return (
    <section className="kd-box" aria-label="Key details">
      <h2 className="kd-title">Key details</h2>
      <ul>
        {items.map((b) => (
          <li key={b.id}>
            {icon(b)}
            <div className="kd-text">
              <BlockText text={b.text} />
              <button className="src-link" onClick={() => open(app, b)}>
                {b.source.title}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Groups = ApiResult<'keyDetails'>;

const FILTERS: Array<{ id: '' | 'key' | 'check' | 'phrase'; label: string }> = [
  { id: '', label: 'Everything marked' },
  { id: 'key', label: '★ Important' },
  { id: 'check', label: '⚑ To check' },
  { id: 'phrase', label: '❖ Marked phrases' },
];

/** The project-wide page (top bar ★ Key details). */
export function KeyDetailsPage() {
  const app = useApp();
  const [mark, setMark] = useState<'' | 'key' | 'check' | 'phrase'>('');
  const [entityId, setEntityId] = useState('');
  const [groups, setGroups] = useState<Groups | null>(null);
  useEffect(() => {
    api.keyDetails({ mark: mark || undefined, entityId: entityId || undefined }).then(setGroups);
  }, [mark, entityId, app.version]);
  const total = groups?.reduce((n, g) => n + g.blocks.length, 0) ?? 0;
  return (
    <div className="kd-page">
      <header className="kd-page-head">
        <h1>Key details</h1>
        <div className="kd-links">
          <button className="linkish small" onClick={() => app.openTab({ kind: 'claims' })}>
            ⚖ Claims &amp; evidence →
          </button>
          <button className="linkish small" onClick={() => app.openTab({ kind: 'conflicts' })}>
            ⚡ Contradictions →
          </button>
        </div>
        <p className="muted">
          Mark a paragraph with <kbd>Ctrl+Shift+K</kbd> or the ★ button (<code>!key</code>), something to verify with ⚑ (<code>!check</code>), or select words and press ★ to mark just that phrase (<code>!!like this!!</code>).
        </p>
        <div className="kd-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`filter-chip ${mark === f.id ? 'on' : ''}`} onClick={() => setMark(f.id)}>
              {f.label}
            </button>
          ))}
          <select className="input kd-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label="About">
            <option value="">About anyone or anything</option>
            {[...app.nameData.entities]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  About {e.name}
                </option>
              ))}
          </select>
        </div>
      </header>
      {groups && !total && <p className="view-empty">Nothing marked yet{mark || entityId ? ' with these filters' : ''}.</p>}
      {groups?.map((g) => (
        <section key={`${g.source.kind}:${g.source.id}`} className="kd-group">
          <h2>
            <button className="linkish" onClick={() => app.openTab({ kind: g.source.kind, id: g.source.id })}>
              {g.source.title}
            </button>
            <span className="count">{g.blocks.length}</span>
          </h2>
          <ul>
            {g.blocks.map((b) => (
              <li key={b.id} className="kd-item" onClick={() => open(app, b)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(app, b)}>
                {icon(b)}
                <div className="kd-text">
                  <BlockText text={b.text} />
                  {b.filedTo.length > 0 && (
                    <span className="also">
                      {b.filedTo.map((o) => (
                        <span key={o.id} className="also-dot" style={{ background: o.color }} title={o.name} />
                      ))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
