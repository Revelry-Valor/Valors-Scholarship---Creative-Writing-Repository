// A small context menu, opened at the mouse or under a button. Arrow keys + Enter.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type MenuSpec = { x: number; y: number; items: Array<MenuItem | 'sep'> } | null;

export function ContextMenu({ spec, onClose }: { spec: MenuSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const items = (spec?.items ?? []).filter((i): i is MenuItem => i !== 'sep');
  useEffect(() => {
    if (!spec) return;
    setSel(0);
    ref.current?.focus();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [spec, onClose]);
  if (!spec) return null;
  const x = Math.min(spec.x, window.innerWidth - 240);
  const y = Math.min(spec.y, window.innerHeight - 30 * spec.items.length - 16);
  let idx = -1;
  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: x, top: y }}
      tabIndex={-1}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowDown') setSel((s) => (s + 1) % items.length);
        if (e.key === 'ArrowUp') setSel((s) => (s - 1 + items.length) % items.length);
        if (e.key === 'Enter') {
          const it = items[sel];
          if (it && !it.disabled) {
            onClose();
            it.run();
          }
        }
        e.preventDefault();
      }}
    >
      {spec.items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" />;
        idx++;
        const my = idx;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            className={`menu-item ${it.danger ? 'danger' : ''} ${my === sel ? 'selected' : ''}`}
            onMouseEnter={() => setSel(my)}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
