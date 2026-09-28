// Ctrl+O quick switcher (spec 12) and Ctrl+K command palette in one box.
// Type to jump to any entry or entity by name or alias; start with ">" for commands.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

type Result = ApiResult<'quickSwitch'>[number];

export function Palette({ mode, commands, onClose }: { mode: 'switch' | 'command'; commands: Command[]; onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState(mode === 'command' ? '>' : '');
  const [results, setResults] = useState<Result[]>([]);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const isCmd = q.startsWith('>');

  useEffect(() => {
    if (isCmd) return;
    let live = true;
    api.quickSwitch(q).then((r) => live && setResults(r));
    return () => {
      live = false;
    };
  }, [q, isCmd]);

  const cmds = useMemo(() => {
    const s = q.slice(1).trim().toLowerCase();
    return commands.filter((c) => !s || c.label.toLowerCase().includes(s));
  }, [q, commands]);

  const count = isCmd ? cmds.length : results.length + (q.trim() ? 2 : 0);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    (listRef.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const choose = (i: number) => {
    onClose();
    if (isCmd) {
      cmds[i]?.run();
      return;
    }
    if (i < results.length) {
      const r = results[i];
      app.openTab({ kind: r.kind, id: r.id });
    } else if (i === results.length) {
      app.openTab({ kind: 'search', query: q.trim() });
    } else {
      window.dispatchEvent(new CustomEvent('lr:command', { detail: { id: 'new-entity', name: q.trim() } }));
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={isCmd ? 'Commands' : 'Go to'}>
        <input
          autoFocus
          className="palette-input"
          value={q}
          placeholder="Jump to an entry or entity…   (type > for commands)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, count - 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
            else if (e.key === 'Enter') choose(sel);
            else return;
            e.preventDefault();
          }}
        />
        <ul className="palette-list" ref={listRef}>
          {isCmd
            ? cmds.map((c, i) => (
                <li key={c.id} className={i === sel ? 'selected' : ''} onMouseEnter={() => setSel(i)} onMouseDown={() => choose(i)}>
                  <span className="picker-label">{c.label}</span>
                  {c.hint && <kbd>{c.hint}</kbd>}
                </li>
              ))
            : [
                ...results.map((r, i) => (
                  <li key={`${r.kind}${r.id}`} className={i === sel ? 'selected' : ''} onMouseEnter={() => setSel(i)} onMouseDown={() => choose(i)}>
                    <span className={`dot ${r.kind === 'entry' ? 'dot-entry' : ''}`} style={r.color ? { background: r.color } : undefined} />
                    <span className="picker-label">{r.title}</span>
                    {r.matched && <span className="picker-alias">“{r.matched}”</span>}
                    <span className="picker-detail">{r.detail}</span>
                  </li>
                )),
                ...(q.trim()
                  ? [
                      <li key="search" className={sel === results.length ? 'selected' : ''} onMouseEnter={() => setSel(results.length)} onMouseDown={() => choose(results.length)}>
                        <span className="picker-label">Search all writing for “{q.trim()}”</span>
                        <kbd>Ctrl+Shift+F</kbd>
                      </li>,
                      <li key="create" className={sel === results.length + 1 ? 'selected' : ''} onMouseEnter={() => setSel(results.length + 1)} onMouseDown={() => choose(results.length + 1)}>
                        <span className="picker-label">Create entity “{q.trim()}”…</span>
                      </li>,
                    ]
                  : []),
              ]}
          {!isCmd && !q && !results.length && <li className="empty">Your vault is empty. Create an entry with Ctrl+N.</li>}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑↓</kbd> move <kbd>↵</kbd> open <kbd>Esc</kbd> close
          </span>
          <span>
            <kbd>&gt;</kbd> commands
          </span>
        </div>
      </div>
    </div>
  );
}
