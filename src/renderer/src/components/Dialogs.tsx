// Keyboard-first modal dialogs: prompt, confirm with several choices, pick from a list.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface Choice<T> {
  label: string;
  value: T;
  kind?: 'primary' | 'danger' | 'plain';
  hint?: string;
}

interface DialogSpec {
  id: number;
  render: (close: (v: unknown) => void) => ReactNode;
  resolve: (v: unknown) => void;
}

interface DialogApi {
  prompt(opts: { title: string; label?: string; initial?: string; placeholder?: string; okLabel?: string; multiline?: boolean }): Promise<string | null>;
  choose<T>(opts: { title: string; message?: ReactNode; choices: Choice<T>[] }): Promise<T | null>;
  pick<T>(opts: { title: string; items: Array<{ label: string; detail?: string; value: T; color?: string }>; placeholder?: string }): Promise<T | null>;
  show<T>(render: (close: (v: T | null) => void) => ReactNode): Promise<T | null>;
}

const Ctx = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDialogs outside provider');
  return c;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DialogSpec[]>([]);
  const seq = useRef(0);

  const show = useCallback(<T,>(render: (close: (v: T | null) => void) => ReactNode) => {
    return new Promise<T | null>((resolve) => {
      const id = ++seq.current;
      setStack((s) => [...s, { id, render: render as DialogSpec['render'], resolve: resolve as (v: unknown) => void }]);
    });
  }, []);

  const close = useCallback((id: number, v: unknown) => {
    setStack((s) => {
      const d = s.find((x) => x.id === id);
      d?.resolve(v);
      return s.filter((x) => x.id !== id);
    });
  }, []);

  // Escape always closes the top dialog, wherever focus is.
  useEffect(() => {
    if (!stack.length) return;
    const top = stack[stack.length - 1].id;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(top, null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stack, close]);

  const api: DialogApi = {
    show,
    prompt: (opts) => show<string>((done) => <PromptDialog {...opts} done={done} />),
    choose: (opts) => show((done) => <ChooseDialog {...opts} done={done} />),
    pick: (opts) => show((done) => <PickDialog {...opts} done={done} />),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {stack.map((d) => (
        <div
          key={d.id}
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(d.id, null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            ref={(el) => {
              if (el && !el.contains(document.activeElement)) setTimeout(() => !el.contains(document.activeElement) && el.focus(), 0);
            }}
          >
            {d.render((v) => close(d.id, v))}
          </div>
        </div>
      ))}
    </Ctx.Provider>
  );
}

function PromptDialog(props: { title: string; label?: string; initial?: string; placeholder?: string; okLabel?: string; multiline?: boolean; done: (v: string | null) => void }) {
  const [value, setValue] = useState(props.initial ?? '');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = () => props.done(value.trim() ? value : null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="modal-title">{props.title}</h2>
      {props.label && <label className="modal-label">{props.label}</label>}
      {props.multiline ? (
        <textarea
          ref={ref}
          className="input"
          rows={4}
          value={value}
          placeholder={props.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          }}
        />
      ) : (
        <input ref={ref} className="input" value={value} placeholder={props.placeholder} onChange={(e) => setValue(e.target.value)} />
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => props.done(null)}>
          Cancel <kbd>Esc</kbd>
        </button>
        <button type="submit" className="btn btn-primary">
          {props.okLabel ?? 'OK'} <kbd>{props.multiline ? 'Ctrl+↵' : '↵'}</kbd>
        </button>
      </div>
    </form>
  );
}

function ChooseDialog<T>(props: { title: string; message?: ReactNode; choices: Choice<T>[]; done: (v: T | null) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  // Enter should never default to a destructive choice.
  const primary = props.choices.findIndex((c) => c.kind === 'primary');
  const safeIndex = primary >= 0 ? primary : Math.max(0, props.choices.findIndex((c) => c.kind !== 'danger'));
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      onKeyDown={(e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= props.choices.length) props.done(props.choices[n - 1].value);
      }}
    >
      <h2 className="modal-title">{props.title}</h2>
      {props.message && <div className="modal-message">{props.message}</div>}
      <div className="modal-choices">
        {props.choices.map((c, i) => (
          <button key={i} ref={i === safeIndex ? first : undefined} className={`btn btn-choice ${c.kind === 'danger' ? 'btn-danger' : c.kind === 'primary' ? 'btn-primary' : ''}`} onClick={() => props.done(c.value)}>
            <kbd>{i + 1}</kbd>
            <span>
              {c.label}
              {c.hint && <small>{c.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickDialog<T>(props: { title: string; items: Array<{ label: string; detail?: string; value: T; color?: string }>; placeholder?: string; done: (v: T | null) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = props.items.filter((i) => !q || `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="picker">
      <h2 className="modal-title">{props.title}</h2>
      <input
        autoFocus
        className="input"
        value={q}
        placeholder={props.placeholder ?? 'Type to filter'}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setSel((s) => Math.min(s + 1, items.length - 1));
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setSel((s) => Math.max(s - 1, 0));
            e.preventDefault();
          } else if (e.key === 'Enter' && items[sel]) props.done(items[sel].value);
        }}
      />
      <ul className="picker-list">
        {items.map((it, i) => (
          <li key={i} className={i === sel ? 'selected' : ''} onMouseEnter={() => setSel(i)} onMouseDown={() => props.done(it.value)}>
            {it.color && <span className="dot" style={{ background: it.color }} />}
            <span className="picker-label">{it.label}</span>
            {it.detail && <span className="picker-detail">{it.detail}</span>}
          </li>
        ))}
        {!items.length && <li className="empty">Nothing matches</li>}
      </ul>
    </div>
  );
}
