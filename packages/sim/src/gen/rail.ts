/**
 * Skyrail: an elevated maglev loop that runs above the avenues, linking six
 * stations near major landmarks. The track follows road centre lines (so it
 * never cuts through a building), with rounded corners. Each station has a
 * stair tower at a street corner, joined to the pedestrian network.
 */
import type { BuildingDef, PedNode, RailLine, RailStation, RoadEdge, RoadNode } from '@morphis/shared';
import { pointSegmentDistance, polylineCum } from '../core/geom';
import type { RoadNav, Traversal } from '../nav/graphs';

export const RAIL_HEIGHT = 13;

const STATION_KEYS = ['station', 'university', 'ai_lab', 'hospital', 'arena', 'skyline', 'market', 'cityhall', 'forge', 'orbital'];

/** "MORPHIS CENTRAL STATION" -> "Central Station", "NEON MARKET" -> "Neon Market Station". */
function stationName(building: string): string {
  const words = building
    .replace(/^MORPHIS\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
  const base = words.join(' ').replace(/\s+(Tower|Building|Complex|Campus|Residences)$/i, '');
  return /station$/i.test(base) ? base : `${base} Station`;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildRail(
  nodes: RoadNode[],
  edges: RoadEdge[],
  nav: RoadNav,
  landmarks: Record<string, string>,
  buildings: BuildingDef[],
  pedNodes: PedNode[],
  nodeNear: (id: string | undefined) => number,
): RailLine | undefined {
  // waypoints: landmark road nodes, ordered by angle around the city centre, well spread
  const cand: { key: string; node: number; angle: number; name: string }[] = [];
  for (const key of STATION_KEYS) {
    const id = landmarks[key];
    if (!id) continue;
    const node = nodeNear(id);
    const n = nodes[node];
    const r = Math.hypot(n.x, n.z);
    if (r < 35) continue;
    if (cand.some((c) => c.node === node)) continue;
    const b = buildings.find((x) => x.id === id)!;
    cand.push({ key, node, angle: Math.atan2(n.z, n.x), name: b.name });
  }
  cand.sort((a, b) => a.angle - b.angle);
  const picked: typeof cand = [];
  for (const c of cand) {
    if (picked.some((p) => Math.abs(Math.atan2(Math.sin(p.angle - c.angle), Math.cos(p.angle - c.angle))) < 0.55)) continue;
    picked.push(c);
    if (picked.length >= 6) break;
  }
  if (picked.length < 4) return undefined;

  // route between consecutive waypoints over avenues/streets (no highways, no reused edges)
  const used = new Set<number>();
  for (const e of edges) if (e.cls === 'highway') used.add(e.id);
  const path: Traversal[] = [];
  for (let i = 0; i < picked.length; i++) {
    const from = picked[i].node;
    const to = picked[(i + 1) % picked.length].node;
    const leg = nav.route(from, to, { exclude: used }) ?? nav.route(from, to, {});
    if (!leg) return undefined;
    for (const t of leg) used.add(t.edge);
    path.push(...leg);
  }
  // node sequence with loop erasure (a node visited twice cuts out the detour between)
  let seq: number[] = [];
  const start = path.length ? (path[0].dir === 0 ? edges[path[0].edge].a : edges[path[0].edge].b) : picked[0].node;
  seq.push(start);
  for (const t of path) {
    const e = edges[t.edge];
    const to = t.dir === 0 ? e.b : e.a;
    const seen = seq.indexOf(to);
    if (seen >= 0 && seen > 0) seq = seq.slice(0, seen + 1);
    else if (seen === 0 && seq.length > 2) break;
    else seq.push(to);
  }
  if (seq[seq.length - 1] === seq[0]) seq.pop();
  if (seq.length < 4) return undefined;

  // rounded corners
  const pts: number[] = [];
  const n = seq.length;
  for (let i = 0; i < n; i++) {
    const p = nodes[seq[i]];
    const a = nodes[seq[(i - 1 + n) % n]];
    const b = nodes[seq[(i + 1) % n]];
    const la = Math.hypot(p.x - a.x, p.z - a.z);
    const lb = Math.hypot(b.x - p.x, b.z - p.z);
    const ua = { x: (p.x - a.x) / la, z: (p.z - a.z) / la };
    const ub = { x: (b.x - p.x) / lb, z: (b.z - p.z) / lb };
    const turn = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.z * ub.z)));
    if (turn < 0.12) {
      pts.push(r2(p.x), r2(p.z));
      continue;
    }
    const cut = Math.min(7, la * 0.42, lb * 0.42);
    const p0 = { x: p.x - ua.x * cut, z: p.z - ua.z * cut };
    const p1 = { x: p.x + ub.x * cut, z: p.z + ub.z * cut };
    const steps = Math.max(3, Math.round(turn * 6));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      // quadratic Bézier with the corner as control point
      const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p.x + t * t * p1.x;
      const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p.z + t * t * p1.z;
      pts.push(r2(x), r2(z));
    }
  }
  const closed = [...pts, pts[0], pts[1]];
  const cum = polylineCum(closed).map(r2);
  const length = cum[cum.length - 1];

  const project = (x: number, z: number): { s: number; x: number; z: number; d: number } => {
    let best = { s: 0, x: closed[0], z: closed[1], d: Infinity };
    for (let i = 0; i + 3 < closed.length; i += 2) {
      const a = { x: closed[i], z: closed[i + 1] };
      const b = { x: closed[i + 2], z: closed[i + 3] };
      const r = pointSegmentDistance({ x, z }, a, b);
      if (r.d < best.d) {
        const seg = cum[i / 2 + 1] - cum[i / 2];
        best = { s: cum[i / 2] + seg * r.t, x: a.x + (b.x - a.x) * r.t, z: a.z + (b.z - a.z) * r.t, d: r.d };
      }
    }
    return best;
  };

  // stations at the waypoints that survived loop erasure, stairs at the nearest street corner
  const stations: RailStation[] = [];
  for (const w of picked) {
    const rn = nodes[w.node];
    const pr = project(rn.x, rn.z);
    if (pr.d > 12) continue;
    if (stations.some((s) => Math.abs(s.s - pr.s) < 40 || length - Math.abs(s.s - pr.s) < 40)) continue;
    let best = -1;
    let bd = Infinity;
    for (const pn of pedNodes) {
      if (pn.kind !== 'corner') continue;
      const d = Math.hypot(pn.x - pr.x, pn.z - pr.z);
      if (d < bd) {
        bd = d;
        best = pn.id;
      }
    }
    if (best < 0 || bd > 22) continue;
    stations.push({
      id: `rail_st_${stations.length}`,
      name: stationName(w.name),
      s: r2(pr.s),
      pedNode: best,
      position: { x: r2(pr.x), z: r2(pr.z) },
      access: { x: pedNodes[best].x, z: pedNodes[best].z },
    });
  }
  if (stations.length < 3) return undefined;
  stations.sort((a, b) => a.s - b.s);
  stations.forEach((s, i) => (s.id = `rail_st_${i}`));

  // pylons on the kerb beside the track, never inside a carriageway or a building
  const pylons: RailLine['pylons'] = [];
  for (let s = 6; s < length; s += 26) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
    const ax = closed[i * 2];
    const az = closed[i * 2 + 1];
    const bx = closed[i * 2 + 2];
    const bz = closed[i * 2 + 3];
    const tx = ax + (bx - ax) * t;
    const tz = az + (bz - az) * t;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const px = -(bz - az) / l;
    const pz = (bx - ax) / l;
    let placed = false;
    for (const side of [1, -1]) {
      // half the road width under the track, plus a little
      let half = 4;
      let nearest = Infinity;
      for (const e of edges) {
        const d = pointSegmentDistance({ x: tx, z: tz }, nodes[e.a], nodes[e.b]).d;
        if (d < nearest) {
          nearest = d;
          half = e.width / 2 + Math.max(0.4, e.sidewalk * 0.45);
        }
      }
      const fx = tx + px * side * half;
      const fz = tz + pz * side * half;
      const inRoad = edges.some((e) => pointSegmentDistance({ x: fx, z: fz }, nodes[e.a], nodes[e.b]).d < e.width / 2 + 0.2);
      if (inRoad) continue;
      const inBuilding = buildings.some((b) => {
        const dx = fx - b.position.x;
        const dz = fz - b.position.z;
        // inverse of localToWorld (x = lx c + lz s, z = -lx s + lz c)
        const c = Math.cos(b.rotation);
        const sn = Math.sin(b.rotation);
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        return Math.abs(lx) < b.width / 2 + 0.3 && Math.abs(lz) < b.depth / 2 + 0.3;
      });
      if (inBuilding) continue;
      pylons.push({ x: r2(fx), z: r2(fz), tx: r2(tx), tz: r2(tz) });
      placed = true;
      break;
    }
    void placed;
  }

  return {
    id: 'skyrail',
    name: 'Skyrail',
    color: '#a78bfa',
    points: pts,
    cum,
    length,
    height: RAIL_HEIGHT,
    stations,
    pylons,
  };
}
