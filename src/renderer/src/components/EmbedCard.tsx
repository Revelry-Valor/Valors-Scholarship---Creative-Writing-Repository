// A live quotation (![[Page]], ![[Document]], ![[#b-id]]) in reading views: it always shows
// the current text, because the quoted paragraph or page is stored once, where it was written.
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { plainText } from '../../../core/markup';
import type { DocKind } from '../../../core/types';

type Preview = ApiResult<'embedPreview'>;

export function EmbedCard({ target }: { target: string }) {
  const app = useApp();
  const [pv, setPv] = useState<Preview | null>(null);
  useEffect(() => {
    let live = true;
    api
      .embedPreview(target)
      .then((p) => live && setPv(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [target, app.version]);
  if (!pv) return <span className="embed-card">Loading quotation…</span>;
  if (pv.kind === 'missing') return <span className="embed-card missing">Nothing to quote: “{pv.title}”</span>;
  if (pv.kind === 'block')
    return (
      <span className="embed-card block">
        <span className="embed-text">{plainText(pv.text, app.names)}</span>
        <button className="linkish small embed-src" onClick={() => app.openTab({ kind: pv.source.kind as DocKind as 'entry', id: pv.source.id, focusBlock: pv.id })}>
          — {pv.source.title}
        </button>
      </span>
    );
  if (pv.kind === 'entity')
    return (
      <span className="embed-card entity" style={{ ['--chip' as string]: pv.color }}>
        <button className="embed-title" onClick={() => app.openTab({ kind: 'entity', id: pv.id })}>
          {pv.title}
        </button>
        <span className="embed-type">{pv.typeName}</span>
        {pv.summary && <span className="embed-text">{pv.summary}</span>}
        {pv.facts.length > 0 && (
          <span className="embed-facts">
            {pv.facts.map((f) => (
              <span key={f.label} className="embed-fact">
                <span className="k">{f.label}</span>
                <span className="v">{f.value}</span>
              </span>
            ))}
          </span>
        )}
        {pv.key.map((k, i) => (
          <span key={i} className="embed-key">
            ★ {k}
          </span>
        ))}
      </span>
    );
  return (
    <span className="embed-card document">
      <button className="embed-title" onClick={() => app.openTab({ kind: 'entry', id: pv.id })}>
        📄 {pv.title}
      </button>
      {pv.text && <span className="embed-text">{pv.text}</span>}
    </span>
  );
}
