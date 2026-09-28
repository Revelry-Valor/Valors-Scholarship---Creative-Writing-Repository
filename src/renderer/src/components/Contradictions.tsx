// Contradiction finder: places where two things in the project cannot both be true.
// It works offline from your facts, dates, links and wording, and never changes anything.
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { BlockText } from './BlockText';
import { CONTRADICTION_KINDS, type ContradictionKind } from '../../../core/contradictions';
import type { DocKind } from '../../../core/types';

type Item = ApiResult<'contradictions'>[number];
type Side = Item['a'];

function SideView({ s, label }: { s: Side; label: string }) {
  const app = useApp();
  return (
    <div className="con-side">
      <div className="con-side-label">{label}</div>
      {s.blockId ? (
        <>
          <div className="con-text" onDoubleClick={() => app.openTab({ kind: s.source!.kind as DocKind, id: s.source!.id, focusBlock: s.blockId })}>
            <BlockText text={s.text} highlights={s.spans} />
          </div>
          <button className="linkish small" onClick={() => app.openTab({ kind: s.source!.kind as DocKind, id: s.source!.id, focusBlock: s.blockId })}>
            {s.source?.title}
          </button>
        </>
      ) : (
        <p className="con-text muted">{s.text}</p>
      )}
    </div>
  );
}

export function ContradictionsPage() {
  const app = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<ContradictionKind | ''>('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.contradictions().then((r) => {
      setItems(r);
      setHidden(new Set());
    });
  }, [app.version]);

  const list = items?.filter((c) => !hidden.has(c.id) && (!kind || c.kind === kind)) ?? [];
  const count = (k: ContradictionKind) => items?.filter((c) => c.kind === k && !hidden.has(c.id)).length ?? 0;

  const dismiss = async (c: Item) => {
    await api.dismissSuggestion(c.id, 'once');
    setHidden((h) => new Set(h).add(c.id));
  };
  const markCheck = async (c: Item) => {
    for (const s of [c.a, c.b]) {
      if (!s.blockId) continue;
      const b = await api.getBlock(s.blockId);
      if (b.marks.includes('check')) continue;
      if (b.source.kind === 'library') await api.annotateLibraryBlock(s.blockId, { mark: 'check' });
      else await api.updateBlock(s.blockId, `${b.text.trimEnd()} !check`);
    }
    app.notify('Both paragraphs marked ⚑ to check (see Key details)');
  };

  return (
    <div className="claims-page conflicts-page">
      <header className="review-head">
        <h1>Contradictions</h1>
        <p className="muted small">
          Read from your facts, dates, links and wording, entirely on this computer. Each one shows both paragraphs. If both are true (a source reporting someone else’s view, or something that changed over time), dismiss it with “Not a contradiction”.
        </p>
        <div className="sg-filters">
          <button className={`filter-chip ${kind ? '' : 'on'}`} onClick={() => setKind('')}>
            All {items?.filter((c) => !hidden.has(c.id)).length ?? ''}
          </button>
          {CONTRADICTION_KINDS.map((k) => (
            <button key={k.id} className={`filter-chip ${kind === k.id ? 'on' : ''} ${count(k.id) ? '' : 'empty'}`} title={k.hint} onClick={() => setKind(kind === k.id ? '' : k.id)}>
              {k.label} {count(k.id)}
            </button>
          ))}
        </div>
      </header>
      {items === null && <p className="muted review-empty">Reading the project…</p>}
      {items && !list.length && <p className="view-empty">No contradictions found{kind ? ' of this kind' : ''}. Facts, dates and links all agree.</p>}
      {list.map((c) => (
        <article key={c.id} className={`claim-card con-card con-${c.kind}`}>
          <header className="claim-head">
            <span className="claim-status">{CONTRADICTION_KINDS.find((k) => k.id === c.kind)?.label}</span>
            <span className="spacer" />
            {c.entityIds.slice(0, 3).map((id) => {
              const e = app.entityById.get(id);
              return e ? (
                <button key={id} className="linkish small" onClick={() => app.openTab({ kind: 'entity', id })}>
                  <span className="dot" style={{ background: e.color }} /> {e.name}
                </button>
              ) : null;
            })}
          </header>
          <h2 className="con-title">{c.title}</h2>
          <p className="muted small con-detail">{c.detail}</p>
          <div className="claim-cols">
            <SideView s={c.a} label="One place says" />
            <SideView s={c.b} label="Another says" />
          </div>
          <footer className="sg-actions">
            {(c.a.blockId || c.b.blockId) && (
              <button className="btn small" onClick={() => markCheck(c)}>
                ⚑ Mark to check
              </button>
            )}
            <span className="spacer" />
            <button className="btn small btn-ghost" onClick={() => dismiss(c)}>
              Not a contradiction
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
