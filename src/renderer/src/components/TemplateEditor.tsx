// Edit a type's template: its facts (fields) and the sections every page of that type starts with.
// Saved to templates/<type>.yaml; existing pages gain new fields blank (spec 5).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import type { FieldDef, FieldKind, TemplateDef } from '../../../core/types';
import { normalizeFieldKey } from '../../../core/markup';

const KINDS: Array<{ id: string; label: string; kind: FieldKind; of?: FieldDef['of'] }> = [
  { id: 'text', label: 'Text', kind: 'text' },
  { id: 'date', label: 'Date', kind: 'date' },
  { id: 'number', label: 'Number', kind: 'number' },
  { id: 'bool', label: 'Yes / no', kind: 'bool' },
  { id: 'entity', label: 'One person / place / thing', kind: 'entity' },
  { id: 'list-entity', label: 'List of people / things', kind: 'list', of: 'entity' },
  { id: 'list-text', label: 'List of words', kind: 'list', of: 'text' },
];

const kindId = (f: FieldDef) => (f.kind === 'list' ? `list-${f.of ?? 'text'}` : f.kind);

export function TemplateEditor({ typeId, onClose }: { typeId: string; onClose: () => void }) {
  const app = useApp();
  const [def, setDef] = useState<TemplateDef | null>(null);
  const [origKeys, setOrigKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inherited = app.templates.get(typeId);

  useEffect(() => {
    api
      .getTemplate(typeId)
      .then((d) => {
        setDef(d);
        setOrigKeys(new Set(d.fields.map((f) => f.key)));
      })
      .catch((e) => setError((e as Error).message));
  }, [typeId]);

  if (error) return <p className="error">{error}</p>;
  if (!def) return <p className="muted">Loading…</p>;

  // Fields from a parent type (Church Father inherits Person) are shown but edited on the parent.
  const ownKeys = new Set(def.fields.map((f) => f.key));
  const parentFields = (inherited?.fields ?? []).filter((f) => !ownKeys.has(f.key));

  const setField = (i: number, patch: Partial<FieldDef>) => setDef({ ...def, fields: def.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  const setSection = (i: number, value: string) => setDef({ ...def, sections: def.sections.map((x, k) => (k === i ? value : x)) });
  const moveSection = (i: number, d: number) => {
    const list = [...def.sections];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setDef({ ...def, sections: list });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const fields = def.fields.map((f) => ({ ...f, key: f.key || normalizeFieldKey(f.label) }));
      await api.saveTemplate({ ...def, fields });
      await app.refreshNames();
      app.notify(`${def.name} template saved`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="template-editor">
      <h2 className="modal-title">{def.name} template</h2>
      <p className="muted small">Changes apply to every {def.name} page. New facts start blank; new sections appear as headings on pages you create from now on (add them to existing pages by typing the heading).</p>

      <label className="modal-label" htmlFor="tpl-name">
        Name
      </label>
      <input id="tpl-name" className="input" value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} />

      <h3 className="te-head">Sections</h3>
      <ul className="te-list">
        {def.sections.map((sec, i) => (
          <li key={i}>
            <input className="input" value={sec} aria-label={`Section ${i + 1}`} onChange={(e) => setSection(i, e.target.value)} />
            <button className="icon-btn" title="Move up" onClick={() => moveSection(i, -1)}>
              ↑
            </button>
            <button className="icon-btn" title="Move down" onClick={() => moveSection(i, 1)}>
              ↓
            </button>
            <button className="icon-btn" title="Remove" onClick={() => setDef({ ...def, sections: def.sections.filter((_, k) => k !== i) })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <button className="btn small" onClick={() => setDef({ ...def, sections: [...def.sections, ''] })}>
        + Add section
      </button>

      <h3 className="te-head">Facts</h3>
      {parentFields.length > 0 && <p className="muted small">Also has {parentFields.map((f) => f.label).join(', ')} from its parent type.</p>}
      <ul className="te-list">
        {def.fields.map((f, i) => (
          <li key={i}>
            <input className="input" value={f.label} placeholder="Label, e.g. Birthplace" aria-label={`Fact ${i + 1} label`} onChange={(e) => setField(i, { label: e.target.value, key: origKeys.has(f.key) ? f.key : normalizeFieldKey(e.target.value) })} />
            <select
              className="input te-kind"
              value={kindId(f)}
              aria-label={`Fact ${i + 1} kind`}
              onChange={(e) => {
                const k = KINDS.find((x) => x.id === e.target.value)!;
                setField(i, { kind: k.kind, of: k.of });
              }}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <button className="icon-btn" title="Remove" onClick={() => setDef({ ...def, fields: def.fields.filter((_, k) => k !== i) })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <button className="btn small" onClick={() => setDef({ ...def, fields: [...def.fields, { key: '', label: '', kind: 'text' }] })}>
        + Add fact
      </button>

      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          Save template
        </button>
      </div>
    </div>
  );
}
