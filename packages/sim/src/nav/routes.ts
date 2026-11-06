/**
 * Route geometry. Walking routes follow sidewalk/crosswalk polylines. Driving
 * routes follow lane centre lines (right-hand traffic) joined by Bézier turn
 * curves through intersections. Each route records "legs" so the traffic model
 * knows which lane / intersection a vehicle occupies at any distance s.
 */
import type { PedEdge, PedNode, RoadEdge, RoadNode, RouteData, Vec2 } from '@morphis/shared';
import { LANE_WIDTH } from '@morphis/shared';
import type { CrossLeg, DriveLeg } from '../state';
import { polylineCum } from '../core/geom';
import type { PedNav, RoadNav, Traversal } from './graphs';

export interface RoadPos {
  edge: number;
  /** Distance from node a. */
  s: number;
  /** +1: right-hand side when travelling a -> b. */
  side: 1 | -1;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export function makeRoute(id: number, pts: number[]): RouteData {
  // drop consecutive duplicates
  const clean: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = clean.length;
    if (n && Math.hypot(pts[i] - clean[n - 2], pts[i + 1] - clean[n - 1]) < 0.02) continue;
    clean.push(round(pts[i]), round(pts[i + 1]));
  }
  if (clean.length === 2) clean.push(clean[0] + 0.01, clean[1]);
  const cum = polylineCum(clean).map(round);
  return { id, points: clean, cum, length: cum[cum.length - 1] };
}

// ------------------------------------------------------------------ walking

export function buildWalk(
  nav: PedNav,
  nodes: PedNode[],
  edges: PedEdge[],
  from: number,
  to: number,
  id: number,
): { route: RouteData; crossings: CrossLeg[] } | null {
  const path = nav.route(from, to);
  if (!path) return null;
  const pts: number[] = [nodes[from].x, nodes[from].z];
  const crossings: CrossLeg[] = [];
  let s = 0;
  for (const step of path) {
    const e = edges[step.edge];
    const b = nodes[step.to];
    const a = nodes[step.from];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (e.kind === 'crosswalk' && e.roadNode !== undefined && e.crossesEdge !== undefined) {
      crossings.push({ s0: round(s), s1: round(s + l), pedEdge: e.id, node: e.roadNode, crosses: e.crossesEdge });
    }
    s += l;
    pts.push(b.x, b.z);
  }
  return { route: makeRoute(id, pts), crossings };
}

// ------------------------------------------------------------------ driving

export class DriveRouter {
  constructor(
    private nodes: RoadNode[],
    private edges: RoadEdge[],
    private nav: RoadNav,
  ) {}

  private dirVec(e: RoadEdge): Vec2 {
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  /** Point on the lane centre line: t = distance along travel direction from the start node. */
  lanePoint(edge: number, dir: 0 | 1, lane: number, t: number): Vec2 {
    const e = this.edges[edge];
    const u = this.dirVec(e);
    const off = e.median / 2 + (lane + 0.5) * LANE_WIDTH;
    const s = dir === 0 ? t : e.length - t;
    const side = dir === 0 ? 1 : -1;
    const a = this.nodes[e.a];
    // perp(u) = (-u.z, u.x) is the right-hand side for a -> b
    return { x: a.x + u.x * s + -u.z * side * off, z: a.z + u.z * s + u.x * side * off };
  }

  travelDir(edge: number, dir: 0 | 1): Vec2 {
    const u = this.dirVec(this.edges[edge]);
    return dir === 0 ? u : { x: -u.x, z: -u.z };
  }

  startSetback(edge: number, dir: 0 | 1): number {
    const e = this.edges[edge];
    return dir === 0 ? e.setbackA : e.setbackB;
  }

  endSetback(edge: number, dir: 0 | 1): number {
    const e = this.edges[edge];
    return dir === 0 ? e.setbackB : e.setbackA;
  }

  endNode(edge: number, dir: 0 | 1): number {
    const e = this.edges[edge];
    return dir === 0 ? e.b : e.a;
  }

  startNode(edge: number, dir: 0 | 1): number {
    const e = this.edges[edge];
    return dir === 0 ? e.a : e.b;
  }

  /**
   * Plan a drive between two kerb positions. Vehicles start and finish in the
   * kerb lane on the side of their building and never U-turn mid-block.
   */
  plan(id: number, from: RoadPos, to: RoadPos, salt: number, extraCost?: (edge: number) => number): { route: RouteData; legs: DriveLeg[] } | null {
    const dirFrom: 0 | 1 = from.side === 1 ? 0 : 1;
    const dirTo: 0 | 1 = to.side === 1 ? 0 : 1;
    const eF = this.edges[from.edge];
    const eT = this.edges[to.edge];
    const tFrom = dirFrom === 0 ? from.s : eF.length - from.s;
    const tTo = dirTo === 0 ? to.s : eT.length - to.s;

    let trav: Traversal[];
    if (from.edge === to.edge && dirFrom === dirTo && tTo > tFrom + 2) {
      trav = [{ edge: from.edge, dir: dirFrom }];
    } else {
      const startNode = this.endNode(from.edge, dirFrom);
      const goalNode = this.startNode(to.edge, dirTo);
      const exclude = new Set<number>([from.edge, to.edge]);
      let mid = this.nav.route(startNode, goalNode, { exclude, extraCost });
      if (!mid) {
        // allow re-using the start/end edges (U-turn at a node) if there is no alternative
        mid = this.nav.route(startNode, goalNode, { extraCost });
        if (!mid) return null;
      }
      trav = [{ edge: from.edge, dir: dirFrom }, ...mid, { edge: to.edge, dir: dirTo }];
    }

    // lane choice per traversal from the upcoming turn
    const lanes: number[] = trav.map((t, i) => {
      const e = this.edges[t.edge];
      if (e.lanes <= 1) return 0;
      if (i === 0 || i === trav.length - 1) return e.lanes - 1;
      const next = trav[i + 1];
      const d1 = this.travelDir(t.edge, t.dir);
      const d2 = this.travelDir(next.edge, next.dir);
      const cr = d1.x * d2.z - d1.z * d2.x;
      if (cr > 0.35) return e.lanes - 1; // right turn -> kerb lane
      if (cr < -0.35) return 0; // left turn -> inner lane
      return (salt + t.edge) % e.lanes;
    });

    const pts: number[] = [];
    const legs: DriveLeg[] = [];
    let s = 0;
    const push = (p: Vec2): void => {
      const n = pts.length;
      if (n) s += Math.hypot(p.x - pts[n - 2], p.z - pts[n - 1]);
      pts.push(p.x, p.z);
    };

    for (let i = 0; i < trav.length; i++) {
      const t = trav[i];
      const e = this.edges[t.edge];
      const lane = lanes[i];
      let t0 = this.startSetback(t.edge, t.dir);
      let t1 = e.length - this.endSetback(t.edge, t.dir);
      if (i === 0) t0 = Math.min(Math.max(tFrom, t0), t1 - 0.5);
      if (i === trav.length - 1) t1 = Math.max(Math.min(tTo, t1), t0 + 0.5);
      if (t1 < t0) t1 = t0;
      const legStart = s;
      if (i === 0) {
        // start at the kerb
        push(this.lanePoint(t.edge, t.dir, e.lanes - 1, t0));
      } else {
        // turn curve from previous lane end into this lane start
        const prev = trav[i - 1];
        const pe = this.edges[prev.edge];
        const p1 = this.lanePoint(prev.edge, prev.dir, lanes[i - 1], pe.length - this.endSetback(prev.edge, prev.dir));
        const p2 = this.lanePoint(t.edge, t.dir, lane, t0);
        const node = this.endNode(prev.edge, prev.dir);
        const turnStart = s;
        const gap = Math.hypot(p2.x - p1.x, p2.z - p1.z);
        if (gap > 0.6) {
          const d1 = this.travelDir(prev.edge, prev.dir);
          const d2 = this.travelDir(t.edge, t.dir);
          const den = d1.x * d2.z - d1.z * d2.x;
          let c: Vec2 = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
          if (Math.abs(den) > 0.05) {
            const k = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / den;
            if (k > 0 && k < gap * 1.5) c = { x: p1.x + d1.x * k, z: p1.z + d1.z * k };
          }
          for (let j = 1; j <= 6; j++) {
            const u = j / 6;
            const a = (1 - u) * (1 - u);
            const b = 2 * (1 - u) * u;
            const cc = u * u;
            push({ x: a * p1.x + b * c.x + cc * p2.x, z: a * p1.z + b * c.z + cc * p2.z });
          }
        } else {
          push(p2);
        }
        if (s - turnStart > 0.01) {
          legs.push({ kind: 'turn', s0: round(turnStart), s1: round(s), t0: 0, edge: t.edge, dir: t.dir, lane, node, key: `n${node}` });
        }
      }
      const laneStart = s;
      // sample long curved lanes are straight per edge; one segment is enough
      const end = i === trav.length - 1 ? this.lanePoint(t.edge, t.dir, e.lanes - 1, t1) : this.lanePoint(t.edge, t.dir, lane, t1);
      push(end);
      legs.push({
        kind: 'lane',
        s0: round(i === 0 ? legStart : laneStart),
        s1: round(s),
        t0: round(t0 - this.startSetback(t.edge, t.dir)),
        edge: t.edge,
        dir: t.dir,
        lane,
        node: this.endNode(t.edge, t.dir),
        key: `${t.edge}:${t.dir}:${lane}`,
      });
    }
    const route = makeRoute(id, pts);
    // keep legs consistent with rounded cumulative length
    if (legs.length) legs[legs.length - 1].s1 = route.length;
    return { route, legs };
  }
}
