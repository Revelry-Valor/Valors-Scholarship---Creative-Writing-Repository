// Project picker (spec 20: "A project picker on the start screen switches between them").
import { useEffect, useState } from 'react';
import { api, type ApiResult } from '../api';

type AppStateResult = ApiResult<'appState'>;

export function StartScreen({ onOpened }: { onOpened: () => void }) {
  const [st, setSt] = useState<AppStateResult | null>(null);
  const [name, setName] = useState('');
  const [pack, setPack] = useState<'scholarship' | 'fantasy' | 'blank'>('scholarship');
  const [parent, setParent] = useState('');
  const [openPath, setOpenPath] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.appState().then((s) => {
      setSt(s);
      setParent(s.defaultParent);
      setAuthor(s.author);
    });
  }, []);

  if (!st) return <div className="boot">Loading…</div>;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      if (author.trim() && author !== st.author) await api.setAuthor(author);
      await fn();
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const browse = async (set: (p: string) => void) => {
    const p = await api.pickFolder();
    if (p) set(p);
  };

  return (
    <div className="start">
      <div className="start-inner">
        <header className="start-header">
          <div className="start-logo">❦</div>
          <div>
            <h1>Living Repository</h1>
            <p className="muted">Write once. Every person, place, topic and verse you mention keeps its own page up to date.</p>
          </div>
        </header>

        <div className="start-grid">
          <section className="start-col">
            <h2>Open a project</h2>
            {st.recent.length === 0 && <p className="muted">No recent projects yet.</p>}
            <ul className="recent-list">
              {st.recent.map((r) => (
                <li key={r.path}>
                  <button className="recent" disabled={busy} onClick={() => run(() => api.openVault(r.path))}>
                    <span className="vault-mark">{r.name.slice(0, 1).toUpperCase()}</span>
                    <span className="recent-text">
                      <strong>{r.name}</strong>
                      <small>{r.path}</small>
                    </span>
                  </button>
                  <button className="icon-btn" title="Remove from list" onClick={async () => {
                    await api.forgetRecent(r.path);
                    setSt(await api.appState());
                  }}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="open-other">
              <label className="modal-label">Open an existing vault folder</label>
              <div className="row">
                <input className="input" placeholder={'C:\\Users\\you\\Documents\\Living Repository\\Scholarship'} value={openPath} onChange={(e) => setOpenPath(e.target.value)} />
                {st.canPickFolder && (
                  <button className="btn" onClick={() => browse(setOpenPath)}>
                    Browse…
                  </button>
                )}
                <button className="btn" disabled={!openPath.trim() || busy} onClick={() => run(() => api.openVault(openPath.trim()))}>
                  Open
                </button>
              </div>
            </div>
          </section>

          <section className="start-col">
            <h2>New project</h2>
            <p className="muted small">Each project is its own vault — one for scholarship, one per fantasy world. Nothing links across them.</p>
            <label className="modal-label">Name</label>
            <input className="input" value={name} placeholder="e.g. Scholarship, or The Old Empire" onChange={(e) => setName(e.target.value)} />
            <label className="modal-label">Start from</label>
            <div className="packs">
              {st.packs.map((p) => (
                <button key={p.id} className={`pack ${pack === p.id ? 'selected' : ''}`} onClick={() => setPack(p.id as typeof pack)} aria-pressed={pack === p.id}>
                  <strong>{p.name}</strong>
                  <span>{p.description}</span>
                  <small>{p.types.join(' · ')}</small>
                </button>
              ))}
            </div>
            <label className="modal-label">Location</label>
            <div className="row">
              <input className="input" value={parent} onChange={(e) => setParent(e.target.value)} />
              {st.canPickFolder && (
                <button className="btn" onClick={() => browse(setParent)}>
                  Browse…
                </button>
              )}
            </div>
            <p className="muted small">
              Creates <code>{`${parent}${parent.includes('\\') ? '\\' : '/'}${name || 'Name'}`}</code> with plain Markdown files you own.
            </p>
            <label className="modal-label">Your name</label>
            <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Signs every block you write" />
            <button className="btn btn-primary btn-wide" disabled={!name.trim() || !parent.trim() || busy} onClick={() => run(() => api.createVault({ parent: parent.trim(), name: name.trim(), pack }))}>
              Create project
            </button>
          </section>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
