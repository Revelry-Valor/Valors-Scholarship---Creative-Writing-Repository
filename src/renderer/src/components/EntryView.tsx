// An entry: free writing. Title, status and word count above the editor.
import { useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { Editor, type EditorHandle } from '../editor/Editor';
import { useDialogs } from './Dialogs';
import { BlockText } from './BlockText';
import type { EntryStatus } from '../../../core/types';
import { countWords, plainText } from '../../../core/markup';
import { splitBlocks } from '../../../core/document';
import type { DocFormat } from '../../../core/types';
import type { EditorView } from '@codemirror/view';
import { FormatBar, formatStyle, loadDefaultFormat } from './FormatBar';

type Entry = ApiResult<'getEntry'>;

export const STATUSES: Array<{ id: EntryStatus; label: string }> = [
  { id: 'idea', label: 'Idea' },
  { id: 'draft', label: 'Draft' },
  { id: 'revised', label: 'Revised' },
  { id: 'final', label: 'Final' },
];

export function EntryView({ id, focusBlock, onHandle }: { id: string; focusBlock?: string; onHandle?: (h: EditorHandle | null) => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [external, setExternal] = useState<{ body: string; version: number } | undefined>();
  const [title, setTitle] = useState('');
  const [words, setWords] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<EditorHandle | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [tick, setTick] = useState(0);
  const tickFrame = useRef(0);
  const [format, setFormat] = useState<Required<DocFormat>>(loadDefaultFormat);

  useEffect(() => {
    let live = true;
    api
      .getEntry(id)
      .then((e) => {
        if (!live) return;
        setEntry(e);
        setTitle(e.title);
        setWords(e.words);
        setFormat({ ...loadDefaultFormat(), ...(e.format ?? {}) });
      })
      .catch((err) => setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [id]);

  // Someone else changed this file (profile edit, Notepad, rename): refresh.
  useEffect(() => {
    const ev = app.lastEvent;
    if (!entry || !ev || ev.type !== 'changed') return;
    api
      .getEntry(id)
      .then((e) => {
        if (e.title !== entry.title) setTitle(e.title);
        setEntry((cur) => (cur ? { ...cur, title: e.title, status: e.status, file: e.file } : cur));
        setExternal({ body: e.body, version: app.version });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.version]);

  if (error) return <div className="empty-state">This entry could not be opened: {error}</div>;
  if (!entry) return <div className="loading">Loading…</div>;

  const saveTitle = async () => {
    if (title.trim() === entry.title || !title.trim()) {
      setTitle(entry.title);
      return;
    }
    const e = await api.updateEntry(id, { title: title.trim() });
    setEntry((cur) => (cur ? { ...cur, title: e.title, file: e.file } : cur));
  };

  const changeFormat = (patch: Partial<DocFormat>) => {
    const next = { ...format, ...patch };
    setFormat(next);
    void api.updateEntry(id, { format: next });
  };

  return (
    <div className={`entry-view para-${format.paragraphs} align-${format.align}`} style={formatStyle(format)}>
      <FormatBar view={view} tick={tick} format={format} onFormat={changeFormat} focusMode={app.focusMode} onFocusMode={() => app.setFocusMode(!app.focusMode)} />
      <div className="doc-column page">
        <header className="entry-header">
          <input
            className="entry-title"
            value={title}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handle.current?.view.focus();
              }
            }}
          />
          <div className="entry-meta">
            <select
              className={`status-select status-${entry.status}`}
              value={entry.status}
              aria-label="Status"
              onChange={async (e) => {
                const st = e.target.value as EntryStatus;
                setEntry({ ...entry, status: st });
                await api.updateEntry(id, { status: st });
              }}
            >
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="meta-dot">·</span>
            <span>{words.toLocaleString()} words</span>
            {entry.created && (
              <>
                <span className="meta-dot">·</span>
                <span>started {entry.created}</span>
              </>
            )}
            <span className="meta-hint">
              Type <kbd>@</kbd> to link or create · <kbd>F1</kbd> markup
            </span>
          </div>
        </header>
        <Editor
          key={id}
          mode="document"
          initial={entry.body}
          external={external}
          focusBlock={focusBlock}
          autoFocus={!focusBlock && !entry.body.trim()}
          placeholder="Start writing. Type @ to tag a person, place or topic…"
          onUpdate={() => {
            cancelAnimationFrame(tickFrame.current);
            tickFrame.current = requestAnimationFrame(() => setTick((n) => n + 1));
          }}
          onReady={(h) => {
            handle.current = h;
            setView(h.view);
            onHandle?.(h);
          }}
          onSave={async (body) => {
            const res = await api.saveEntry(id, body);
            setWords(splitBlocks(res.body).reduce((n, b) => n + countWords(plainText(b.text, app.names)), 0));
            if (res.created.length) {
              await app.refreshNames();
              app.notify(`Created ${res.created.map((c) => `${c.name} (${c.typeName})`).join(', ')}`);
            }
            return res;
          }}
          confirmRemoval={async (removed) => {
            const total = removed.reduce((n, r) => n + r.pages, 0);
            const preview = removed[0].text.length > 240 ? `${removed[0].text.slice(0, 238)}…` : removed[0].text;
            const choice = await dialogs.choose<'delete' | 'move' | 'restore'>({
              title: removed.length === 1 ? `This block appears on ${removed[0].pages} pages` : `${removed.length} blocks you removed appear on ${total} pages`,
              message: (
                <>
                  <div className="quote-preview">
                    <BlockText text={preview} onOpenEntity={() => undefined} />
                  </div>
                  <p>Deleting it here removes it from every profile it is filed to.</p>
                </>
              ),
              choices: [
                { label: 'Delete everywhere', value: 'delete', kind: 'danger' },
                { label: "I'm moving it", value: 'move', hint: 'Paste it into another entry; it keeps its links' },
                { label: 'Restore it', value: 'restore', kind: 'primary' },
              ],
            });
            return choice ?? 'restore';
          }}
        />
      </div>
    </div>
  );
}
