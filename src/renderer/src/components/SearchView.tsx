// Full-text search across every block, with entity and type filters (spec 12).
import { useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { BlockText } from './BlockText';

type Hit = ApiResult<'search'>[number];

export function SearchView({ query }: { query: string }) {
  const app = useApp();
  const [q, setQ] = useState(query);
  const [entityId, setEntityId] = useState('');
  const [type, setType] = useState('');
  const [where, setWhere] = useState<'' | 'entry' | 'entity'>('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQ(query), [query]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const tm = setTimeout(() => {
      api.search(q, { entityId: entityId || undefined, type: type || undefined, kind: where || undefined }).then(setHits);
    }, 150);
    return () => clearTimeout(tm);
  }, [q, entityId, type, where, app.version]);

  return (
    <div className="search-view">
      <div className="search-bar">
        <input ref={input} className="input search-input" placeholder="Search every block…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filed to type">
          <option value="">Any type</option>
          {app.nameData.templates.map((t) => (
            <option key={t.id} value={t.id}>
              Filed to a {t.name}
            </option>
          ))}
        </select>
        <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label="Filed to entity">
          <option value="">Any entity</option>
          {[...app.nameData.entities]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
        <select className="input" value={where} onChange={(e) => setWhere(e.target.value as typeof where)} aria-label="Written in">
          <option value="">Entries and profiles</option>
          <option value="entry">Only entries</option>
          <option value="entity">Only profile notes</option>
        </select>
      </div>
      <div className="search-results">
        {hits === null && <p className="muted">Searching…</p>}
        {hits && !hits.length && <p className="muted">{q || entityId || type ? 'No blocks match.' : 'Type to search everything you have written.'}</p>}
        {hits && hits.length > 0 && <p className="muted small">{hits.length === 200 ? '200+ blocks' : `${hits.length} block${hits.length === 1 ? '' : 's'}`}</p>}
        {hits?.map((h) => (
          <article key={h.block.id} className="block-card search-hit">
            <div className="block-body" onClick={() => app.openTab({ kind: h.block.source.kind, id: h.block.source.id, focusBlock: h.block.id })}>
              <BlockText text={h.block.text} />
            </div>
            <footer className="block-foot">
              <span className="src-link">{h.block.source.title}</span>
              <span className="also">
                {h.block.filedTo.map((o) => (
                  <span key={o.id} className="also-dot" style={{ background: o.color }} title={o.name} />
                ))}
              </span>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
