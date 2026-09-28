// The Library (spec 12.1): imported Bibles, Church Fathers' works, books and articles.
// Sources are read-only; you file their paragraphs to your pages and mark what matters.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from './Dialogs';
import { BlockText } from './BlockText';

type Lib = ApiResult<'listLibrary'>;
type Doc = ApiResult<'getLibraryDoc'>;
type App = ReturnType<typeof useApp>;
type Dialogs = ReturnType<typeof useDialogs>;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const titleFromFile = (name: string) => name.replace(/\.(txt|md|markdown|docx|csv|tsv|json|html?)$/i, '').replace(/[_]+/g, ' ').trim();

/** The import dialog: files (several at once) or pasted text. */
export async function importToLibrary(app: App, dialogs: Dialogs, files?: File[]) {
  await dialogs.show((close) => <ImportDialog initialFiles={files} onDone={() => close(null)} />);
  await app.refreshNames();
}

function ImportDialog({ initialFiles, onDone }: { initialFiles?: File[]; onDone: () => void }) {
  const app = useApp();
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [paste, setPaste] = useState('');
  const [title, setTitle] = useState(initialFiles?.length === 1 ? titleFromFile(initialFiles[0].name) : '');
  const [kind, setKind] = useState<'auto' | 'bible' | 'text'>('auto');
  const [author, setAuthor] = useState('');
  const [translation, setTranslation] = useState('');
  const [makePage, setMakePage] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const authors = useMemo(() => app.nameData.entities.filter((e) => /person|father|character/.test(e.type)).map((e) => e.name), [app.nameData]);

  const run = async () => {
    setError(null);
    const jobs = files.length ? files : paste.trim() ? [null] : [];
    if (!jobs.length) {
      setError('Choose a file or paste some text.');
      return;
    }
    const done: string[] = [];
    try {
      for (let i = 0; i < jobs.length; i++) {
        const f = jobs[i];
        const t = jobs.length === 1 && title.trim() ? title.trim() : f ? titleFromFile(f.name) : 'Pasted text';
        setProgress(`Importing ${i + 1} of ${jobs.length}: ${t}…`);
        const isDocx = !!f && /\.docx$/i.test(f.name);
        const r = await api.importLibrary({
          title: t,
          filename: f?.name,
          text: f ? (isDocx ? undefined : await f.text()) : paste,
          dataBase64: isDocx ? toBase64(await f!.arrayBuffer()) : undefined,
          kind,
          author: author.trim() || undefined,
          translation: translation.trim() || undefined,
          makePage,
        });
        done.push(r.kind === 'bible' ? `${t}: ${r.paragraphs.toLocaleString()} verses in ${r.ids.length} books` : `${t}: ${r.paragraphs.toLocaleString()} paragraphs`);
      }
      app.notify(`Imported ${done.join('; ')}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="import-dialog">
      <h2 className="modal-title">Add to the Library</h2>
      <p className="muted small">Bibles in any translation, Church Fathers’ works, books, articles, sermons. Plain text, Markdown, Word (.docx), and Bibles as CSV, TSV or JSON. Imported texts are read-only; you file their paragraphs to your pages.</p>
      <div
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          const list = [...e.dataTransfer.files];
          setFiles(list);
          if (list.length === 1) setTitle(titleFromFile(list[0].name));
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
      >
        {files.length ? (
          <span>
            {files.length === 1 ? files[0].name : `${files.length} files: ${files.map((f) => f.name).slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}`}
          </span>
        ) : (
          <span>Drop files here, or click to choose (you can pick several)</span>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".txt,.md,.markdown,.docx,.csv,.tsv,.json,.html,.htm"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            setFiles(list);
            if (list.length === 1) setTitle(titleFromFile(list[0].name));
          }}
        />
      </div>
      {!files.length && (
        <>
          <label className="modal-label" htmlFor="imp-paste">
            …or paste text
          </label>
          <textarea id="imp-paste" className="input" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a chapter, an article, or a whole book" />
        </>
      )}
      <div className="import-grid">
        {files.length <= 1 && (
          <label>
            Title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Against Heresies" />
          </label>
        )}
        <label>
          What is it?
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="auto">Work it out for me</option>
            <option value="bible">A Bible translation</option>
            <option value="text">A book, work or article</option>
          </select>
        </label>
        {kind !== 'text' && (
          <label>
            Translation (for Bibles)
            <input className="input" value={translation} onChange={(e) => setTranslation(e.target.value)} placeholder="KJV, WEB, Douay-Rheims…" />
          </label>
        )}
        {kind !== 'bible' && (
          <label>
            Author
            <input className="input" value={author} list="imp-authors" onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Irenaeus" />
            <datalist id="imp-authors">
              {authors.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
        )}
      </div>
      {kind !== 'bible' && (
        <label className="check-row">
          <input type="checkbox" checked={makePage} onChange={(e) => setMakePage(e.target.checked)} />
          <span>
            Make a page for each work
            <small>A Work page (with its author) that your notes can be filed to.</small>
          </span>
        </label>
      )}
      {progress && <p className="import-progress">{progress}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onDone} disabled={!!progress}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={run} disabled={!!progress}>
          Import
        </button>
      </div>
    </div>
  );
}

/** Sidebar section. */
export function LibrarySection() {
  const app = useApp();
  const dialogs = useDialogs();
  const [items, setItems] = useState<Lib>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false);
  useEffect(() => {
    api.listLibrary().then(setItems);
  }, [app.version]);
  const groups = useMemo(() => {
    const m = new Map<string, Lib>();
    for (const it of items) {
      const k = it.collection || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }, [items]);
  const active = app.tabs.find((t) => t.key === app.active);
  const row = (it: Lib[number], depth: number) => (
    <li key={it.id}>
      <div
        className={`tree-row ${active?.kind === 'library' && active.id === it.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        tabIndex={0}
        onClick={() => app.openTab({ kind: 'library', id: it.id })}
        onKeyDown={(e) => e.key === 'Enter' && app.openTab({ kind: 'library', id: it.id })}
      >
        <span className="twisty none" />
        <span className="node-icon lib-icon">{it.kind === 'bible' ? '✝' : '❡'}</span>
        <span className="node-name">{it.collection ? it.title.replace(/\s*\([^)]*\)$/, '') : it.title}</span>
      </div>
    </li>
  );
  return (
    <div
      className={`side-section library-section ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void importToLibrary(app, dialogs, [...e.dataTransfer.files]);
      }}
    >
      <div className="side-head">
        <span>Library</span>
        <button className="icon-btn" title="Import texts: Bibles, works, articles (or drop files here)" onClick={() => importToLibrary(app, dialogs)}>
          +
        </button>
      </div>
      <ul className="tree">
        {[...groups.entries()].map(([collection, list]) =>
          collection ? (
            <li key={`c:${collection}`}>
              <div
                className="tree-row folder"
                style={{ paddingLeft: 8 }}
                tabIndex={0}
                onClick={() => setOpen((s) => new Set(s.has(collection) ? [...s].filter((x) => x !== collection) : [...s, collection]))}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  const ok = await dialogs.choose({ title: `Remove “${collection}” from the Library?`, message: <p>{list.length} books move to the vault's .trash folder. Paragraphs you filed from it will disappear from your pages.</p>, choices: [{ label: 'Remove', value: true, kind: 'danger' }, { label: 'Cancel', value: false, kind: 'primary' }] });
                  if (ok) await api.deleteLibrary({ collection });
                }}
              >
                <span className="twisty">{open.has(collection) ? '▾' : '▸'}</span>
                <span className="node-icon lib-icon">✝</span>
                <span className="node-name">{collection}</span>
                <span className="node-words">{list.length}</span>
              </div>
              {open.has(collection) && <ul>{list.map((it) => row(it, 1))}</ul>}
            </li>
          ) : (
            list.map((it) => row(it, 0))
          ),
        )}
        {!items.length && (
          <li className="tree-empty">
            <button className="btn btn-ghost small" onClick={() => importToLibrary(app, dialogs)}>
              + Import a Bible or a work
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** A source open in a tab: read-only, one paragraph (or verse) at a time you can file or mark. */
export function LibraryReader({ id, focusBlock }: { id: string; focusBlock?: string }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getLibraryDoc(id)
      .then(setDoc)
      .catch((e) => setError((e as Error).message));
  }, [id, app.version]);
  useEffect(() => {
    if (!focusBlock || !doc) return;
    const el = document.querySelector(`[data-block="${focusBlock}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('flash');
  }, [focusBlock, doc]);
  if (error) return <div className="empty-state">{error}</div>;
  if (!doc) return <div className="loading">Loading…</div>;

  const chapters = doc.blocks.filter((b) => b.kind === 'heading');
  const fileTo = async (blockId: string) => {
    const entityId = await dialogs.pick({
      title: 'File this paragraph to…',
      items: [...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color })),
    });
    if (!entityId) return;
    const tpl = app.templates.get(app.entityById.get(entityId)?.type ?? '');
    const section = tpl?.sections.length
      ? await dialogs.pick({ title: 'Which section?', items: [{ label: 'No particular section', value: '' }, ...tpl.sections.map((s) => ({ label: s, value: s }))] })
      : '';
    await api.annotateLibraryBlock(blockId, { entityId, section: section || undefined });
    app.notify(`Filed to ${app.entityById.get(entityId)?.name}`);
  };

  return (
    <div className="entry-view library-reader" style={{ ['--doc-font' as string]: "'Literata', Georgia, serif" }}>
      <div className="formatbar reader-bar">
        <span className="reader-kind">{doc.kind === 'bible' ? `✝ ${doc.translation ?? 'Bible'}` : '❡ Source'}</span>
        {chapters.length > 1 && (
          <select
            className="fb-select"
            aria-label="Go to chapter"
            onChange={(e) => document.querySelector(`[data-block="${e.target.value}"]`)?.scrollIntoView({ block: 'start' })}
          >
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.text.replace(/^#+\s*/, '')}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <span className="muted small">Read-only · hover a paragraph to file it to a page or mark it</span>
        {doc.page && (
          <button className="fb-btn fb-link" onClick={() => app.openTab({ kind: 'entity', id: doc.page! })}>
            Open its page
          </button>
        )}
      </div>
      <div className="doc-column page">
        <header className="entry-header">
          <h1 className="entry-title reader-title">{doc.title}</h1>
          <div className="entry-meta">
            {doc.author && <span>{doc.author}</span>}
            {doc.date && <span>· {doc.date}</span>}
            <span>· {doc.blocks.filter((b) => b.kind !== 'heading').length.toLocaleString()} {doc.kind === 'bible' ? 'verses' : 'paragraphs'}</span>
          </div>
        </header>
        <div className={`reader-body ${doc.kind === 'bible' ? 'bible' : ''}`}>
          {doc.blocks.map((b) => {
            if (b.kind === 'heading') {
              return (
                <h2 key={b.id} data-block={b.id} className="reader-heading">
                  {b.text.replace(/^#+\s*/, '')}
                </h2>
              );
            }
            const verse = /^\[([^\]]+)\]\s*/.exec(b.text);
            const text = verse ? b.text.slice(verse[0].length) : b.text;
            return (
              <div key={b.id} data-block={b.id} className={`reader-para ${b.filedTo.length ? 'filed' : ''} ${b.marked ? 'marked' : ''}`}>
                {verse && <sup className="verse-num">{verse[1].split(':')[1]}</sup>}
                <BlockText text={text} />
                <div className="reader-actions">
                  <button className="foot-btn" onClick={() => fileTo(b.id)} title="File this paragraph to a person, work or topic">
                    File to…
                  </button>
                  <button className="foot-btn" onClick={() => api.annotateLibraryBlock(b.id, { mark: 'key' })} title="Mark important">
                    ★
                  </button>
                  <button className="foot-btn" onClick={() => api.annotateLibraryBlock(b.id, { mark: 'check' })} title="Mark to check">
                    ⚑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
