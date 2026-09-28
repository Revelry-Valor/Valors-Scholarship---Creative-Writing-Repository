// A profile is a live view (spec 8): header, fact box, template sections filled
// with the blocks tagged into them, relationships, a timeline strip, mentions.
// Every block is stored once; editing it here edits it everywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { BlockText } from './BlockText';
import { Editor } from '../editor/Editor';
import { useDialogs } from './Dialogs';
import type { BlockView, FactView } from '../../../core/views';
import { formatSort } from '../../../core/dates';

type Profile = ApiResult<'profile'>;

const VIA_LABEL: Record<string, string> = {
  inline: 'tagged',
  section: 'under a heading',
  direct: 'written here',
  relation: 'relationship',
  link: 'linked',
};

export function ProfileView({ id, focusBlock }: { id: string; focusBlock?: string }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const load = () =>
    api
      .profile(id)
      .then((x) => {
        setP(x);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, app.version]);

  useEffect(() => {
    if (!focusBlock || !p) return;
    const el = document.querySelector(`[data-block="${focusBlock}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('flash');
    const tm = setTimeout(() => el?.classList.remove('flash'), 1600);
    return () => clearTimeout(tm);
  }, [focusBlock, p]);

  if (error) return <div className="empty-state">{error}</div>;
  if (!p) return <div className="loading">Loading…</div>;

  const e = p.entity;
  const rename = async () => {
    const name = await dialogs.prompt({ title: `Rename ${e.name}`, label: 'Every tag in every file will be updated, and the old name kept as an alias.', initial: e.name, okLabel: 'Rename' });
    if (!name || name === e.name) return;
    try {
      await api.renameEntity(id, name);
      await app.refreshNames();
      app.notify(`Renamed to ${name}; all tags updated`);
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  const changeType = async () => {
    const type = await dialogs.pick({
      title: 'Change type',
      items: app.nameData.templates.map((t) => ({ label: t.name, detail: t.id === e.type ? 'current' : `${t.fields.length} fields`, value: t.id, color: t.color })),
    });
    if (!type || type === e.type) return;
    await api.updateEntity(id, { type });
    await app.refreshNames();
  };

  const deleteEntity = async () => {
    const ok = await dialogs.choose({
      title: `Delete ${e.name}?`,
      message: <p>The profile file moves to the vault's .trash folder. Blocks you wrote stay in their entries; their tags to {e.name} will show as broken until you re-create or remove them.</p>,
      choices: [
        { label: 'Delete profile', value: true, kind: 'danger' },
        { label: 'Cancel', value: false, kind: 'primary' },
      ],
    });
    if (!ok) return;
    await api.deleteEntity(id);
    app.closeTab(`entity:${id}`);
    await app.refreshNames();
  };

  const filledFacts = p.facts.filter((f) => f.values.length).length;

  return (
    <div className="profile" style={{ ['--entity' as string]: e.color }}>
      <header className="profile-header">
        <div className="profile-kicker">
          <button className="type-pill" onClick={changeType} title="Change type">
            {e.typeName}
          </button>
          <span className="muted">
            {p.stats.blocks} block{p.stats.blocks === 1 ? '' : 's'} from {p.stats.sources} source{p.stats.sources === 1 ? '' : 's'}
          </span>
        </div>
        <h1 className="profile-name">
          {e.name}
          <button className="icon-btn" onClick={rename} title="Rename (updates every tag)">
            ✎
          </button>
        </h1>
        <Aliases id={id} aliases={e.aliases} />
        {p.pinned ? (
          <div className="profile-summary pinned">
            <BlockText text={p.pinned.text} />
            <SourceLink b={p.pinned} />
          </div>
        ) : (
          <Summary id={id} summary={e.summary} />
        )}
      </header>

      <div className="profile-body">
        <main className="profile-main">
          {p.sections.map((s) => (
            <Section key={s.name} entityId={id} name={s.name} blocks={s.blocks} />
          ))}
          <Section entityId={id} name="Mentions" blocks={p.mentions} hint="Tagged here without a section. Add ::Section to a tag, or put it under a matching heading, to file it." />
          {p.references.length > 0 && (
            <section className="section">
              <h2 className="section-title">
                Linked from <span className="count">{p.references.length}</span>
              </h2>
              <p className="section-hint">Passing references with [[ ]] — not filed to this profile.</p>
              {p.references.map((b) => (
                <BlockCard key={b.id} b={b} entityId={id} />
              ))}
            </section>
          )}
          <section className="section">
            <button className="btn btn-ghost" onClick={() => setShowNotes((x) => !x)}>
              {showNotes ? 'Hide' : 'Edit'} this profile's own file
            </button>
            {showNotes && <ProfileNotes id={id} />}
          </section>
        </main>

        <aside className="profile-aside">
          <div className="card facts">
            <div className="card-title">
              Facts
              <span className="muted">
                {filledFacts}/{p.facts.length}
              </span>
            </div>
            {p.facts.map((f) => (
              <FactRow key={f.key} entityId={id} fact={f} />
            ))}
            {!p.facts.length && <p className="muted small">This type has no fields. Add some to its template.</p>}
          </div>

          {p.timeline.length > 0 && <TimelineStrip items={p.timeline} />}

          <div className="card">
            <div className="card-title">Relationships</div>
            {p.relations.length === 0 && (
              <p className="muted small">
                None yet. Write <code>@{e.name.split(' ').pop()} &gt;relation&gt; @Someone</code> in any entry.
              </p>
            )}
            {p.relations.map((g) => (
              <div key={g.label} className={`rel-group rel-${g.category}`}>
                <div className="rel-label">{g.label}</div>
                {g.items.map((it, i) => (
                  <div key={i} className="rel-item" title={it.block.text}>
                    <button className="chip" style={{ ['--chip' as string]: it.other.color }} onClick={() => app.openTab({ kind: 'entity', id: it.other.id })}>
                      {it.other.name}
                    </button>
                    {it.topic && <span className="muted small"> on {it.topic.name}</span>}
                    <button className="src-link" onClick={() => openSource(app, it.block)}>
                      source
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="card danger-zone">
            <button className="btn btn-ghost small" onClick={deleteEntity}>
              Delete profile…
            </button>
            <span className="muted small">{e.file}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function openSource(app: ReturnType<typeof useApp>, b: BlockView) {
  app.openTab(b.source.kind === 'entry' ? { kind: 'entry', id: b.source.id, focusBlock: b.id } : { kind: 'entity', id: b.source.id, focusBlock: b.id });
}

function SourceLink({ b }: { b: BlockView }) {
  const app = useApp();
  return (
    <button className="src-link" onClick={() => openSource(app, b)} title="Open where this was written">
      from: {b.source.title}
    </button>
  );
}

function Aliases({ id, aliases }: { id: string; aliases: string[] }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState('');
  const save = async (list: string[]) => {
    await api.updateEntity(id, { aliases: list });
  };
  return (
    <div className="aliases">
      {aliases.length > 0 && <span className="muted small">also:</span>}
      {aliases.map((a) => (
        <span key={a} className="alias">
          {a}
          <button aria-label={`Remove alias ${a}`} onClick={() => save(aliases.filter((x) => x !== a))}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          className="alias-input"
          value={val}
          placeholder="Another name…"
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            setAdding(false);
            setVal('');
          }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && val.trim()) {
              await save([...aliases, val.trim()]);
              setVal('');
              setAdding(false);
            }
            if (e.key === 'Escape') setAdding(false);
          }}
        />
      ) : (
        <button className="add-alias" onClick={() => setAdding(true)}>
          + alias
        </button>
      )}
    </div>
  );
}

function Summary({ id, summary }: { id: string; summary: string }) {
  const [val, setVal] = useState(summary);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setVal(summary), [summary]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [val]);
  return (
    <textarea
      ref={ref}
      className="profile-summary"
      value={val}
      rows={1}
      placeholder="Write a summary, or end any block with ^pin to use it here."
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val !== summary) void api.updateEntity(id, { summary: val });
      }}
    />
  );
}

function FactRow({ entityId, fact }: { entityId: string; fact: FactView }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const profileValues = fact.values.filter((v) => v.source === 'profile');
  const [val, setVal] = useState('');
  const start = () => {
    setVal(profileValues.map((v) => (v.entity ? `@${v.entity.name}` : v.text)).join(fact.kind === 'list' ? ', ' : ''));
    setEditing(true);
  };
  const save = async () => {
    setEditing(false);
    const raw = val.trim();
    let value: unknown = raw;
    if (fact.kind === 'list') value = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (fact.kind === 'entity' && raw && !raw.startsWith('@')) value = `@${raw}`;
    await api.updateEntity(entityId, { fields: { [fact.key]: value || null } });
  };
  return (
    <div className={`fact ${fact.values.length ? '' : 'fact-empty'} ${fact.disputed ? 'fact-disputed' : ''}`}>
      <div className="fact-label">
        {fact.label}
        {fact.disputed && <span className="badge badge-warn">disputed</span>}
      </div>
      <div className="fact-values">
        {editing ? (
          <input
            autoFocus
            className="fact-input"
            value={val}
            placeholder={fact.kind === 'list' ? 'comma, separated' : fact.kind === 'date' ? 'e.g. c. 1280' : ''}
            onChange={(e) => setVal(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : fact.values.length ? (
          fact.values.map((v, i) => (
            <span key={i} className="fact-value">
              {v.entity ? (
                <button className="chip" style={{ ['--chip' as string]: v.entity.color }} onClick={() => app.openTab({ kind: 'entity', id: v.entity!.id })}>
                  {v.entity.name}
                </button>
              ) : (
                <span onClick={v.source === 'profile' ? start : undefined}>{v.text}</span>
              )}
              {v.source !== 'profile' && (
                <button
                  className="src-link"
                  title={`Set in “${v.sourceTitle}”`}
                  onClick={async () => {
                    const b = await api.getBlock(v.source);
                    app.openTab(b.source.kind === 'entry' ? { kind: 'entry', id: b.source.id, focusBlock: b.id } : { kind: 'entity', id: b.source.id, focusBlock: b.id });
                  }}
                >
                  ↗
                </button>
              )}
            </span>
          ))
        ) : (
          <button className="fact-blank" onClick={start}>
            —
          </button>
        )}
      </div>
    </div>
  );
}

function TimelineStrip({ items }: { items: Array<{ sort: number; label: string; text: string; blockId?: string }> }) {
  const min = items[0].sort;
  const max = items[items.length - 1].sort;
  const span = Math.max(1, max - min);
  return (
    <div className="card">
      <div className="card-title">
        Timeline
        <span className="muted">
          {formatSort(min)}
          {max !== min ? `–${formatSort(max)}` : ''}
        </span>
      </div>
      <div className="timeline-axis">
        {items.map((it, i) => (
          <span key={i} className="timeline-dot" style={{ left: `${items.length === 1 ? 50 : ((it.sort - min) / span) * 100}%` }} title={`${it.label}: ${it.text}`} />
        ))}
      </div>
      <ol className="timeline-list">
        {items.map((it, i) => (
          <li key={i}>
            <span className="tl-year">{formatSort(it.sort)}</span>
            <span className="tl-text">
              {it.label && <strong>{it.label} </strong>}
              {it.text !== it.label ? it.text : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({ entityId, name, blocks, hint }: { entityId: string; name: string; blocks: BlockView[]; hint?: string }) {
  const [adding, setAdding] = useState(false);
  const app = useApp();
  const isMentions = name === 'Mentions';
  if (isMentions && !blocks.length) return null;
  return (
    <section className={`section ${blocks.length ? '' : 'section-empty'}`}>
      <h2 className="section-title">
        {name} {blocks.length > 0 && <span className="count">{blocks.length}</span>}
        {!isMentions && (
          <button className="section-add" onClick={() => setAdding(true)} title={`Write a note in ${name}`}>
            + note
          </button>
        )}
      </h2>
      {hint && <p className="section-hint">{hint}</p>}
      {blocks.map((b) => (
        <BlockCard key={b.id} b={b} entityId={entityId} />
      ))}
      {adding && (
        <div className="block-card editing">
          <Editor
            mode="block"
            initial=""
            directOwner={entityId}
            autoFocus
            placeholder={`A note for ${name}… (Ctrl+Enter to save, Esc to cancel)`}
            onCancel={() => setAdding(false)}
            onSave={async (text) => {
              setAdding(false);
              if (text.trim()) {
                try {
                  const res = await api.addProfileNote(entityId, name, text);
                  if (res.created.length) await app.refreshNames();
                } catch (err) {
                  app.notify((err as Error).message, 'error');
                }
              }
            }}
          />
        </div>
      )}
    </section>
  );
}

export function BlockCard({ b, entityId }: { b: BlockView; entityId: string }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [editing, setEditing] = useState(false);
  const others = useMemo(() => b.filedTo.filter((f) => f.id !== entityId), [b.filedTo, entityId]);

  const removeHere = async () => {
    try {
      await api.removeTag(b.id, entityId);
      app.notify('Removed from this page only');
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  const del = async () => {
    const pages = await api.blockPages(b.id);
    const choice = await dialogs.choose<'all' | 'here' | null>({
      title: `This block appears on ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      message: (
        <ul className="page-list">
          {pages.map((pg) => (
            <li key={`${pg.kind}${pg.id}`}>{pg.title}</li>
          ))}
        </ul>
      ),
      choices: [
        { label: 'Delete everywhere', value: 'all', kind: 'danger' },
        ...(b.via !== 'direct' && b.via !== 'link' ? [{ label: 'Just remove it from this page', value: 'here' as const }] : []),
        { label: 'Cancel', value: null, kind: 'primary' },
      ],
    });
    if (choice === 'all') await api.deleteBlock(b.id);
    if (choice === 'here') await removeHere();
  };

  const history = async () => {
    const h = await api.blockHistory(b.id);
    if (!h) return;
    const idx = await dialogs.show<number>((close) => (
      <div className="history">
        <h2 className="modal-title">Edit history</h2>
        <p className="muted small">
          Written by {h.author} on {new Date(h.created).toLocaleString()}
        </p>
        <ol className="history-list">
          {[...h.history].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
            <li key={i}>
              <div className="history-meta">
                {new Date(v.at).toLocaleString()} · {v.by}
                {i === h.history.length - 1 ? (
                  <span className="badge">current</span>
                ) : (
                  <button className="btn small" onClick={() => close(i)}>
                    Restore
                  </button>
                )}
              </div>
              <BlockText text={v.text} />
            </li>
          ))}
        </ol>
        <div className="modal-actions">
          <button className="btn" onClick={() => close(null)}>
            Close
          </button>
        </div>
      </div>
    ));
    if (idx !== null) await api.restoreBlockVersion(b.id, idx);
  };

  return (
    <article className={`block-card ${editing ? 'editing' : ''}`} data-block={b.id}>
      {editing ? (
        <Editor
          mode="block"
          initial={b.text}
          autoFocus
          directOwner={b.source.kind === 'entity' ? b.source.id : undefined}
          onCancel={() => setEditing(false)}
          onSave={async (text) => {
            setEditing(false);
            if (text.trim() && text !== b.text) {
              try {
                await api.updateBlock(b.id, text);
              } catch (err) {
                app.notify((err as Error).message, 'error');
              }
            }
          }}
        />
      ) : (
        <div
          className="block-body"
          tabIndex={0}
          title="Click to edit — changes appear everywhere this block is shown"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'F2') {
              e.preventDefault();
              setEditing(true);
            }
            if (e.key === 'Delete') void del();
          }}
        >
          <BlockText text={b.text} />
        </div>
      )}
      <footer className="block-foot">
        <SourceLink b={b} />
        {b.via && <span className="via">{VIA_LABEL[b.via] ?? b.via}</span>}
        {b.eventDate && <span className="badge badge-date">{b.eventDate.text}</span>}
        {others.length > 0 && (
          <span className="also">
            also on
            {others.map((o) => (
              <button key={o.id} className="also-dot" style={{ background: o.color }} title={o.name} onClick={() => app.openTab({ kind: 'entity', id: o.id })} />
            ))}
          </span>
        )}
        <span className="spacer" />
        {b.editCount > 0 && (
          <button className="foot-btn" onClick={history} title="See or restore earlier wording">
            edited {b.editCount}×
          </button>
        )}
        {b.editCount === 0 && (
          <button className="foot-btn" onClick={history} title="History">
            history
          </button>
        )}
        {b.via !== 'direct' && b.via !== 'link' && (
          <button className="foot-btn" onClick={removeHere} title="Remove from this page only">
            ✕
          </button>
        )}
        <button className="foot-btn" onClick={del} title="Delete…">
          🗑
        </button>
      </footer>
    </article>
  );
}

function ProfileNotes({ id }: { id: string }) {
  const app = useApp();
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    api.getEntityNotes(id).then((r) => setBody(r.body));
  }, [id]);
  if (body === null) return null;
  return (
    <div className="profile-notes">
      <p className="section-hint">
        Blocks here are filed to this profile automatically. A heading that matches a section name (e.g. <code>## Life</code>) files the notes under it into that section.
      </p>
      <Editor
        mode="document"
        initial={body}
        directOwner={id}
        placeholder="Write directly on this profile…"
        onSave={async (text) => {
          const res = await api.saveEntityNotes(id, text);
          if (res.created.length) await app.refreshNames();
          return res;
        }}
      />
    </div>
  );
}
