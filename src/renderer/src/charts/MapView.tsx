// Interactive maps: pins, regions and routes on your own map image, each linked to a page,
// with a year slider that shows the world as it was, and a snapshot of that year beside it.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent } from 'react';
import { api, type ApiResult } from '../api';
import { useApp } from '../state';
import { useDialogs } from '../components/Dialogs';
import { ViewHead } from './Compare';
import { itemVisible, type MapMarker, type MapShape } from '../../../core/maps';
import type { ViewDef } from '../../../core/types';

type Tool = 'move' | 'pin' | 'region' | 'route';
type Sel = { kind: 'marker' | 'region' | 'route'; id: string } | null;
type Snapshot = ApiResult<'snapshot'>;

const PARCHMENT = { width: 1600, height: 1000 };
const newId = () => Math.random().toString(36).slice(2, 9);
const fmtYear = (y: number) => (y < 0 ? `${-y} BC` : String(y));

function centroid(points: Array<[number, number]>): [number, number] {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

async function readImage(file: File): Promise<{ url: string; width: number; height: number }> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('That image could not be read.'));
    img.src = url;
  });
  return { url, width: img.naturalWidth || PARCHMENT.width, height: img.naturalHeight || PARCHMENT.height };
}

export function MapPage({ def, setDef, update }: { def: ViewDef; setDef: (d: ViewDef) => void; update: (p: Partial<ViewDef>) => void }) {
  const app = useApp();
  const dialogs = useDialogs();
  const [image, setImage] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [spans, setSpans] = useState<ApiResult<'entitySpans'>>({});
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [range, setRange] = useState<{ min: number; max: number }>({ min: 0, max: 2000 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'marker'; id?: string; x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const W = def.image?.width ?? PARCHMENT.width;
  const H = def.image?.height ?? PARCHMENT.height;
  const markers = def.markers ?? [];
  const regions = def.regions ?? [];
  const routes = def.routes ?? [];

  useEffect(() => {
    if (def.image) api.getMapImage(def.id).then(setImage);
    else setImage(null);
  }, [def.id, def.image]);
  useEffect(() => {
    api.entitySpans().then(setSpans);
    api.snapshot(def.year ?? 0).then((s) => {
      if (s.range.min !== undefined && s.range.max !== undefined) setRange({ min: Math.floor(s.range.min), max: Math.ceil(s.range.max) });
    });
  }, [app.version, def.year]);
  useEffect(() => {
    if (def.year === undefined) return setSnap(null);
    api.snapshot(def.year).then(setSnap);
  }, [def.year, app.version]);

  // Fit the map to the window.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / W, el.clientHeight / H) * 0.96;
    setView({ scale, tx: (el.clientWidth - W * scale) / 2, ty: (el.clientHeight - H * scale) / 2 });
  }, [W, H]);
  useEffect(() => {
    fit();
  }, [fit, image]);

  const toMap = (clientX: number, clientY: number): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [(clientX - r.left - view.tx) / view.scale / W, (clientY - r.top - view.ty) / view.scale / H];
  };

  const pickTarget = async (what: string): Promise<{ entity?: string; label?: string } | null> => {
    const choice = await dialogs.pick<string>({
      title: `What is this ${what}?`,
      placeholder: 'A page, or just a label',
      items: [{ label: '✎ Just a label…', value: '__label' }, ...[...app.nameData.entities].sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: e.name, detail: e.typeName, value: e.id, color: e.color }))],
    });
    if (!choice) return null;
    if (choice === '__label') {
      const label = await dialogs.prompt({ title: 'Label', okLabel: 'Add' });
      return label ? { label } : null;
    }
    return { entity: choice };
  };

  const finishShape = async () => {
    const pts = draft;
    setDraft([]);
    if ((tool === 'region' && pts.length < 3) || (tool === 'route' && pts.length < 2)) return;
    const t = await pickTarget(tool === 'region' ? 'region' : 'route');
    if (!t) return;
    const shape: MapShape = { id: newId(), points: pts.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]), ...t };
    if (tool === 'region') update({ regions: [...regions, shape] });
    else update({ routes: [...routes, shape] });
    setSel({ kind: tool === 'region' ? 'region' : 'route', id: shape.id });
  };

  const onDown = async (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const [x, y] = toMap(e.clientX, e.clientY);
    if (tool === 'pin') {
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      const t = await pickTarget('pin');
      if (!t) return;
      const m: MapMarker = { id: newId(), x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, ...t };
      update({ markers: [...markers, m] });
      setSel({ kind: 'marker', id: m.id });
      return;
    }
    if (tool === 'region' || tool === 'route') {
      // Clicking the first point closes a region.
      if (tool === 'region' && draft.length >= 3) {
        const [fx, fy] = draft[0];
        if (Math.hypot((fx - x) * W * view.scale, (fy - y) * H * view.scale) < 12) return void finishShape();
      }
      setDraft((d) => [...d, [x, y]]);
      return;
    }
    const markerId = (e.target as Element).closest('[data-marker]')?.getAttribute('data-marker');
    drag.current = { kind: markerId ? 'marker' : 'pan', id: markerId ?? undefined, x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (d.kind === 'pan') setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
    else if (d.id && d.moved) {
      const [x, y] = toMap(e.clientX, e.clientY);
      setDragPos({ id: d.id, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    }
  };
  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'marker' && d.id) {
      if (d.moved && dragPos) update({ markers: markers.map((m) => (m.id === d.id ? { ...m, x: Math.round(dragPos.x * 10000) / 10000, y: Math.round(dragPos.y * 10000) / 10000 } : m)) });
      else setSel({ kind: 'marker', id: d.id });
      setDragPos(null);
      return;
    }
    if (!d.moved) {
      const shape = (e.target as Element).closest('[data-shape]');
      if (shape) setSel({ kind: shape.getAttribute('data-kind') as 'region' | 'route', id: shape.getAttribute('data-shape')! });
      else setSel(null);
    }
  };
  const onWheel = (e: WheelEvent) => {
    const r = box.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const scale = Math.min(20, Math.max(0.05, v.scale * k));
      return { scale, tx: px - ((px - v.tx) * scale) / v.scale, ty: py - ((py - v.ty) * scale) / v.scale };
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') {
        setDraft([]);
        setSel(null);
      } else if (e.key === 'Enter' && draft.length) void finishShape();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeSel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const removeSel = () => {
    if (!sel) return;
    if (sel.kind === 'marker') update({ markers: markers.filter((m) => m.id !== sel.id) });
    if (sel.kind === 'region') update({ regions: regions.filter((m) => m.id !== sel.id) });
    if (sel.kind === 'route') update({ routes: routes.filter((m) => m.id !== sel.id) });
    setSel(null);
  };

  const patchSel = (p: Partial<MapMarker & MapShape>) => {
    if (!sel) return;
    if (sel.kind === 'marker') update({ markers: markers.map((m) => (m.id === sel.id ? { ...m, ...p } : m)) });
    if (sel.kind === 'region') update({ regions: regions.map((m) => (m.id === sel.id ? { ...m, ...p } : m)) });
    if (sel.kind === 'route') update({ routes: routes.map((m) => (m.id === sel.id ? { ...m, ...p } : m)) });
  };

  const chooseImage = async (file?: File) => {
    if (!file) return;
    try {
      const img = await readImage(file);
      await api.saveMapImage(def.id, img.url);
      setImage(img.url);
      update({ image: { width: img.width, height: img.height } });
    } catch (err) {
      app.notify((err as Error).message, 'error');
    }
  };

  const year = def.year;
  const visible = <T extends { from?: number; to?: number; entity?: string }>(x: T) => itemVisible(x, x.entity ? spans[x.entity] : undefined, year);
  const colorOf = (x: { entity?: string; color?: string }) => x.color ?? (x.entity ? app.entityById.get(x.entity)?.color : undefined) ?? 'var(--accent)';
  const nameOf = (x: { entity?: string; label?: string }) => x.label ?? (x.entity ? app.entityById.get(x.entity)?.name : undefined) ?? '';
  const inv = 1 / view.scale;
  const selected = sel ? (sel.kind === 'marker' ? markers.find((m) => m.id === sel.id) : sel.kind === 'region' ? regions.find((m) => m.id === sel.id) : routes.find((m) => m.id === sel.id)) : undefined;
  const onMap = useMemo(() => new Set([...markers, ...regions, ...routes].map((x) => x.entity).filter(Boolean)), [markers, regions, routes]);
  const focusEntity = (id: string) => {
    const m = markers.find((x) => x.entity === id);
    const s = regions.find((x) => x.entity === id) ?? routes.find((x) => x.entity === id);
    const at = m ? [m.x, m.y] : s ? centroid(s.points) : null;
    if (!at) return app.openTab({ kind: 'entity', id });
    setSel(m ? { kind: 'marker', id: m.id } : { kind: regions.includes(s as MapShape) ? 'region' : 'route', id: s!.id });
    const el = box.current!;
    setView((v) => ({ ...v, tx: el.clientWidth / 2 - at[0] * W * v.scale, ty: el.clientHeight / 2 - at[1] * H * v.scale }));
  };

  return (
    <div className="view-page map-page">
      <ViewHead def={def} setDef={setDef} update={update} icon="🗺" label="Map">
        <div className="map-tools" role="toolbar" aria-label="Map tools">
          {(
            [
              ['move', '✋', 'Move and select (drag pins to move them)'],
              ['pin', '📍', 'Add a pin: click the map'],
              ['region', '⬠', 'Draw a region: click its corners, then click the first corner or press Enter'],
              ['route', '〰', 'Draw a route: click along it, then press Enter'],
            ] as Array<[Tool, string, string]>
          ).map(([t, icon, title]) => (
            <button key={t} className={`fb-btn ${tool === t ? 'on' : ''}`} title={title} onClick={() => (setTool(t), setDraft([]))}>
              {icon}
            </button>
          ))}
        </div>
        <button className="btn small btn-ghost" onClick={() => fileInput.current?.click()}>
          {def.image ? 'Change image…' : 'Choose a map image…'}
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => chooseImage(e.target.files?.[0])} />
      </ViewHead>
      <div className="map-yearbar">
        <label className="inline-check small">
          <input type="checkbox" checked={year !== undefined} onChange={(e) => update({ year: e.target.checked ? Math.round((range.min + range.max) / 2) : undefined })} /> Show one year
        </label>
        {year !== undefined && (
          <>
            <input type="range" min={range.min} max={range.max} value={year} onChange={(e) => setDef({ ...def, year: Number(e.target.value) })} onPointerUp={() => update({ year: def.year })} onKeyUp={() => update({ year: def.year })} aria-label="Year" />
            <input className="input small map-year" type="number" value={year} onChange={(e) => update({ year: Number(e.target.value) })} aria-label="Year" />
            <span className="muted small">
              {fmtYear(range.min)} – {fmtYear(range.max)}
            </span>
          </>
        )}
        <span className="spacer" />
        {draft.length > 0 && (
          <span className="small map-hint">
            {draft.length} point{draft.length === 1 ? '' : 's'} · <kbd>Enter</kbd> to finish · <kbd>Esc</kbd> to cancel
          </span>
        )}
        <div className="zoom">
          <button onClick={() => setView((v) => ({ ...v, scale: v.scale / 1.25 }))}>−</button>
          <button onClick={fit}>Fit</button>
          <button onClick={() => setView((v) => ({ ...v, scale: v.scale * 1.25 }))}>+</button>
        </div>
      </div>
      <div className="map-body">
        <div ref={box} className={`map-canvas tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onDoubleClick={() => draft.length && finishShape()}>
          <div className="map-content" style={{ width: W, height: H, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
            {image ? <img src={image} alt="" draggable={false} /> : <div className="map-parchment" />}
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {regions.filter(visible).map((r) => (
                <g key={r.id} data-shape={r.id} data-kind="region" className={`map-region ${sel?.id === r.id ? 'sel' : ''}`}>
                  <polygon points={r.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')} style={{ fill: colorOf(r), stroke: colorOf(r) }} strokeWidth={2 * inv} />
                  <text x={centroid(r.points)[0] * W} y={centroid(r.points)[1] * H} fontSize={15 * inv} className="map-label region-label">
                    {nameOf(r)}
                  </text>
                </g>
              ))}
              {routes.filter(visible).map((r) => (
                <g key={r.id} data-shape={r.id} data-kind="route" className={`map-route ${sel?.id === r.id ? 'sel' : ''}`}>
                  <polyline points={r.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')} style={{ stroke: colorOf(r) }} strokeWidth={3 * inv} strokeDasharray={`${8 * inv} ${5 * inv}`} />
                  <polyline className="route-hit" points={r.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')} strokeWidth={14 * inv} />
                  <text x={((r.points[0][0] + r.points[1][0]) / 2) * W} y={((r.points[0][1] + r.points[1][1]) / 2) * H - 8 * inv} fontSize={13 * inv} className="map-label route-label">
                    {nameOf(r)}
                  </text>
                </g>
              ))}
              {markers.filter(visible).map((m) => {
                const p = dragPos?.id === m.id ? dragPos : m;
                return (
                  <g key={m.id} data-marker={m.id} className={`map-marker ${sel?.id === m.id ? 'sel' : ''}`} transform={`translate(${p.x * W} ${p.y * H})`}>
                    <circle r={7 * inv} style={{ fill: colorOf(m) }} strokeWidth={2 * inv} />
                    <text x={10 * inv} y={4 * inv} fontSize={13 * inv} className="map-label">
                      {nameOf(m)}
                    </text>
                  </g>
                );
              })}
              {draft.length > 0 && (
                <g className="map-draft">
                  <polyline points={draft.map(([x, y]) => `${x * W},${y * H}`).join(' ')} strokeWidth={2 * inv} />
                  {draft.map(([x, y], i) => (
                    <circle key={i} cx={x * W} cy={y * H} r={(i === 0 ? 6 : 4) * inv} />
                  ))}
                </g>
              )}
            </svg>
          </div>
          {!image && !markers.length && !regions.length && (
            <div className="map-empty">
              <p>Choose an image of your map (a scan, a drawing, a historical map), or draw straight onto this parchment.</p>
              <button className="btn btn-primary" onPointerDown={(e) => e.stopPropagation()} onClick={() => fileInput.current?.click()}>
                Choose a map image…
              </button>
            </div>
          )}
        </div>
        <aside className="map-side">
          {selected && sel ? (
            <div className="map-item">
              <h3>{sel.kind === 'marker' ? '📍 Pin' : sel.kind === 'region' ? '⬠ Region' : '〰 Route'}</h3>
              {selected.entity && app.entityById.get(selected.entity) && (
                <button className="linkish map-entity" onClick={() => app.openTab({ kind: 'entity', id: selected.entity! })}>
                  <span className="dot" style={{ background: app.entityById.get(selected.entity)!.color }} /> {app.entityById.get(selected.entity)!.name} →
                </button>
              )}
              <label className="modal-label">
                Label
                <input className="input small" value={selected.label ?? ''} placeholder={nameOf({ entity: selected.entity })} onChange={(e) => patchSel({ label: e.target.value || undefined })} />
              </label>
              <label className="modal-label">
                Page
                <select className="input small" value={selected.entity ?? ''} onChange={(e) => patchSel({ entity: e.target.value || undefined })}>
                  <option value="">None</option>
                  {[...app.nameData.entities]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="map-years">
                <label className="modal-label">
                  From year
                  <input className="input small" type="number" value={selected.from ?? ''} placeholder={selected.entity && spans[selected.entity]?.start !== undefined ? String(Math.floor(spans[selected.entity].start!)) : 'always'} onChange={(e) => patchSel({ from: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </label>
                <label className="modal-label">
                  To year
                  <input className="input small" type="number" value={selected.to ?? ''} placeholder={selected.entity && spans[selected.entity]?.end !== undefined ? String(Math.floor(spans[selected.entity].end!)) : 'always'} onChange={(e) => patchSel({ to: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </label>
              </div>
              {sel.kind !== 'marker' && (
                <label className="modal-label">
                  Colour
                  <input type="color" value={(selected as MapShape).color ?? '#8b4a2b'} onChange={(e) => patchSel({ color: e.target.value })} />
                </label>
              )}
              <p className="muted small">Leave the years empty to use the page’s own dates (founded, fell, born, died…).</p>
              <button className="btn small danger" onClick={removeSel}>
                Remove from map
              </button>
            </div>
          ) : year !== undefined && snap ? (
            <SnapshotPanel snap={snap} onMap={onMap} onEntity={focusEntity} />
          ) : (
            <div className="map-help muted small">
              <p>
                <strong>📍 Pin</strong> a city, a battle or a monastery. <strong>⬠ Region</strong> for a nation, a province or a diocese. <strong>〰 Route</strong> for a journey, a trade road or a campaign.
              </p>
              <p>Link each to a page and it appears and disappears with that page’s dates. Tick “Show one year” to see the world as it was, with a snapshot of who was alive and what happened.</p>
              <p>Drag to pan, scroll to zoom, drag pins to move them, Delete removes the selected item.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SnapshotPanel({ snap, onMap, onEntity }: { snap: Snapshot; onMap: Set<string | undefined>; onEntity: (id: string) => void }) {
  const app = useApp();
  const groups = new Map<string, Snapshot['existing']>();
  for (const e of snap.existing) (groups.get(e.typeName) ?? groups.set(e.typeName, []).get(e.typeName)!).push(e);
  const name = (id: string) => app.entityById.get(id)?.name ?? id;
  return (
    <div className="snapshot">
      <h3>The world in {fmtYear(snap.year)}</h3>
      {(snap.began.length > 0 || snap.ended.length > 0) && (
        <p className="small">
          {snap.began.length > 0 && <>Began or born: {snap.began.map(name).join(', ')}. </>}
          {snap.ended.length > 0 && <>Ended or died: {snap.ended.map(name).join(', ')}.</>}
        </p>
      )}
      {snap.events.length > 0 && (
        <>
          <h4>Happened</h4>
          <ul className="snap-events">
            {snap.events.map((e, i) => (
              <li key={i}>
                <button className="linkish" onClick={() => e.blockId && api.getBlock(e.blockId).then((b) => app.openTab({ kind: b.source.kind, id: b.source.id, focusBlock: b.id }))}>
                  {e.text.length > 140 ? `${e.text.slice(0, 138)}…` : e.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {[...groups].map(([type, list]) => (
        <div key={type}>
          <h4>
            {type} <span className="count">{list.length}</span>
          </h4>
          <ul className="snap-list">
            {list.map((e) => (
              <li key={e.id}>
                <button className="linkish" onClick={() => onEntity(e.id)} title={onMap.has(e.id) ? 'Show on the map' : 'Open the page'}>
                  <span className="dot" style={{ background: e.color }} /> {e.name}
                </button>
                <span className="muted small">
                  {e.age !== undefined ? `age ${e.age}` : ''}
                  {onMap.has(e.id) ? ' · on map' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!snap.existing.length && !snap.events.length && <p className="muted small">Nothing dated in this year yet. Give pages dates like {'{founded: 300}'} or {'{born: 1280}'}.</p>}
    </div>
  );
}
