// Right-hand panels: the current block's filing ("where is this paragraph going?")
// and the F1 quick reference.
import { useApp } from '../state';
import { QUICK_REFERENCE } from '../../../core/editing';
import { api } from '../api';
import { useDialogs } from './Dialogs';
import { SuggestionsPanel } from './Review';
import { LexiconPanel } from './LexiconPanel';

export function RightPanel() {
  const app = useApp();
  const which = app.panels.right;
  if (!which) return null;
  return (
    <aside className="right-panel" aria-label={which === 'reference' ? 'Quick reference' : which === 'suggest' ? 'Suggestions' : 'This block'}>
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={which === 'context'} className={which === 'context' ? 'active' : ''} onClick={() => app.setPanels({ right: 'context' })}>
          Block
        </button>
        <button role="tab" aria-selected={which === 'suggest'} className={which === 'suggest' ? 'active' : ''} onClick={() => app.setPanels({ right: 'suggest' })} title="What the active scan found in this document">
          ✦ Suggest
        </button>
        <button role="tab" aria-selected={which === 'lexicon'} className={which === 'lexicon' ? 'active' : ''} onClick={() => app.setPanels({ right: 'lexicon' })} title="Greek, Hebrew and other lexicons">
          Α Lexicon
        </button>
        <button role="tab" aria-selected={which === 'reference'} className={which === 'reference' ? 'active' : ''} onClick={() => app.setPanels({ right: 'reference' })}>
          Markup <kbd>F1</kbd>
        </button>
        <span className="spacer" />
        {which === 'reference' && (
          <button
            className={`icon-btn ${app.panels.pinnedReference ? 'on' : ''}`}
            title={app.panels.pinnedReference ? 'Unpin (F1 closes it)' : 'Pin open'}
            onClick={() => app.setPanels({ pinnedReference: !app.panels.pinnedReference })}
          >
            📌
          </button>
        )}
        <button className="icon-btn" title="Close panel" onClick={() => app.setPanels({ right: null })}>
          ×
        </button>
      </div>
      {which === 'reference' ? <QuickReference /> : which === 'suggest' ? <SuggestionsPanel /> : which === 'lexicon' ? <LexiconPanel /> : <BlockContext />}
    </aside>
  );
}

function QuickReference() {
  return (
    <div className="panel-body quickref">
      <p className="muted small">
        <kbd>@</kbd> is the only key to remember — it opens a menu for all of these.
      </p>
      <dl>
        {QUICK_REFERENCE.map((r) => (
          <div key={r.syntax} className="qr-row">
            <dt>
              <code>{r.syntax}</code>
            </dt>
            <dd>
              {r.meaning}
              <div className="qr-example">{r.example}</div>
            </dd>
          </div>
        ))}
      </dl>
      <h3>Keys</h3>
      <dl className="keys">
        {[
          ['Ctrl+B / I / U', 'Bold / italic / underline'],
          ['Ctrl+Shift+X', 'Strikethrough'],
          ['Ctrl+Shift+H', 'Highlight'],
          ['Ctrl+Shift+K', 'Mark important (paragraph, or selected phrase)'],
          ['Ctrl+Alt+1/2/3', 'Title / heading / subheading'],
          ['Ctrl+Alt+0', 'Normal text'],
          ['Ctrl+Shift+8 / 7', 'Bulleted / numbered list'],
          ['Ctrl+Shift+9', 'Quote'],
          ['Ctrl+Shift+Enter', 'Focus mode'],
          ['Ctrl+O', 'Jump to entry or entity'],
          ['Ctrl+K', 'Commands'],
          ['Ctrl+N', 'New document'],
          ['Ctrl+Shift+E', 'New entity'],
          ['Ctrl+Shift+F', 'Search all writing'],
          ['Ctrl+Shift+A', 'Suggestions for this document'],
          ['Ctrl+Shift+L', 'Research beside the page'],
          ['Ctrl+Shift+G', 'Lexicon (Greek, Hebrew…)'],
          ['Ctrl+Enter', 'Open the chip under the cursor'],
          ['Ctrl+click', 'Open a chip'],
          ['Ctrl+E', 'Show raw markup'],
          ['Ctrl+W', 'Close tab'],
          ['Ctrl+Tab', 'Next tab'],
          ['Ctrl+\\', 'Toggle this panel'],
        ].map(([k, v]) => (
          <div key={k} className="qr-row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BlockContext() {
  const app = useApp();
  const dialogs = useDialogs();
  const b = app.currentBlock;
  const activeTab = app.tabs.find((t) => t.key === app.active);
  if (!b || activeTab?.kind !== 'entry') {
    return (
      <div className="panel-body">
        <p className="muted">Put the cursor in a paragraph to see where it will be filed.</p>
        <p className="muted small">The coloured stripe in the left margin shows the same thing while you type: one colour per entity.</p>
      </div>
    );
  }

  const createFix = async (name: string) => {
    const type = await dialogs.pick({
      title: `Create “${name}” as…`,
      items: app.nameData.templates.map((t) => ({ label: t.name, value: t.id, color: t.color })),
    });
    if (!type) return;
    try {
      await api.createEntity({ name, type });
      await app.refreshNames();
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  const name = (id: string) => app.entityById.get(id)?.name ?? id;
  return (
    <div className="panel-body">
      <h3>Filed to</h3>
      {b.filedTo.length === 0 && b.creates.length === 0 && <p className="muted small">Nowhere yet — this paragraph only lives in this entry.</p>}
      <ul className="filed-list">
        {b.filedTo.map((f) => {
          const e = app.entityById.get(f.entityId);
          return (
            <li key={f.entityId}>
              <span className="stripe-swatch" style={{ background: e?.color }} />
              <button className="linkish" onClick={() => app.openTab({ kind: 'entity', id: f.entityId })}>
                {e?.name ?? f.entityId}
              </button>
              <span className="muted small">
                {f.section ?? 'Mentions'} · {f.via === 'section' ? 'from heading' : f.via === 'inline' ? 'tagged' : f.via}
              </span>
            </li>
          );
        })}
        {b.creates.map((c) => (
          <li key={c.name}>
            <span className="stripe-swatch new" />
            <span>{c.name}</span>
            <span className="muted small">new — created when saved</span>
          </li>
        ))}
      </ul>

      {b.relations.length > 0 && (
        <>
          <h3>Relationships</h3>
          <ul className="plain-list">
            {b.relations.map((r, i) => (
              <li key={i}>
                {name(r.subject)} <span className="muted">{app.relationTypes.get(r.type)?.label.toLowerCase()}</span> {name(r.object)}
              </li>
            ))}
          </ul>
        </>
      )}

      {b.fields.length > 0 && (
        <>
          <h3>Facts set</h3>
          <ul className="plain-list">
            {b.fields.map((f, i) => (
              <li key={i}>
                {name(f.entityId)}.<strong>{f.field}</strong> = {f.valueText}
              </li>
            ))}
          </ul>
        </>
      )}

      {b.warnings.length > 0 && (
        <>
          <h3 className="warn-title">Needs attention</h3>
          <ul className="warn-list">
            {b.warnings.map((w, i) => {
              const m = /No entity named "([^"]+)"/.exec(w.message);
              return (
                <li key={i}>
                  <span>{w.message}</span>
                  {m && (
                    <button className="btn small" onClick={() => createFix(m[1])}>
                      Create “{m[1]}”
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
