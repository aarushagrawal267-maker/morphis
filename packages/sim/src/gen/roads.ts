/**
 * Road network generation.
 *
 * 1. Lay down road "strokes" (polylines with a class and a name): an expressway
 *    ring, a jittered avenue grid broken by the central plaza ring, diagonal
 *    boulevards, and district-dependent secondary streets (straight, curved or
 *    absent for large industrial blocks).
 * 2. Planarise the strokes into a graph (split at intersections, merge nearby
 *    nodes, prune stubs, keep the largest connected component).
 * 3. Derive intersection geometry: sorted incident edges, sidewalk corners,
 *    stop-line setbacks, signal placement and signal groups.
 */
import type { RoadClass, RoadEdge, RoadNode, Vec2 } from '@morphis/shared';
import { ROAD_CLASSES, roadWidth } from '@morphis/shared';
import { Rng } from '../core/rng';
import { angleOf, dist, lineIntersection, norm, perp, segmentIntersection, sub } from '../core/geom';

export interface Stroke {
  pts: Vec2[];
  cls: RoadClass;
  name: string;
}

export interface RoadLayout {
  half: number;
  ringRadius: number;
  xAvenues: number[];
  zAvenues: number[];
}

const NS_NAMES = ['Nova Avenue', 'Helix Avenue', 'Quantum Avenue', 'Vector Avenue'];
const EW_NAMES = ['Aurora Boulevard', 'Circuit Avenue', 'Photon Avenue', 'Ember Avenue'];
const STREET_WORDS = [
  'Cobalt', 'Argon', 'Lattice', 'Tensor', 'Signal', 'Pixel', 'Kernel', 'Cipher', 'Orbit', 'Prism',
  'Flux', 'Echo', 'Ion', 'Relay', 'Synapse', 'Vertex', 'Nimbus', 'Zenith', 'Quasar', 'Pulse',
  'Halo', 'Glyph', 'Matrix', 'Lantern', 'Chrome', 'Static', 'Ether', 'Binary', 'Radiant', 'Photon',
  'Carbon', 'Silica', 'Plasma', 'Helios', 'Lumen', 'Arc', 'Cinder', 'Delta', 'Gamma', 'Sigma',
];

export function generateStrokes(rng: Rng, size: number, roadDensity: number): { strokes: Stroke[]; layout: RoadLayout } {
  const half = size / 2;
  const H = half - 10; // expressway ring
  const R = 19; // plaza ring radius
  const strokes: Stroke[] = [];
  let streetNo = 0;
  const streetName = (kind: string): string => `${STREET_WORDS[streetNo++ % STREET_WORDS.length]} ${kind}`;

  // --- expressway ring (rounded square) + exits beyond the visible city
  const cr = 16;
  const ring: Vec2[] = [];
  const corners: [number, number, number][] = [
    [H - cr, -H + cr, -Math.PI / 2],
    [H - cr, H - cr, 0],
    [-H + cr, H - cr, Math.PI / 2],
    [-H + cr, -H + cr, Math.PI],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (i / 5) * (Math.PI / 2);
      ring.push({ x: cx + Math.cos(a) * cr, z: cz + Math.sin(a) * cr });
    }
  }
  ring.push({ ...ring[0] });
  strokes.push({ pts: ring, cls: 'highway', name: 'Morphis Ring Expressway' });
  // expressways end at the island's sky-lift portals
  const far = half + 9;
  strokes.push({ pts: [{ x: 0, z: -H }, { x: 0, z: -far }], cls: 'highway', name: 'North Expressway' });
  strokes.push({ pts: [{ x: 0, z: H }, { x: 0, z: far }], cls: 'highway', name: 'South Expressway' });
  strokes.push({ pts: [{ x: H, z: 6 }, { x: far, z: 6 }], cls: 'highway', name: 'East Expressway' });
  strokes.push({ pts: [{ x: -H, z: 6 }, { x: -far, z: 6 }], cls: 'highway', name: 'West Expressway' });

  // --- plaza ring
  const plaza: Vec2[] = [];
  const PS = 16;
  for (let i = 0; i <= PS; i++) {
    const a = (i / PS) * Math.PI * 2;
    plaza.push({ x: Math.cos(a) * R, z: Math.sin(a) * R });
  }
  strokes.push({ pts: plaza, cls: 'avenue', name: 'Command Circle' });

  // --- avenue grid
  const jit = (): number => Math.round(rng.range(-2.5, 2.5) * 2) / 2;
  const xs = [-88 + jit(), -34 + jit(), 34 + jit(), 88 + jit()].map((v) => (v * half) / 128);
  const zs = [-88 + jit(), -34 + jit(), 34 + jit(), 88 + jit()].map((v) => (v * half) / 128);
  xs.forEach((x, i) => strokes.push({ pts: [{ x, z: -H }, { x, z: H }], cls: 'avenue', name: NS_NAMES[i] }));
  zs.forEach((z, i) => strokes.push({ pts: [{ x: -H, z }, { x: H, z }], cls: 'avenue', name: EW_NAMES[i] }));
  strokes.push({ pts: [{ x: 0, z: -H }, { x: 0, z: -R }], cls: 'avenue', name: 'Meridian Way North' });
  strokes.push({ pts: [{ x: 0, z: R }, { x: 0, z: H }], cls: 'avenue', name: 'Meridian Way South' });
  strokes.push({ pts: [{ x: -H, z: 0 }, { x: -R, z: 0 }], cls: 'avenue', name: 'Central Axis West' });
  strokes.push({ pts: [{ x: R, z: 0 }, { x: H, z: 0 }], cls: 'avenue', name: 'Central Axis East' });

  // --- diagonal boulevards
  const d = R * Math.SQRT1_2;
  const diagEnd = H - cr * (1 - Math.SQRT1_2) - 0.5;
  const diagonals: Stroke[] = [
    { pts: [{ x: -d, z: -d }, { x: -diagEnd, z: -diagEnd }], cls: 'avenue', name: 'Lantern Boulevard' },
    { pts: [{ x: d, z: d }, { x: diagEnd, z: diagEnd }], cls: 'avenue', name: 'Foundry Way' },
  ];
  strokes.push(...diagonals);

  // --- secondary streets per superblock cell
  const xb = [-H, xs[0], xs[1], 0, xs[2], xs[3], H];
  const zb = [-H, zs[0], zs[1], 0, zs[2], zs[3], H];
  const crossesDiagonal = (x0: number, x1: number, z0: number, z1: number): boolean =>
    diagonals.some((s) => {
      const [a, b] = s.pts;
      const box: Vec2[] = [
        { x: x0, z: z0 },
        { x: x1, z: z0 },
        { x: x1, z: z1 },
        { x: x0, z: z1 },
      ];
      for (let i = 0; i < 4; i++) if (segmentIntersection(a, b, box[i], box[(i + 1) % 4])) return true;
      return false;
    });

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x0 = xb[i];
      const x1 = xb[i + 1];
      const z0 = zb[j];
      const z1 = zb[j + 1];
      const w = x1 - x0;
      const h = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (Math.hypot(cx, cz) < 40) continue; // downtown core keeps compact blocks
      if (crossesDiagonal(x0, x1, z0, z1)) continue;
      const west = cx < -60;
      const southEast = cz > 60 && cx > 0;
      if (southEast && rng.chance(0.65)) continue; // big industrial / utility blocks
      const density = roadDensity;
      const splitX = w > 44 && rng.chance(0.6 * density);
      const splitZ = h > 44 && rng.chance(0.45 * density);
      const sx = cx + rng.range(-4, 4);
      const sz = cz + rng.range(-4, 4);
      if (splitX) {
        // N-S street across the cell
        if (west && rng.chance(0.7)) {
          const pts: Vec2[] = [];
          const amp = rng.range(2.5, 5);
          const ph = rng.range(0, Math.PI * 2);
          for (let k = 0; k <= 8; k++) {
            const t = k / 8;
            const z = z0 + h * t;
            const ease = Math.sin(t * Math.PI);
            pts.push({ x: sx + Math.sin(t * Math.PI * 1.6 + ph) * amp * ease, z });
          }
          strokes.push({ pts, cls: 'local', name: streetName('Lane') });
        } else if (splitZ && rng.chance(0.3)) {
          // half street ending in a T junction
          strokes.push({ pts: [{ x: sx, z: z0 }, { x: sx, z: sz }], cls: 'street', name: streetName('Street') });
        } else {
          strokes.push({ pts: [{ x: sx, z: z0 }, { x: sx, z: z1 }], cls: 'street', name: streetName('Street') });
        }
      }
      if (splitZ) {
        if (west && rng.chance(0.6)) {
          const pts: Vec2[] = [];
          const amp = rng.range(2.5, 5);
          const ph = rng.range(0, Math.PI * 2);
          for (let k = 0; k <= 8; k++) {
            const t = k / 8;
            const x = x0 + w * t;
            const ease = Math.sin(t * Math.PI);
            pts.push({ x, z: sz + Math.sin(t * Math.PI * 1.6 + ph) * amp * ease });
          }
          strokes.push({ pts, cls: 'local', name: streetName('Lane') });
        } else {
          strokes.push({ pts: [{ x: x0, z: sz }, { x: x1, z: sz }], cls: 'street', name: streetName('Street') });
        }
      }
    }
  }

  return { strokes, layout: { half, ringRadius: R, xAvenues: xs, zAvenues: zs } };
}

// ------------------------------------------------------------------ planarise

interface Seg {
  a: Vec2;
  b: Vec2;
  stroke: number;
  splits: number[];
}

const CLASS_RANK: Record<RoadClass, number> = { highway: 3, avenue: 2, street: 1, local: 0 };

export function planarise(strokes: Stroke[]): { nodes: RoadNode[]; edges: RoadEdge[] } {
  // extend free stroke ends slightly so T-junctions intersect robustly
  const segs: Seg[] = [];
  strokes.forEach((s, si) => {
    const pts = s.pts.map((p) => ({ ...p }));
    const closed = dist(pts[0], pts[pts.length - 1]) < 0.01;
    if (!closed) {
      const d0 = norm(sub(pts[0], pts[1]));
      pts[0] = { x: pts[0].x + d0.x * 1.2, z: pts[0].z + d0.z * 1.2 };
      const n = pts.length;
      const d1 = norm(sub(pts[n - 1], pts[n - 2]));
      pts[n - 1] = { x: pts[n - 1].x + d1.x * 1.2, z: pts[n - 1].z + d1.z * 1.2 };
    }
    for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], stroke: si, splits: [0, 1] });
  });

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.stroke === s2.stroke && Math.abs(i - j) <= 1) continue;
      const hit = segmentIntersection(s1.a, s1.b, s2.a, s2.b);
      if (hit) {
        s1.splits.push(hit.t);
        s2.splits.push(hit.u);
      }
    }
  }

  // node merging via grid hash
  const nodes: { x: number; z: number }[] = [];
  const grid = new Map<string, number[]>();
  const EPS = 1.0;
  const key = (x: number, z: number): string => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  const nodeAt = (p: Vec2): number => {
    const gx = Math.floor(p.x / 4);
    const gz = Math.floor(p.z / 4);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(`${gx + dx},${gz + dz}`);
        if (!list) continue;
        for (const id of list) if (Math.hypot(nodes[id].x - p.x, nodes[id].z - p.z) < EPS) return id;
      }
    const id = nodes.length;
    nodes.push({ x: p.x, z: p.z });
    const k = key(p.x, p.z);
    const l = grid.get(k);
    if (l) l.push(id);
    else grid.set(k, [id]);
    return id;
  };

  type E = { a: number; b: number; stroke: number };
  let edges: E[] = [];
  const seen = new Set<string>();
  for (const s of segs) {
    const ts = [...new Set(s.splits.map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
    let prev = nodeAt({ x: s.a.x + (s.b.x - s.a.x) * ts[0], z: s.a.z + (s.b.z - s.a.z) * ts[0] });
    for (let k = 1; k < ts.length; k++) {
      const p = { x: s.a.x + (s.b.x - s.a.x) * ts[k], z: s.a.z + (s.b.z - s.a.z) * ts[k] };
      const cur = nodeAt(p);
      if (cur !== prev) {
        const ek = prev < cur ? `${prev}-${cur}` : `${cur}-${prev}`;
        if (!seen.has(ek)) {
          seen.add(ek);
          edges.push({ a: prev, b: cur, stroke: s.stroke });
        }
      }
      prev = cur;
    }
  }

  // gates: the outermost stroke ends (expressway exits to the sky lifts)
  let extent = 0;
  for (const st of strokes) for (const p of st.pts) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.z));
  const isGate = (id: number): boolean => Math.max(Math.abs(nodes[id].x), Math.abs(nodes[id].z)) > extent - 1;

  // collapse very short edges (merge their endpoints) and prune dangling stubs
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    const deg = new Map<number, number>();
    for (const e of edges) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const remap = new Map<number, number>();
    const keep: E[] = [];
    for (const e of edges) {
      if (remap.has(e.a) || remap.has(e.b)) {
        keep.push(e);
        continue;
      }
      const l = Math.hypot(nodes[e.a].x - nodes[e.b].x, nodes[e.a].z - nodes[e.b].z);
      const da = deg.get(e.a) ?? 0;
      const db = deg.get(e.b) ?? 0;
      if ((da === 1 || db === 1) && l < 3 && !isGate(e.a) && !isGate(e.b)) {
        changed = true; // drop stub
        continue;
      }
      if (l < 4.5 && da > 1 && db > 1) {
        // merge b into a at midpoint
        nodes[e.a] = { x: (nodes[e.a].x + nodes[e.b].x) / 2, z: (nodes[e.a].z + nodes[e.b].z) / 2 };
        remap.set(e.b, e.a);
        changed = true;
        continue;
      }
      keep.push(e);
    }
    const dedupe = new Set<string>();
    edges = [];
    for (const e of keep) {
      const a = remap.get(e.a) ?? e.a;
      const b = remap.get(e.b) ?? e.b;
      if (a === b) continue;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (dedupe.has(k)) continue;
      dedupe.add(k);
      edges.push({ a, b, stroke: e.stroke });
    }
    if (!changed) break;
  }

  // largest connected component
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  let best: Set<number> = new Set();
  const visited = new Set<number>();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const comp = new Set<number>([start]);
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) {
        if (!visited.has(m)) {
          visited.add(m);
          comp.add(m);
          stack.push(m);
        }
      }
    }
    if (comp.size > best.size) best = comp;
  }
  edges = edges.filter((e) => best.has(e.a) && best.has(e.b));

  // re-index
  const idMap = new Map<number, number>();
  const outNodes: RoadNode[] = [];
  const sortedIds = [...best].sort((p, q) => nodes[p].z - nodes[q].z || nodes[p].x - nodes[q].x);
  for (const old of sortedIds) {
    idMap.set(old, outNodes.length);
    outNodes.push({
      id: outNodes.length,
      x: round(nodes[old].x),
      z: round(nodes[old].z),
      signal: false,
      edges: [],
      radius: 0,
      gate: isGate(old),
    });
  }
  const outEdges: RoadEdge[] = edges
    .map((e) => {
      const s = strokes[e.stroke];
      const c = ROAD_CLASSES[s.cls];
      const a = idMap.get(e.a)!;
      const b = idMap.get(e.b)!;
      return {
        id: 0,
        a: Math.min(a, b),
        b: Math.max(a, b),
        cls: s.cls,
        lanes: c.lanes,
        width: roadWidth(s.cls),
        sidewalk: c.sidewalk,
        median: c.median,
        length: 0,
        speedLimit: c.speed,
        name: s.name,
        groupA: 0,
        groupB: 0,
        setbackA: 0,
        setbackB: 0,
      };
    })
    .sort((p, q) => p.a - q.a || p.b - q.b);
  outEdges.forEach((e, i) => {
    e.id = i;
    const na = outNodes[e.a];
    const nb = outNodes[e.b];
    e.length = round(Math.hypot(na.x - nb.x, na.z - nb.z));
    na.edges.push(i);
    nb.edges.push(i);
  });
  return { nodes: outNodes, edges: outEdges };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ------------------------------------------------------------------ intersection geometry

/** Unit direction of edge e leaving node n. */
export function edgeDirFrom(nodes: RoadNode[], e: RoadEdge, n: number): Vec2 {
  const from = nodes[n];
  const to = nodes[e.a === n ? e.b : e.a];
  return norm(sub(to, from));
}

/** Offset of the sidewalk centre line from the road centre line. */
export function sidewalkOffset(e: RoadEdge): number {
  return e.width / 2 + Math.max(e.sidewalk, 1.0) / 2;
}

/**
 * Sidewalk corner points per node. corners[n][i] is the corner between incident
 * edge i and incident edge i+1 (counter-clockwise in atan2(z,x) order), i.e. on the
 * "+perp" side of edge i and the "-perp" side of edge i+1.
 * For dead ends, `capPlus/capMinus` hold the two kerb-side corners.
 */
export interface CornerSet {
  corners: Vec2[];
  capPlus?: Vec2;
  capMinus?: Vec2;
}

export function finaliseIntersections(nodes: RoadNode[], edges: RoadEdge[]): CornerSet[] {
  const sets: CornerSet[] = [];
  for (const n of nodes) {
    n.edges.sort((p, q) => angleOf(edgeDirFrom(nodes, edges[p], n.id)) - angleOf(edgeDirFrom(nodes, edges[q], n.id)));
    const k = n.edges.length;
    const set: CornerSet = { corners: [] };
    if (k === 1) {
      const e = edges[n.edges[0]];
      const d = edgeDirFrom(nodes, e, n.id);
      const p = perp(d);
      const off = sidewalkOffset(e);
      set.capPlus = { x: n.x + p.x * off, z: n.z + p.z * off };
      set.capMinus = { x: n.x - p.x * off, z: n.z - p.z * off };
      set.corners = [set.capPlus];
    } else {
      for (let i = 0; i < k; i++) {
        const e1 = edges[n.edges[i]];
        const e2 = edges[n.edges[(i + 1) % k]];
        const d1 = edgeDirFrom(nodes, e1, n.id);
        const d2 = edgeDirFrom(nodes, e2, n.id);
        const o1 = sidewalkOffset(e1);
        const o2 = sidewalkOffset(e2);
        let ang = angleOf(d2) - angleOf(d1);
        while (ang <= 0) ang += Math.PI * 2;
        const p1 = perp(d1);
        const p2 = perp(d2);
        let c: Vec2 | null = null;
        if (ang < Math.PI * 0.92) {
          c = lineIntersection(
            { x: n.x + p1.x * o1, z: n.z + p1.z * o1 },
            d1,
            { x: n.x - p2.x * o2, z: n.z - p2.z * o2 },
            d2,
          );
        }
        if (!c || Math.hypot(c.x - n.x, c.z - n.z) > 3 * Math.max(o1, o2) + 4) {
          // straight-through or reflex: use the averaged normal offset
          const bis = norm({ x: p1.x - p2.x, z: p1.z - p2.z });
          const o = (o1 + o2) / 2;
          c = { x: n.x + bis.x * o, z: n.z + bis.z * o };
        }
        set.corners.push({ x: round(c.x), z: round(c.z) });
      }
    }
    sets.push(set);
  }

  // setbacks: stop line just beyond the crosswalk at intersections (degree >= 3)
  for (const e of edges) {
    for (const end of ['a', 'b'] as const) {
      const nid = e[end];
      const n = nodes[nid];
      const k = n.edges.length;
      let setback = 0;
      if (k >= 3) {
        const idx = n.edges.indexOf(e.id);
        const d = edgeDirFrom(nodes, e, nid);
        const cPlus = sets[nid].corners[idx];
        const cMinus = sets[nid].corners[(idx - 1 + k) % k];
        const proj = (c: Vec2): number => (c.x - n.x) * d.x + (c.z - n.z) * d.z;
        setback = Math.max(proj(cPlus), proj(cMinus), 0) + 1.6;
        setback = Math.min(setback, e.length * 0.42);
      } else if (k === 2) {
        setback = 0;
      }
      if (end === 'a') e.setbackA = round(setback);
      else e.setbackB = round(setback);
    }
  }
  for (const n of nodes) {
    let r = 0;
    for (const eid of n.edges) {
      const e = edges[eid];
      r = Math.max(r, e.a === n.id ? e.setbackA : e.setbackB);
    }
    n.radius = round(r);
  }

  // signals + signal groups
  for (const n of nodes) {
    const k = n.edges.length;
    if (k < 3 || n.gate) continue;
    const ranks = n.edges.map((id) => CLASS_RANK[edges[id].cls]);
    const majors = ranks.filter((r) => r >= 2).length;
    const onRoundabout = n.edges.some((id) => edges[id].name === 'Command Circle');
    n.signal = !onRoundabout && (majors >= 2 || (k >= 4 && majors >= 1));
    // group by axis: edges within ~40° (mod 180°) of the highest ranked edge share group 0
    const lead = n.edges.reduce((best, id) => (CLASS_RANK[edges[id].cls] > CLASS_RANK[edges[best].cls] ? id : best), n.edges[0]);
    const leadAng = angleOf(edgeDirFrom(nodes, edges[lead], n.id));
    for (const id of n.edges) {
      const e = edges[id];
      let da = Math.abs(angleOf(edgeDirFrom(nodes, e, n.id)) - leadAng) % Math.PI;
      if (da > Math.PI / 2) da = Math.PI - da;
      const g = da < (40 * Math.PI) / 180 ? 0 : 1;
      if (e.a === n.id) e.groupA = g;
      else e.groupB = g;
    }
  }
  // thin out signals on very short links: keep the busier intersection
  for (const e of edges) {
    if (e.length >= 16) continue;
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (a.signal && b.signal) {
      const weight = (n: RoadNode): number => n.edges.reduce((acc, id) => acc + CLASS_RANK[edges[id].cls], 0) + n.edges.length;
      if (weight(a) >= weight(b)) b.signal = false;
      else a.signal = false;
    }
  }
  return sets;
}
