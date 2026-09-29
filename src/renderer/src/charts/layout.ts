// Layouts for trees (layered, top-down or left-to-right) and radial charts.
// Small, dependency-free and deterministic, so the same data always draws the same way.

export interface LEdge {
  from: string;
  to: string;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  rank: number;
}

/**
 * Layered layout for trees: generations for family trees, teacher → student lines,
 * prerequisite → technology. `down` edges point from the upper/earlier node to the lower/later one;
 * `same` pairs (spouses) share a rank and sit side by side.
 */
export function layeredLayout(
  ids: string[],
  down: LEdge[],
  same: LEdge[],
  opts: { nodeW: number; nodeH: number; gapX: number; gapY: number; horizontal?: boolean },
): { nodes: Map<string, Placed>; width: number; height: number } {
  const rank = new Map(ids.map((id) => [id, 0]));
  // Longest-path ranking, with spouses pulled level. Bounded so cycles can't loop forever.
  for (let iter = 0, changed = true; changed && iter < ids.length + 5; iter++) {
    changed = false;
    for (const e of down) {
      const want = (rank.get(e.from) ?? 0) + 1;
      if ((rank.get(e.to) ?? 0) < want) {
        rank.set(e.to, want);
        changed = true;
      }
    }
    for (const e of same) {
      const r = Math.max(rank.get(e.from) ?? 0, rank.get(e.to) ?? 0);
      if (rank.get(e.from) !== r || rank.get(e.to) !== r) {
        rank.set(e.from, r);
        rank.set(e.to, r);
        changed = true;
      }
    }
  }
  // Pull nodes with no parents down next to their children (e.g. a spouse from outside the family).
  for (const id of ids) {
    if (down.some((e) => e.to === id)) continue;
    const kids = down.filter((e) => e.from === id).map((e) => rank.get(e.to) ?? 0);
    if (kids.length) rank.set(id, Math.max(rank.get(id) ?? 0, Math.min(...kids) - 1));
  }
  const maxRank = Math.max(0, ...rank.values());
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  // Initial order: depth-first from the roots, so families start grouped.
  const visited = new Set<string>();
  const childrenOf = (id: string) => down.filter((e) => e.from === id).map((e) => e.to);
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    layers[rank.get(id)!].push(id);
    for (const s of same) {
      if (s.from === id) visit(s.to);
      if (s.to === id) visit(s.from);
    }
    for (const c of childrenOf(id)) visit(c);
  };
  for (const id of ids) if (!down.some((e) => e.to === id)) visit(id);
  for (const id of ids) visit(id);

  const pos = () => {
    const m = new Map<string, number>();
    for (const layer of layers) layer.forEach((id, i) => m.set(id, i - layer.length / 2));
    return m;
  };
  // Barycentre sweeps reduce crossings.
  for (let sweep = 0; sweep < 6; sweep++) {
    const p = pos();
    const downward = sweep % 2 === 0;
    const range = downward ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const r of range) {
      const key = new Map<string, number>();
      for (const id of layers[r]) {
        const nb = downward ? down.filter((e) => e.to === id).map((e) => e.from) : down.filter((e) => e.from === id).map((e) => e.to);
        const xs = nb.map((n) => p.get(n)).filter((x): x is number => x !== undefined);
        key.set(id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : p.get(id)!);
      }
      layers[r].sort((a, b) => key.get(a)! - key.get(b)!);
    }
  }
  // Spouses side by side.
  for (const layer of layers) {
    for (const s of same) {
      const a = layer.indexOf(s.from);
      const b = layer.indexOf(s.to);
      if (a === -1 || b === -1 || Math.abs(a - b) === 1) continue;
      layer.splice(b, 1);
      layer.splice(layer.indexOf(s.from) + 1, 0, s.to);
    }
  }

  const widest = Math.max(1, ...layers.map((l) => l.length));
  const nodes = new Map<string, Placed>();
  const stepAcross = (opts.horizontal ? opts.nodeH : opts.nodeW) + opts.gapX;
  const stepAlong = (opts.horizontal ? opts.nodeW : opts.nodeH) + opts.gapY;
  layers.forEach((layer, r) => {
    const offset = ((widest - layer.length) * stepAcross) / 2;
    layer.forEach((id, i) => {
      const across = offset + i * stepAcross;
      const along = r * stepAlong;
      nodes.set(id, opts.horizontal ? { id, x: along, y: across, rank: r } : { id, x: across, y: along, rank: r });
    });
  });
  const acrossTotal = widest * stepAcross - opts.gapX;
  const alongTotal = layers.length * stepAlong - opts.gapY;
  return { nodes, width: opts.horizontal ? alongTotal : acrossTotal, height: opts.horizontal ? acrossTotal : alongTotal };
}

/** Everything reachable from `root` within `depth` steps (ignoring direction). */
export function neighbourhood(root: string | undefined, edges: LEdge[], depth: number, all: string[]): string[] {
  if (!root) return all;
  const seen = new Set([root]);
  let frontier = [root];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edges) {
        const other = e.from === id ? e.to : e.to === id ? e.from : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Radial layout: the root in the centre, its connections on rings. Without a root, everyone on one circle. */
export function radialLayout(root: string | undefined, ids: string[], edges: LEdge[]): { pos: Map<string, { x: number; y: number }>; size: number } {
  const pos = new Map<string, { x: number; y: number }>();
  if (!root) {
    const r = Math.max(180, ids.length * 22);
    ids.forEach((id, i) => {
      const a = (i / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
      pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    });
    return { pos, size: r * 2 + 260 };
  }
  pos.set(root, { x: 0, y: 0 });
  const adj = (id: string) => edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  const ring1 = [...new Set(adj(root))].filter((id) => ids.includes(id));
  const r1 = Math.max(240, ring1.length * 30);
  const angle = new Map<string, number>();
  ring1.forEach((id, i) => {
    const a = (i / Math.max(1, ring1.length)) * Math.PI * 2 - Math.PI / 2;
    angle.set(id, a);
    pos.set(id, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 });
  });
  const rest = ids.filter((id) => !pos.has(id));
  // Second ring: each node near the first-ring node it hangs from.
  const parentAngle = (id: string) => {
    const ps = adj(id).filter((p) => angle.has(p));
    return ps.length ? ps.map((p) => angle.get(p)!).reduce((a, b) => a + b, 0) / ps.length : 0;
  };
  rest.sort((a, b) => parentAngle(a) - parentAngle(b));
  const r2 = r1 + Math.max(150, rest.length * 12);
  rest.forEach((id, i) => {
    // Few outer nodes: sit just outside the node they connect to. Many: spread evenly (already sorted by parent).
    const even = (i / Math.max(1, rest.length)) * Math.PI * 2 - Math.PI / 2;
    const a = rest.length <= 8 ? parentAngle(id) + ((i % 3) - 1) * 0.22 : even;
    pos.set(id, { x: Math.cos(a) * r2, y: Math.sin(a) * r2 });
  });
  return { pos, size: (rest.length ? r2 : r1) * 2 + 260 };
}
