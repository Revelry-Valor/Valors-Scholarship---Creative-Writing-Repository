// Claims & evidence: every paragraph marked !claim, with the paragraphs you have
// weighed for and against it. Evidence can come from your writing or the Library.
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { BlockText } from './BlockText';
import type { ClaimStatus, EvidenceStance } from '../../../core/compare';
import type { DocKind } from '../../../core/types';

type Claim = ApiResult<'listClaims'>[number];
type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

const STATUS: Record<ClaimStatus, { label: string; hint: string }> = {
  unsupported: { label: 'No evidence yet', hint: 'Nothing attached for or against' },
  supported: { label: 'Supported', hint: 'Evidence for, none against' },
  contested: { label: 'Contested', hint: 'Evidence on both sides' },
  challenged: { label: 'Challenged', hint: 'Evidence against, none for' },
};
const STANCE_LABEL: Record<EvidenceStance, string> = { for: 'Supports', against: 'Against', context: 'Context' };

/** Attach a paragraph to a claim: choose the claim, then how it bears on it. */
export async function addAsEvidence(app: App, dialogs: Dialogs, blockId: string) {
  const claims = await api.listClaims();
  const pick = await dialogs.pick<string>({
    title: 'Evidence for which claim?',
    placeholder: claims.length ? 'Your claims' : 'No claims yet',
    items: [...claims.filter((c) => c.id !== blockId).map((c) => ({ label: c.text.replace(/\s*!claim\b/, '').slice(0, 140), detail: c.source.title, value: c.id })), { label: '⚖ Make this paragraph a claim instead', value: '__claim' }],
  });
  if (!pick) return;
  if (pick === '__claim') {
    await api.toggleClaim(blockId);
    app.notify('Marked as a claim');
    return;
  }
  const stance = await dialogs.pick<EvidenceStance>({ title: 'This paragraph…', items: [{ label: '✓ Supports the claim', value: 'for' }, { label: '✗ Speaks against it', value: 'against' }, { label: '· Is background or context', value: 'context' }] });
  if (!stance) return;
  await api.addEvidence(pick, blockId, stance);
  app.notify(`Added as ${STANCE_LABEL[stance].toLowerCase()} evidence`);
}

function EvidencePicker({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ApiResult<'lookup'>['hits']>([]);
  const [note, setNote] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set(claim.evidence.map((e) => e.id)));
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const tm = setTimeout(() => api.lookup({ text: q, scope: { all: true }, limit: 60 }).then((r) => setHits(r.hits.filter((h) => h.blockId !== claim.id))), 250);
    return () => clearTimeout(tm);
  }, [q, claim.id]);
  const add = async (id: string, stance: EvidenceStance) => {
    await api.addEvidence(claim.id, id, stance, note.trim() || undefined);
    setAdded((s) => new Set(s).add(id));
    setNote('');
  };
  return (
    <div className="evidence-picker">
      <h2 className="modal-title">Add evidence</h2>
      <div className="quote-preview">
        <BlockText text={claim.text} />
      </div>
      <input className="input" autoFocus placeholder='Find paragraphs: words, "phrases", verses…' value={q} onChange={(e) => setQ(e.target.value)} />
      <input className="input small" placeholder="Note for the next one you add (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="evidence-hits">
        {hits.map((h) => (
          <div key={h.blockId} className={`evidence-hit ${added.has(h.blockId) ? 'added' : ''}`}>
            <div className="evidence-src">
              {h.source.author ? `${h.source.author}, ` : ''}
              {h.source.title}
            </div>
            <BlockText text={h.text} highlights={h.spans} />
            <div className="evidence-actions">
              {added.has(h.blockId) ? (
                <span className="muted small">Added</span>
              ) : (
                <>
                  <button className="btn small st-accepted" onClick={() => add(h.blockId, 'for')}>
                    ✓ Supports
                  </button>
                  <button className="btn small st-rejected" onClick={() => add(h.blockId, 'against')}>
                    ✗ Against
                  </button>
                  <button className="btn small" onClick={() => add(h.blockId, 'context')}>
                    Context
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {q && !hits.length && <p className="muted small">No paragraphs match.</p>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export function ClaimsPage() {
  const app = useApp();
  const dialogs = useDialogs();
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [status, setStatus] = useState<ClaimStatus | ''>('');
  const reload = () => api.listClaims().then(setClaims);
  useEffect(() => {
    void reload();
  }, [app.version]);
  const open = (x: { id: string; source: { kind: DocKind; id: string } }) => app.openTab({ kind: x.source.kind, id: x.source.id, focusBlock: x.id });
  const shown = claims?.filter((c) => !status || c.status === status) ?? [];

  return (
    <div className="claims-page">
      <header className="review-head">
        <h1>Claims &amp; evidence</h1>
        <p className="muted small">
          Mark a thesis or a statement you want to test with <kbd>⚖</kbd> in the toolbar (<code>!claim</code>). Then attach paragraphs from your writing or the Library that support it or speak against it. From the Research pane, use ⚖ on any result.
        </p>
        <div className="sg-filters">
          <button className={`filter-chip ${status ? '' : 'on'}`} onClick={() => setStatus('')}>
            All {claims?.length ?? ''}
          </button>
          {(Object.keys(STATUS) as ClaimStatus[]).map((s) => (
            <button key={s} className={`filter-chip claim-${s} ${status === s ? 'on' : ''}`} title={STATUS[s].hint} onClick={() => setStatus(s)}>
              {STATUS[s].label} {claims?.filter((c) => c.status === s).length ?? ''}
            </button>
          ))}
        </div>
      </header>
      {claims && !claims.length && <p className="view-empty">No claims yet. Put the cursor in a paragraph and press ⚖ in the toolbar.</p>}
      {shown.map((c) => {
        const by = (s: EvidenceStance) => c.evidence.filter((e) => e.stance === s);
        return (
          <article key={c.id} className={`claim-card claim-${c.status}`}>
            <header className="claim-head">
              <span className={`claim-status claim-${c.status}`}>{STATUS[c.status].label}</span>
              <button className="linkish small" onClick={() => open(c)}>
                {c.source.title}
              </button>
              <span className="spacer" />
              <button className="btn small" onClick={async () => (await dialogs.show((close) => <EvidencePicker claim={c} onDone={() => close(null)} />), reload())}>
                + Evidence
              </button>
            </header>
            <div className="claim-text">
              <BlockText text={c.text} />
            </div>
            <div className="claim-cols">
              {(['for', 'against'] as EvidenceStance[]).map((s) => (
                <section key={s} className={`claim-col col-${s}`}>
                  <h3>
                    {s === 'for' ? '✓ Supports' : '✗ Against'} <span className="count">{by(s).length}</span>
                  </h3>
                  {by(s).map((e) => (
                    <div key={e.id} className={`evidence ${e.missing ? 'missing' : ''}`}>
                      <div className="evidence-text" onDoubleClick={() => !e.missing && open(e)}>
                        <BlockText text={e.text} />
                      </div>
                      {e.note && <p className="evidence-note">{e.note}</p>}
                      <div className="evidence-foot">
                        {!e.missing && (
                          <button className="linkish small" onClick={() => open(e)}>
                            {e.source.title}
                          </button>
                        )}
                        <span className="spacer" />
                        <button className="icon-btn" title="Remove from this claim" onClick={() => api.removeEvidence(c.id, e.id).then(reload)}>
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                  {!by(s).length && <p className="muted small">None yet.</p>}
                </section>
              ))}
            </div>
            {by('context').length > 0 && (
              <details className="claim-context">
                <summary className="small">Context ({by('context').length})</summary>
                {by('context').map((e) => (
                  <div key={e.id} className="evidence">
                    <BlockText text={e.text} />
                    <div className="evidence-foot">
                      <button className="linkish small" onClick={() => open(e)}>
                        {e.source.title}
                      </button>
                      <span className="spacer" />
                      <button className="icon-btn" title="Remove" onClick={() => api.removeEvidence(c.id, e.id).then(reload)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}
