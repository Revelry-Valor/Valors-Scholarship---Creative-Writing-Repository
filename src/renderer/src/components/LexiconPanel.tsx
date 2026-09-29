// Right-bar lexicon: look up Greek, Hebrew (or any imported) words while writing.
// Select a word anywhere (your page, the Library reader) and it is looked up here.
import { useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { insertText } from '../editor/Editor';
import { resetLexiconCache } from '../editor/lexicon';
import { lexicalWords } from '../../../core/lexicon';

type Hit = ApiResult<'lexiconLookup'>[number];
type Lex = ApiResult<'listLexicons'>[number];
type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

const LANG: Record<string, string> = { greek: 'Greek', hebrew: 'Hebrew', latin: 'Latin', other: 'Other' };

export async function importLexicons(app: App, dialogs: Dialogs) {
  await dialogs.show((close) => <LexiconImport onDone={() => close(null)} />);
  resetLexiconCache();
  void app;
}

function LexiconImport({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = async () => {
    setError(null);
    const jobs: Array<File | null> = files.length ? files : paste.trim() ? [null] : [];
    if (!jobs.length) return setError('Choose a file or paste some entries.');
    const done: string[] = [];
    try {
      for (let i = 0; i < jobs.length; i++) {
        const f = jobs[i];
        const n = jobs.length === 1 && name.trim() ? name.trim() : f ? f.name.replace(/\.(txt|tsv|csv|json|js)$/i, '') : 'Lexicon';
        setBusy(`Reading ${i + 1} of ${jobs.length}: ${n}…`);
        const r = await api.importLexicon({ name: n, text: f ? await f.text() : paste });
        done.push(`${r.name}: ${r.count.toLocaleString()} ${LANG[r.language]} entries`);
      }
      app.notify(`Imported ${done.join('; ')}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="import-dialog">
      <h2 className="modal-title">Add a lexicon</h2>
      <p className="muted small">
        Greek and Hebrew lexicons, Strong’s dictionaries, glossaries or any word list. Tables (TSV or CSV) with a headword column and a definition column, STEPBible TBESG/TBESH files, JSON dictionaries, or lines like <code>λόγος — word</code>. Large files are fine.
      </p>
      <div className="drop-zone" onClick={() => input.current?.click()} role="button" tabIndex={0} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), setFiles([...e.dataTransfer.files]))}>
        {files.length ? files.map((f) => `${f.name} (${(f.size / 1e6).toFixed(1)} MB)`).join(', ') : 'Drop lexicon files here, or click to choose'}
        <input ref={input} type="file" hidden multiple accept=".txt,.tsv,.csv,.json,.js" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </div>
      {!files.length && <textarea className="input" rows={4} placeholder={'…or paste entries\nλόγος (logos) — word, speech\nG26\tἀγάπη\tagapē\tlove'} value={paste} onChange={(e) => setPaste(e.target.value)} />}
      {files.length <= 1 && (
        <label className="modal-label">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Strong’s Greek, BDAG notes, Hebrew glossary" />
        </label>
      )}
      {busy && <p className="import-progress">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onDone} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={run} disabled={!!busy}>
          Import
        </button>
      </div>
    </div>
  );
}

function Entry({ h, open }: { h: Hit; open?: boolean }) {
  const app = useApp();
  const [more, setMore] = useState(!!open);
  const insert = () => {
    const bits = [h.translit, h.gloss ? `“${h.gloss}”` : ''].filter(Boolean).join(', ');
    if (insertText(`${h.lemma}${bits ? ` (${bits})` : ''}`)) app.notify('Added to your page');
    else app.notify('Click into your page first', 'error');
  };
  const text = h.def ?? '';
  return (
    <div className="lex-entry">
      <div className="lex-entry-head">
        <span className="lex-lemma">{h.lemma}</span>
        {h.translit && <span className="lex-translit">{h.translit}</span>}
        {h.strong && <span className="lex-strong">{h.strong}</span>}
        <span className="spacer" />
        <button className="foot-btn" onClick={insert} title="Insert the word with its transliteration and gloss">
          + Insert
        </button>
      </div>
      {h.morph && <div className="lex-meta">{h.morph}</div>}
      {h.gloss && <div className="lex-gloss">{h.gloss}</div>}
      {text && (
        <div className={`lex-def ${more ? 'open' : ''}`} onClick={() => setMore(true)}>
          {more || text.length < 240 ? text : `${text.slice(0, 236)}…`}
        </div>
      )}
      <div className="lex-src">{h.lexiconName}</div>
    </div>
  );
}

export function LexiconPanel() {
  const app = useApp();
  const dialogs = useDialogs();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [lexicons, setLexicons] = useState<Lex[] | null>(null);
  const [inPara, setInPara] = useState<Array<{ word: string; hit: Hit | null }>>([]);
  const reload = () => api.listLexicons().then(setLexicons);
  useEffect(() => {
    void reload();
  }, [app.version]);

  // Search as you type.
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    const tm = setTimeout(() => api.lexiconLookup(q, { limit: 30 }).then(setHits), 200);
    return () => clearTimeout(tm);
  }, [q]);

  // Select a Greek or Hebrew word anywhere to look it up.
  useEffect(() => {
    const onSel = () => {
      const s = document.getSelection()?.toString().trim() ?? '';
      if (s && s.length < 60 && lexicalWords(s).length) setQ(lexicalWords(s)[0].word);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // Words in the paragraph at the cursor.
  const para = app.currentBlock?.text ?? '';
  useEffect(() => {
    const words = [...new Set(lexicalWords(para).map((w) => w.word))].slice(0, 30);
    if (!words.length || !lexicons?.length) return setInPara([]);
    api.lexiconWords(words).then((r) => setInPara(words.map((w) => ({ word: w, hit: r[w] }))));
  }, [para, lexicons?.length]);

  return (
    <div className="panel-body lex-panel">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="λόγος, logos, G3056, or an English word" aria-label="Look up a word" />
      {hits && !hits.length && <p className="muted small">Not in your lexicons.</p>}
      {hits?.map((h, i) => (
        <Entry key={`${h.lexicon}-${h.lemma}-${h.strong}-${i}`} h={h} open={i === 0 && hits.length === 1} />
      ))}
      {!hits && inPara.length > 0 && (
        <>
          <h3>In this paragraph</h3>
          <ul className="lex-para">
            {inPara.map(({ word, hit }) => (
              <li key={word}>
                <button className="linkish" onClick={() => setQ(word)}>
                  {word}
                </button>{' '}
                <span className="muted small">{hit ? `${hit.lemma !== word ? `${hit.lemma}: ` : ''}${hit.gloss ?? (hit.def ?? '').slice(0, 60)}` : 'not found'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!hits && !inPara.length && (
        <p className="muted small">Type a word, or select a Greek or Hebrew word in your page or in the Library. In the editor, hover over one to see its gloss.</p>
      )}
      <h3>Your lexicons</h3>
      {lexicons && !lexicons.length && <p className="muted small">None yet. Import Strong’s, a Greek or Hebrew lexicon, or your own glossary.</p>}
      <ul className="lex-list">
        {lexicons?.map((l) => (
          <li key={l.id}>
            <span>{l.name}</span>
            <span className="muted small">
              {LANG[l.language]} · {l.count.toLocaleString()}
            </span>
            <button
              className="icon-btn"
              title="Remove this lexicon"
              onClick={async () => {
                const ok = await dialogs.choose({ title: `Remove “${l.name}”?`, message: <p>The file moves to the project's .trash folder.</p>, choices: [{ label: 'Remove', value: true, kind: 'danger' }, { label: 'Cancel', value: false, kind: 'primary' }] });
                if (!ok) return;
                await api.deleteLexicon(l.id);
                resetLexiconCache();
                void reload();
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button className="btn small" onClick={() => importLexicons(app, dialogs).then(reload)}>
        + Import a lexicon
      </button>
    </div>
  );
}
