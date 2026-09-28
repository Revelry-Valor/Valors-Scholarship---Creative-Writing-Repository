// Timelines & trees: saved views that draw themselves from your writing.
// Family trees, lineage trees, tech trees, radial relationship charts, relationship webs
// and timelines. Each is a page with its own controls; nothing here is typed by hand.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from '../components/Dialogs';
import { layeredLayout, neighbourhood, radialLayout, type LEdge } from './layout';
import { formatSort } from '../../../core/dates';
import type { ViewDef, ViewKind } from '../../../core/types';
import type { GraphEdge, GraphNode } from '../../../core/graph';
import { ParallelPage, TablePage } from './Compare';

type Graph = ApiResult<'graph'>;
type Timeline = ApiResult<'timeline'>;

export const VIEW_KINDS: Array<{ id: ViewKind; label: string; icon: string; blurb: string }> = [
  { id: 'timeline', label: 'Timeline', icon: '⟷', blurb: 'Every date in the project, in lanes, with life spans as bars.' },
  { id: 'family', label: 'Family tree', icon: '⚭', blurb: 'Generations from mother / father / children facts; spouses side by side.' },
  { id: 'lineage', label: 'Lineage tree', icon: '⤓', blurb: 'Any chain: teacher → student, succession, overlord → vassal.' },
  { id: 'tech', label: 'Tech tree', icon: '⚙', blurb: 'Technologies left to right, from their “requires” and “leads to” facts.' },
  { id: 'radial', label: 'Radial chart', icon: '◎', blurb: 'One nation or person in the centre, everyone connected to them around it.' },
  { id: 'web', label: 'Relationship web', icon: '✺', blurb: 'Everyone of the chosen types on a circle, with who is what to whom.' },
  { id: 'parallel', label: 'Parallel accounts', icon: '⫴', blurb: 'Sources side by side, lined up by verse or by page: translations, Gospels, Fathers on one passage.' },
  { id: 'table', label: 'Table', icon: '▦', blurb: 'One row per page, one column per fact or count, sortable and downloadable.' },
];

export const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'family', label: 'Family' },
  { id: 'spouse', label: 'Marriage' },
  { id: 'friendship', label: 'Friendship' },
  { id: 'agreement', label: 'Allies / admire' },
  { id: 'conflict', label: 'Enemies / conflict' },
  { id: 'political', label: 'Political' },
  { id: 'teaching', label: 'Teaching' },
  { id: 'tech', label: 'Technology' },
  { id: 'other', label: 'Other' },
  { id: 'reference', label: 'Reference' },
];

const LINEAGE_KINDS = [
  { id: 'teacher', label: 'Teacher → student' },
  { id: 'parent', label: 'Parent → child' },
  { id: 'overlord', label: 'Overlord → vassal' },
  { id: 'leads_to', label: 'Prerequisite → technology' },
  { id: 'eats', label: 'Food chain (eats)' },
];

async function openBlock(app: ReturnType<typeof useApp>, blockId: string) {
  const b = await api.getBlock(blockId);
  app.openTab({ kind: b.source.kind, id: b.source.id, focusBlock: b.id });
}

export function ViewPage({ id }: { id: string }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [def, setDef] = useState<ViewDef | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    api.listViews().then((vs) => setDef(vs.find((x) => x.id === id) ?? null));
  }, [id]);
  useEffect(() => {
    if (!def) return;
    if (def.kind === 'parallel' || def.kind === 'table') return;
    if (def.kind === 'timeline') api.timeline().then(setTimeline);
    else api.graph().then(setGraph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.kind, app.version]);

  if (!def) return <div className="loading">Loading…</div>;
  const kind = VIEW_KINDS.find((k) => k.id === def.kind)!;

  const update = (patch: Partial<ViewDef>) => {
    const next = { ...def, ...patch };
    setDef(next);
    void api.saveView(next);
  };
  if (def.kind === 'parallel') return <ParallelPage def={def} setDef={setDef} update={update} />;
  if (def.kind === 'table') return <TablePage def={def} setDef={setDef} update={update} />;

  const types = app.nameData.templates;
  const entities = [...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (list: string[] | undefined, value: string, all: string[]) => {
    const cur = list?.length ? list : all;
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    return next.length === all.length ? undefined : next;
  };

  return (
    <div className="view-page">
      <div className="view-bar">
        <span className="view-kind" title={kind.blurb}>
          {kind.icon} {kind.label}
        </span>
        <input className="view-name" value={def.name} aria-label="View name" onChange={(e) => setDef({ ...def, name: e.target.value })} onBlur={() => update({ name: def.name.trim() || kind.label })} />
        {(def.kind === 'radial' || def.kind === 'family' || def.kind === 'lineage' || def.kind === 'tech') && (
          <label className="view-ctl">
            {def.kind === 'radial' ? 'Centre' : 'Start from'}
            <select value={def.root ?? ''} onChange={(e) => update({ root: e.target.value || undefined })}>
              <option value="">{def.kind === 'radial' ? 'Choose…' : 'Everyone'}</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.root && def.kind !== 'timeline' && def.kind !== 'web' && (
          <label className="view-ctl">
            Steps out
            <select value={def.depth ?? (def.kind === 'radial' ? 1 : 6)} onChange={(e) => update({ depth: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.kind === 'lineage' && (
          <label className="view-ctl">
            Follow
            <select value={def.relation ?? 'teacher'} onChange={(e) => update({ relation: e.target.value })}>
              {LINEAGE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
              {app.nameData.relationTypes
                .filter((r) => !['teacher_of', 'student_of', 'parent_of', 'child_of'].includes(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {def.kind === 'timeline' && (
          <label className="view-ctl">
            Lanes
            <select value={def.lanes ?? 'type'} onChange={(e) => update({ lanes: e.target.value as ViewDef['lanes'] })}>
              <option value="type">One per type</option>
              <option value="entity">One per person / thing</option>
            </select>
          </label>
        )}
        <span className="spacer" />
        <div className="zoom">
          <button onClick={() => setZoom((z) => Math.max(0.3, z / 1.25))} title="Zoom out">
            −
          </button>
          <button onClick={() => setZoom(1)} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((z) => Math.min(4, z * 1.25))} title="Zoom in">
            +
          </button>
        </div>
        <button
          className="btn btn-ghost small"
          onClick={async () => {
            const ok = await dialogs.choose({
              title: `Delete “${def.name}”?`,
              message: <p>Only this chart's settings are removed. Nothing you wrote changes.</p>,
              choices: [
                { label: 'Delete', value: true, kind: 'danger' },
                { label: 'Cancel', value: false, kind: 'primary' },
              ],
            });
            if (!ok) return;
            await api.deleteView(def.id);
            app.closeTab(`view:${def.id}`);
          }}
        >
          Delete
        </button>
      </div>

      <div className="view-filters">
        <span className="filter-label">Types</span>
        {types.map((t) => {
          const on = !def.types?.length || def.types.includes(t.id);
          return (
            <button key={t.id} className={`filter-chip ${on ? 'on' : ''}`} style={{ ['--chip' as string]: t.color ?? 'var(--accent)' }} onClick={() => update({ types: toggle(def.types, t.id, types.map((x) => x.id)) })}>
              {t.name}
            </button>
          );
        })}
        {(def.kind === 'radial' || def.kind === 'web') && (
          <>
            <span className="filter-label">Links</span>
            {CATEGORIES.map((c) => {
              const on = !def.categories?.length || def.categories.includes(c.id);
              return (
                <button key={c.id} className={`filter-chip cat-${c.id} ${on ? 'on' : ''}`} onClick={() => update({ categories: toggle(def.categories, c.id, CATEGORIES.map((x) => x.id)) })}>
                  <span className="cat-swatch" /> {c.label}
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className="view-canvas">
        {def.kind === 'timeline' ? (
          timeline ? <TimelineChart data={timeline} def={def} zoom={zoom} /> : <div className="loading">Loading…</div>
        ) : graph ? (
          def.kind === 'radial' || def.kind === 'web' ? (
            <RadialChart graph={graph} def={def} zoom={zoom} />
          ) : (
            <TreeChart graph={graph} def={def} zoom={zoom} />
          )
        ) : (
          <div className="loading">Loading…</div>
        )}
      </div>
    </div>
  );
}

function typeAllowed(def: ViewDef, n: GraphNode) {
  return !def.types?.length || def.types.includes(n.type);
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="view-empty">{children}</div>;
}

// ------------------------------------------------------------------ trees

function TreeChart({ graph, def, zoom }: { graph: Graph; def: ViewDef; zoom: number }) {
  const app = useApp();
  const family = def.kind === 'family';
  const horizontal = def.kind === 'tech';
  const follow = def.kind === 'tech' ? 'leads_to' : family ? 'parent' : def.relation ?? 'teacher';
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  const down = graph.edges.filter((e) => e.kind === follow);
  const same = family ? graph.edges.filter((e) => e.kind === 'spouse') : [];
  const linked = [...down, ...same];
  const involved = [...new Set(linked.flatMap((e) => [e.from, e.to]))].filter((id) => nodesById.has(id) && typeAllowed(def, nodesById.get(id)!));
  const ids = neighbourhood(def.root, linked, def.depth ?? 6, involved).filter((id) => involved.includes(id) || id === def.root);
  const keep = new Set(ids);
  const d2 = down.filter((e) => keep.has(e.from) && keep.has(e.to));
  const s2 = same.filter((e) => keep.has(e.from) && keep.has(e.to));

  const W = 168;
  const H = 52;
  const layout = useMemo(() => layeredLayout(ids, d2, s2, { nodeW: W, nodeH: H, gapX: 28, gapY: horizontal ? 70 : 64, horizontal }), [ids.join(), d2.length, s2.length, horizontal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ids.length) {
    const hint =
      def.kind === 'family'
        ? 'No family links yet. After a tag, write {father: @Name}, {mother: @Name} or {children: @A, @B}, or @A >parent_of> @B.'
        : def.kind === 'tech'
          ? 'No technology links yet. Give a Technology page a “Requires” fact, e.g. {requires: @Bronze working}.'
          : 'Nothing is linked this way yet. Choose another link to follow, or write it: @A >teacher_of> @B.';
    return <Empty>{hint}</Empty>;
  }

  const pad = 40;
  const width = layout.width + pad * 2;
  const height = layout.height + pad * 2;
  const P = (id: string) => {
    const p = layout.nodes.get(id)!;
    return { x: p.x + pad, y: p.y + pad };
  };

  // Family: children hang from the midpoint between two married parents.
  const lines: React.ReactNode[] = [];
  if (!horizontal) {
    const parentsOf = new Map<string, string[]>();
    for (const e of d2) parentsOf.set(e.to, [...(parentsOf.get(e.to) ?? []), e.from]);
    for (const [child, parents] of parentsOf) {
      const c = P(child);
      const cx = c.x + W / 2;
      const ps = parents.map(P);
      const married = family && parents.length === 2 && s2.some((s) => parents.includes(s.from) && parents.includes(s.to));
      const origins = married ? [{ x: (ps[0].x + ps[1].x) / 2 + W / 2, y: ps[0].y + H / 2 }] : ps.map((p) => ({ x: p.x + W / 2, y: p.y + H }));
      for (const o of origins) {
        const midY = c.y - 22;
        lines.push(<path key={`${child}-${o.x}`} className="tree-line" d={`M${o.x},${o.y} V${midY} H${cx} V${c.y}`} />);
      }
    }
    for (const s of s2) {
      const a = P(s.from);
      const b = P(s.to);
      const [l, r] = a.x < b.x ? [a, b] : [b, a];
      lines.push(<line key={`sp-${s.from}-${s.to}`} className="tree-spouse" x1={l.x + W} y1={l.y + H / 2} x2={r.x} y2={r.y + H / 2} />);
    }
  } else {
    for (const e of d2) {
      const a = P(e.from);
      const b = P(e.to);
      const x1 = a.x + W;
      const y1 = a.y + H / 2;
      const x2 = b.x;
      const y2 = b.y + H / 2;
      const mx = (x1 + x2) / 2;
      lines.push(<path key={`${e.from}-${e.to}`} className="tree-line" markerEnd="url(#arrow-tree)" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}`} />);
    }
  }

  return (
    <div className="chart-scroll">
      <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} className="chart tree-chart" role="img" aria-label={def.name}>
        <defs>
          <marker id="arrow-tree" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="tree-arrow" />
          </marker>
        </defs>
        {lines}
        {ids.map((id) => {
          const n = nodesById.get(id)!;
          const p = P(id);
          const dates = n.born || n.died ? `${n.born ?? '?'}${n.died ? ` – ${n.died}` : ''}` : n.typeName;
          return (
            <g key={id} className={`tree-node ${id === def.root ? 'root' : ''}`} transform={`translate(${p.x},${p.y})`} onClick={() => app.openTab({ kind: 'entity', id })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && app.openTab({ kind: 'entity', id })}>
              <title>{`${n.name} · ${n.typeName}`}</title>
              <rect width={W} height={H} rx="7" className="tree-box" />
              <rect width="5" height={H} rx="2" fill={n.color} />
              <text x="14" y="22" className="tree-name">
                {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
              </text>
              <text x="14" y="40" className="tree-dates">
                {dates}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------ radial chart and web

function RadialChart({ graph, def, zoom }: { graph: Graph; def: ViewDef; zoom: number }) {
  const app = useApp();
  const [hover, setHover] = useState<string | null>(null);
  const [edgeHover, setEdgeHover] = useState<GraphEdge | null>(null);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const catOn = (c: string) => !def.categories?.length || def.categories.includes(c);
  const edges = graph.edges.filter((e) => catOn(e.category) && nodesById.has(e.from) && nodesById.has(e.to) && typeAllowed(def, nodesById.get(e.from)!) && typeAllowed(def, nodesById.get(e.to)!));

  if (def.kind === 'radial' && !def.root) return <Empty>Choose who or what goes in the centre (the “Centre” menu above).</Empty>;
  const connected = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const ids =
    def.kind === 'radial'
      ? neighbourhood(def.root, edges, def.depth ?? 1, connected).filter((id) => id === def.root || connected.includes(id))
      : connected.slice(0, 90);
  const keep = new Set(ids);
  const shown = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  if (!shown.length) return <Empty>{def.kind === 'radial' ? 'Nobody is linked to this one yet with the links chosen. Write @A >allied_with> @B, @A >despises> @B, or facts like {allies: @Name}.' : 'No links between the chosen types yet.'}</Empty>;

  const { pos, size } = radialLayout(def.kind === 'radial' ? def.root : undefined, ids, shown as LEdge[]);
  const half = size / 2;
  const firstRing = ids.find((x) => x !== def.root);
  const ringR = firstRing ? Math.hypot(pos.get(firstRing)!.x, pos.get(firstRing)!.y) : 0;

  // Several links between the same two: bend them apart so each arrow is visible.
  const pairCount = new Map<string, number>();
  const bendIndex = (e: GraphEdge) => {
    const key = [e.from, e.to].sort().join('|');
    const n = pairCount.get(key) ?? 0;
    pairCount.set(key, n + 1);
    return n;
  };

  return (
    <div className="chart-scroll">
      <svg width={size * zoom} height={size * zoom} viewBox={`${-half} ${-half} ${size} ${size}`} className="chart radial-chart" role="img" aria-label={def.name}>
        <defs>
          {CATEGORIES.map((c) => (
            <marker key={c.id} id={`arrow-${c.id}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead cat-${c.id}`} />
            </marker>
          ))}
        </defs>
        {def.kind === 'radial' && ringR > 0 && <circle r={ringR} className="radial-ring" />}
        {shown.map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const k = bendIndex(e);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // Always bend to the same side relative to direction, so A→B and B→A separate.
          const bend = 26 + k * 38;
          const cx = (a.x + b.x) / 2 + (-dy / len) * bend;
          const cy = (a.y + b.y) / 2 + (dx / len) * bend;
          // Stop the arrow at the edge of the target dot.
          const tx = b.x - (b.x - cx) * (20 / Math.hypot(b.x - cx, b.y - cy));
          const ty = b.y - (b.y - cy) * (20 / Math.hypot(b.x - cx, b.y - cy));
          const dim = hover && e.from !== hover && e.to !== hover;
          const symmetric = ['spouse', 'sibling', 'friend', 'ally', 'enemy', 'rival'].includes(e.kind);
          return (
            <g key={i} className={`edge cat-${e.category} ${dim ? 'dim' : ''}`} onMouseEnter={() => setEdgeHover(e)} onMouseLeave={() => setEdgeHover(null)} onClick={() => e.blockId && openBlock(app, e.blockId)}>
              <path d={`M${a.x},${a.y} Q${cx},${cy} ${tx},${ty}`} className="edge-line" markerEnd={symmetric ? undefined : `url(#arrow-${e.category})`} />
              <path d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} className="edge-hit" />
              {(ids.length <= 14 || hover === e.from || hover === e.to) && (
                <EdgeLabel a={a} b={b} cx={cx} cy={cy} text={e.label} />
              )}
            </g>
          );
        })}
        {ids.map((id) => {
          const n = nodesById.get(id)!;
          const p = pos.get(id)!;
          const isRoot = id === def.root;
          const labelBelow = p.y >= 0;
          return (
            <g
              key={id}
              className={`radial-node ${isRoot ? 'root' : ''}`}
              transform={`translate(${p.x},${p.y})`}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => app.openTab({ kind: 'entity', id })}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => ev.key === 'Enter' && app.openTab({ kind: 'entity', id })}
            >
              <title>{`${n.name} · ${n.typeName}`}</title>
              <circle r={isRoot ? 26 : 16} fill={n.color} className="radial-dot" />
              <text y={labelBelow ? (isRoot ? 44 : 32) : isRoot ? -34 : -24} className="radial-label">
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>
      {edgeHover && (
        <div className="edge-tip">
          <strong>
            {nodesById.get(edgeHover.from)?.name} {edgeHover.label} {nodesById.get(edgeHover.to)?.name}
          </strong>
          {edgeHover.sourceText && <p>{edgeHover.sourceText.length > 200 ? `${edgeHover.sourceText.slice(0, 198)}…` : edgeHover.sourceText}</p>}
          <span className="muted small">{edgeHover.blockId ? 'Click the line to open where you wrote it' : 'Set on a profile'}</span>
        </div>
      )}
    </div>
  );
}

/** Label at the curve's apex, pushed outward so two opposite arrows never share a spot. */
function EdgeLabel({ a, b, cx, cy, text }: { a: { x: number; y: number }; b: { x: number; y: number }; cx: number; cy: number; text: string }) {
  const lx = (a.x + 2 * cx + b.x) / 4;
  const ly = (a.y + 2 * cy + b.y) / 4;
  const ox = lx - (a.x + b.x) / 2;
  const oy = ly - (a.y + b.y) / 2;
  const horizontalish = Math.abs(ox) >= Math.abs(oy);
  const anchor = horizontalish ? (ox < 0 ? 'end' : 'start') : 'middle';
  const x = lx + (horizontalish ? Math.sign(ox) * 4 : 0);
  const y = ly + (horizontalish ? 4 : Math.sign(oy) * 12 + 4);
  return (
    <text x={x} y={y} className="edge-label" textAnchor={anchor}>
      {text}
    </text>
  );
}

// ------------------------------------------------------------------ timeline

function niceStep(pxPerYear: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s * pxPerYear >= 90) return s;
  return 10000;
}

function TimelineChart({ data, def, zoom }: { data: Timeline; def: ViewDef; zoom: number }) {
  const app = useApp();
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const events = data.events.filter((e) => !def.types?.length || e.entityIds.some((id) => def.types!.includes(nodesById.get(id)?.type ?? '')) || (!e.entityIds.length && true));
  const ref = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.max(500, el.clientWidth - 260));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!events.length)
    return (
      <div className="chart-scroll" ref={ref}>
        <Empty>No dates yet. Give someone a born or died fact, or date a paragraph with {'{year: 1313}'}.</Empty>
      </div>
    );

  const min = Math.min(...events.map((e) => e.sort));
  const max = Math.max(...events.map((e) => e.end ?? e.sort));
  const span = Math.max(1, max - min);
  // At 100% the whole history fits the window; zoom in to spread it out.
  const pxPerYear = Math.max(0.01, (fitWidth / span) * zoom);
  const step = niceStep(pxPerYear);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step + step;
  const X = (year: number) => 180 + (year - start) * pxPerYear;
  const width = X(end) + 60;

  // Lanes: by type, or by entity.
  const laneOf = (e: (typeof events)[number]) => {
    const first = nodesById.get(e.entityIds[0] ?? '');
    if (!first) return 'Events';
    return def.lanes === 'entity' ? first.name : first.typeName;
  };
  const laneNames = [...new Set(events.map(laneOf))].sort((a, b) => (a === 'Events' ? 1 : 0) - (b === 'Events' ? 1 : 0) || a.localeCompare(b));
  // Within a lane, stack items into rows so labels never overlap.
  const rowH = 30;
  const lanes = laneNames.map((name) => {
    const items = events.filter((e) => laneOf(e) === name);
    const rowsEnd: number[] = [];
    const placed = items.map((e) => {
      const x1 = X(e.sort);
      const x2 = Math.max(X(e.end ?? e.sort), x1 + Math.min(260, e.label.length * 6.2 + 20));
      let row = rowsEnd.findIndex((endX) => endX < x1 - 8);
      if (row === -1) {
        row = rowsEnd.length;
        rowsEnd.push(0);
      }
      rowsEnd[row] = x2;
      return { e, row };
    });
    return { name, placed, rows: Math.max(1, rowsEnd.length) };
  });
  let y = 40;
  const laneY = lanes.map((l) => {
    const top = y;
    y += l.rows * rowH + 18;
    return top;
  });
  const height = y + 10;
  const ticks: number[] = [];
  for (let t = start; t <= end; t += step) ticks.push(t);

  return (
    <div className="chart-scroll" ref={ref}>
      <svg width={width} height={height} className="chart timeline-chart" role="img" aria-label={def.name}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={24} y2={height} className="tl-grid" />
            <text x={X(t)} y={16} className="tl-tick">
              {formatSort(t)}
            </text>
          </g>
        ))}
        {lanes.map((l, li) => (
          <g key={l.name}>
            <rect x={0} y={laneY[li] - 6} width={width} height={l.rows * rowH + 12} className={`tl-lane ${li % 2 ? 'odd' : ''}`} />
            <text x={12} y={laneY[li] + 16} className="tl-lane-name">
              {l.name.length > 22 ? `${l.name.slice(0, 21)}…` : l.name}
            </text>
            {l.placed.map(({ e, row }, i) => {
              const yy = laneY[li] + row * rowH;
              const x1 = X(e.sort);
              const color = nodesById.get(e.entityIds[0] ?? '')?.color ?? 'var(--accent)';
              const open = () => (e.blockId ? openBlock(app, e.blockId) : e.entityIds[0] && app.openTab({ kind: 'entity', id: e.entityIds[0] }));
              const title = `${e.label} — ${e.text}${e.approximate ? ' (approximate)' : ''}`;
              if (e.end !== undefined && e.end > e.sort) {
                const x2 = X(e.end);
                return (
                  <g key={i} className={`tl-item ${e.approximate ? 'approx' : ''}`} onClick={open} role="button">
                    <title>{title}</title>
                    <rect x={x1} y={yy + 4} width={Math.max(4, x2 - x1)} height={16} rx="8" fill={color} className="tl-span" />
                    <text x={x1 + 8} y={yy + 16} className="tl-span-label">
                      {e.label} <tspan className="tl-dates">{e.text}</tspan>
                    </text>
                  </g>
                );
              }
              return (
                <g key={i} className={`tl-item ${e.approximate ? 'approx' : ''}`} onClick={open} role="button">
                  <title>{title}</title>
                  <circle cx={x1} cy={yy + 12} r="6" fill={color} className="tl-dot" />
                  <text x={x1 + 11} y={yy + 16} className="tl-label">
                    {e.label}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
