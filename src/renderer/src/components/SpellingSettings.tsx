// Spelling & autocorrect settings: toggles and your own replacement list.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { setSpellingPrefs } from '../editor/spelling';
import { BUILT_IN, type AutocorrectPrefs } from '../../../core/autocorrect';

type Prefs = { spellcheck: boolean; autocorrect: AutocorrectPrefs };

export function SpellingSettings({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  const [rows, setRows] = useState<Array<[string, string]>>([]);
  useEffect(() => {
    api.getPrefs().then((x) => {
      setP(x);
      setRows(Object.entries(x.autocorrect.custom));
    });
  }, []);
  if (!p) return <p className="muted">Loading…</p>;
  const ac = p.autocorrect;
  const set = (patch: Partial<AutocorrectPrefs>) => setP({ ...p, autocorrect: { ...ac, ...patch } });

  const save = async () => {
    const custom = Object.fromEntries(rows.filter(([a, b]) => a.trim() && b.trim()).map(([a, b]) => [a.trim(), b.trim()]));
    const next = { ...p, autocorrect: { ...ac, custom } };
    await api.setPrefs(next);
    setSpellingPrefs(next);
    onClose();
  };

  return (
    <div className="spelling-settings">
      <h2 className="modal-title">Spelling &amp; autocorrect</h2>
      <label className="check-row">
        <input type="checkbox" checked={p.spellcheck} onChange={(e) => setP({ ...p, spellcheck: e.target.checked })} />
        <span>
          Check spelling as I type
          <small>Misspelled words get a red underline; right-click for suggestions or “Add to dictionary”. Names of your people, places and topics are never flagged.</small>
        </span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={ac.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          Correct common mistakes as I type
          <small>{Object.keys(BUILT_IN).length} built-in fixes such as teh → the, diciple → disciple, Septuigint → Septuagint. Press Ctrl+Z straight after a fix to undo it.</small>
        </span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={ac.capitalizeSentences} disabled={!ac.enabled} onChange={(e) => set({ capitalizeSentences: e.target.checked })} />
        <span>Capitalise the first letter of sentences</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={ac.fixTwoCapitals} disabled={!ac.enabled} onChange={(e) => set({ fixTwoCapitals: e.target.checked })} />
        <span>Correct TWo INitial CApitals</span>
      </label>

      <h3 className="te-head">My replacements</h3>
      <p className="muted small">Type the short form and it becomes the long one when you finish the word, e.g. “jc” → “Jesus Christ”, “ecf” → “Early Church Fathers”.</p>
      <ul className="te-list">
        {rows.map(([from, to], i) => (
          <li key={i}>
            <input className="input" value={from} placeholder="Type" aria-label="Replace" onChange={(e) => setRows(rows.map((r, k) => (k === i ? [e.target.value, r[1]] : r)))} />
            <span className="muted">→</span>
            <input className="input" value={to} placeholder="With" aria-label="With" onChange={(e) => setRows(rows.map((r, k) => (k === i ? [r[0], e.target.value] : r)))} />
            <button className="icon-btn" title="Remove" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <button className="btn small" onClick={() => setRows([...rows, ['', '']])}>
        + Add replacement
      </button>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
