// The word-processor toolbar above a document: paragraph style, font, size,
// inline styles, lists, page layout, and buttons that insert linking markup.
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { activeInline, currentParagraphStyle, insertMarkup, setParagraphStyle, toggleInline, type InlineStyle, type ParagraphStyle } from '../editor/format';
import type { DocFormat } from '../../../core/types';

export const FONTS: Array<{ id: string; label: string; css: string }> = [
  { id: 'literata', label: 'Literata', css: "'Literata', Georgia, serif" },
  { id: 'garamond', label: 'EB Garamond', css: "'EB Garamond', Garamond, Georgia, serif" },
  { id: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { id: 'palatino', label: 'Palatino', css: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { id: 'sans', label: 'Source Sans', css: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif" },
  { id: 'typewriter', label: 'Courier Prime', css: "'Courier Prime', 'Courier New', monospace" },
];

export const DEFAULT_FORMAT: Required<DocFormat> = { font: 'literata', size: 18, lineHeight: 1.7, paragraphs: 'spaced', align: 'left', width: 'normal' };

export function loadDefaultFormat(): Required<DocFormat> {
  try {
    return { ...DEFAULT_FORMAT, ...JSON.parse(localStorage.getItem('lr.defaultFormat') ?? '{}') };
  } catch {
    return DEFAULT_FORMAT;
  }
}

export function formatStyle(f: Required<DocFormat>): React.CSSProperties {
  return {
    ['--doc-font' as string]: FONTS.find((x) => x.id === f.font)?.css ?? FONTS[0].css,
    ['--doc-size' as string]: `${f.size}px`,
    ['--doc-lh' as string]: String(f.lineHeight),
    ['--page-width' as string]: f.width === 'narrow' ? '640px' : f.width === 'wide' ? '980px' : '800px',
  };
}

const STYLES: Array<{ id: ParagraphStyle; label: string; key: string }> = [
  { id: 'normal', label: 'Normal text', key: 'Ctrl+Alt+0' },
  { id: 'h1', label: 'Title', key: 'Ctrl+Alt+1' },
  { id: 'h2', label: 'Heading', key: 'Ctrl+Alt+2' },
  { id: 'h3', label: 'Subheading', key: 'Ctrl+Alt+3' },
  { id: 'quote', label: 'Quote', key: 'Ctrl+Shift+9' },
  { id: 'bullet', label: 'Bulleted list', key: 'Ctrl+Shift+8' },
  { id: 'number', label: 'Numbered list', key: 'Ctrl+Shift+7' },
];

const INLINE: Array<{ id: InlineStyle; label: string; title: string; cls: string }> = [
  { id: 'bold', label: 'B', title: 'Bold (Ctrl+B)', cls: 'fmt-b' },
  { id: 'italic', label: 'I', title: 'Italic (Ctrl+I)', cls: 'fmt-i' },
  { id: 'underline', label: 'U', title: 'Underline (Ctrl+U)', cls: 'fmt-u' },
  { id: 'strike', label: 'S', title: 'Strikethrough (Ctrl+Shift+X)', cls: 'fmt-s' },
  { id: 'highlight', label: 'H', title: 'Highlight (Ctrl+Shift+H)', cls: 'fmt-h' },
];

export function FormatBar({
  view,
  tick,
  format,
  onFormat,
  focusMode,
  onFocusMode,
}: {
  view: EditorView | null;
  tick: number;
  format: Required<DocFormat>;
  onFormat: (patch: Partial<DocFormat>) => void;
  focusMode: boolean;
  onFocusMode: () => void;
}) {
  const [pageOpen, setPageOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pageOpen) return;
    const close = (e: MouseEvent) => {
      if (!pageRef.current?.contains(e.target as Node)) setPageOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [pageOpen]);

  void tick;
  const para = view ? currentParagraphStyle(view.state) : 'normal';
  const active = view ? activeInline(view.state) : new Set<InlineStyle>();
  const run = (fn: (v: EditorView) => void) => () => {
    if (view) fn(view);
  };
  // Keep the editor's selection when a toolbar button is clicked.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="formatbar" role="toolbar" aria-label="Formatting">
      <select className="fb-select fb-style" value={para} aria-label="Paragraph style" onChange={(e) => view && setParagraphStyle(view, e.target.value as ParagraphStyle)}>
        {STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select className="fb-select fb-font" value={format.font} aria-label="Font" onChange={(e) => onFormat({ font: e.target.value })} style={{ fontFamily: FONTS.find((f) => f.id === format.font)?.css }}>
        {FONTS.map((f) => (
          <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="fb-size" aria-label="Text size">
        <button onMouseDown={keep} onClick={() => onFormat({ size: Math.max(12, format.size - 1) })} title="Smaller text">
          −
        </button>
        <span>{format.size}</span>
        <button onMouseDown={keep} onClick={() => onFormat({ size: Math.min(30, format.size + 1) })} title="Larger text">
          +
        </button>
      </div>
      <span className="fb-sep" />
      {INLINE.map((b) => (
        <button key={b.id} className={`fb-btn ${b.cls} ${active.has(b.id) ? 'on' : ''}`} title={b.title} aria-pressed={active.has(b.id)} onMouseDown={keep} onClick={run((v) => toggleInline(v, b.id))}>
          {b.label}
        </button>
      ))}
      <span className="fb-sep" />
      <button className={`fb-btn ${para === 'bullet' ? 'on' : ''}`} title="Bulleted list (Ctrl+Shift+8)" onMouseDown={keep} onClick={run((v) => setParagraphStyle(v, 'bullet'))}>
        •≡
      </button>
      <button className={`fb-btn ${para === 'number' ? 'on' : ''}`} title="Numbered list (Ctrl+Shift+7)" onMouseDown={keep} onClick={run((v) => setParagraphStyle(v, 'number'))}>
        1≡
      </button>
      <button className={`fb-btn ${para === 'quote' ? 'on' : ''}`} title="Quote (Ctrl+Shift+9)" onMouseDown={keep} onClick={run((v) => setParagraphStyle(v, 'quote'))}>
        ❝
      </button>
      <div className="fb-page" ref={pageRef}>
        <button className={`fb-btn fb-wide ${pageOpen ? 'on' : ''}`} title="Page layout: spacing, paragraphs, alignment, width" onMouseDown={keep} onClick={() => setPageOpen((x) => !x)}>
          Page ▾
        </button>
        {pageOpen && (
          <div className="fb-popover">
            <label>
              Line spacing
              <select value={format.lineHeight} onChange={(e) => onFormat({ lineHeight: Number(e.target.value) })}>
                <option value={1.3}>Single</option>
                <option value={1.5}>1.15</option>
                <option value={1.7}>1.5</option>
                <option value={2}>Double</option>
              </select>
            </label>
            <label>
              Paragraphs
              <select value={format.paragraphs} onChange={(e) => onFormat({ paragraphs: e.target.value as DocFormat['paragraphs'] })}>
                <option value="spaced">Space between</option>
                <option value="indented">Indent first line (book)</option>
              </select>
            </label>
            <label>
              Alignment
              <select value={format.align} onChange={(e) => onFormat({ align: e.target.value as DocFormat['align'] })}>
                <option value="left">Left</option>
                <option value="justify">Justified</option>
              </select>
            </label>
            <label>
              Page width
              <select value={format.width} onChange={(e) => onFormat({ width: e.target.value as DocFormat['width'] })}>
                <option value="narrow">Narrow</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </select>
            </label>
            <button
              className="btn small"
              onClick={() => {
                try {
                  localStorage.setItem('lr.defaultFormat', JSON.stringify(format));
                } catch {
                  // ignore
                }
                setPageOpen(false);
              }}
            >
              Use these settings for new documents
            </button>
          </div>
        )}
      </div>
      <span className="fb-sep" />
      <button className="fb-btn fb-link" title="Tag a person, place or work (@)" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'tag'))}>
        @ Tag
      </button>
      <button className="fb-btn fb-link" title="Create a new entity and tag it (@@)" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'create'))}>
        + New
      </button>
      <button className="fb-btn fb-link" title="Tag a topic (#)" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'topic'))}>
        # Topic
      </button>
      <button className="fb-btn fb-link" title="Add a fact to the last tagged entity ({field: value})" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'fact'))}>
        {'{ }'} Fact
      </button>
      <button className="fb-btn fb-link" title="Record a relationship: @A >relation> @B" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'relation'))}>
        → Relation
      </button>
      <button className="fb-btn fb-link" title="Make this line a heading that files everything below it to the entity it names (## Name @)" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'owner'))}>
        ¶ Section
      </button>
      <button className="fb-btn fb-link" title="Private note, never shown on profiles (%% note %%)" onMouseDown={keep} onClick={run((v) => insertMarkup(v, 'note'))}>
        %% Note
      </button>
      <span className="spacer" />
      <button className="fb-btn" title="Undo (Ctrl+Z)" onMouseDown={keep} onClick={run((v) => undo(v))}>
        ↶
      </button>
      <button className="fb-btn" title="Redo (Ctrl+Y)" onMouseDown={keep} onClick={run((v) => redo(v))}>
        ↷
      </button>
      <button className={`fb-btn fb-wide ${focusMode ? 'on' : ''}`} title="Focus mode: hide the panels (Ctrl+Shift+Enter)" onMouseDown={keep} onClick={onFocusMode}>
        Focus
      </button>
    </div>
  );
}
