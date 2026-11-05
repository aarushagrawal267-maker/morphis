/**
 * Pedestrian network: sidewalk corners at every intersection, sidewalk edges
 * along both sides of each road, crosswalks across each intersection leg, and
 * attachment points (building entrances, bus stops) spliced into sidewalks.
 */
import type { PedEdge, PedNode, RoadEdge, RoadNode, Vec2 } from '@morphis/shared';
import type { CornerSet } from './roads';

export interface PedAttachment {
  key: string;
  edge: number;
  side: 1 | -1;
  /** Point to project onto the sidewalk (entrance on facade or kerb point). */
  point: Vec2;
  kind: 'entrance' | 'stop';
  buildingId?: string;
  /** For parks/plazas: an inner destination point reached by a path. */
  inner?: Vec2;
}

interface SidewalkSeg {
  from: number;
  to: number;
  attachments: { t: number; key: string; att: PedAttachment }[];
}

export interface PedGraphResult {
  nodes: PedNode[];
  edges: PedEdge[];
  /** attachment key -> ped node the agent stands at (entrance/stop/park inner node). */
  attachNode: Map<string, number>;
  /** "node:edge" -> crosswalk ped edge id */
  crosswalkAt: Map<string, number>;
}

export function buildPedGraph(
  nodes: RoadNode[],
  edges: RoadEdge[],
  cornerSets: CornerSet[],
  attachments: PedAttachment[],
): PedGraphResult {
  const pn: PedNode[] = [];
  const pe: PedEdge[] = [];
  const addNode = (x: number, z: number, kind: PedNode['kind'], extra: Partial<PedNode> = {}): number => {
    pn.push({ id: pn.length, x: r3(x), z: r3(z), kind, ...extra });
    return pn.length - 1;
  };
  const addEdge = (a: number, b: number, kind: PedEdge['kind'], extra: Partial<PedEdge> = {}): number => {
    const l = Math.hypot(pn[a].x - pn[b].x, pn[a].z - pn[b].z);
    pe.push({ id: pe.length, a, b, kind, length: r3(Math.max(0.05, l)), ...extra });
    return pe.length - 1;
  };

  // corner nodes
  const cornerNode: number[][] = [];
  const capPlus: number[] = [];
  const capMinus: number[] = [];
  for (const n of nodes) {
    const set = cornerSets[n.id];
    if (n.edges.length === 1) {
      capPlus[n.id] = addNode(set.capPlus!.x, set.capPlus!.z, 'end', { roadNode: n.id });
      capMinus[n.id] = addNode(set.capMinus!.x, set.capMinus!.z, 'end', { roadNode: n.id });
      cornerNode[n.id] = [capPlus[n.id]];
    } else {
      cornerNode[n.id] = set.corners.map((c) => addNode(c.x, c.z, 'corner', { roadNode: n.id }));
    }
  }

  const walkable = (e: RoadEdge): boolean => e.cls !== 'highway' && e.sidewalk > 0;

  // sidewalk segments per edge side
  const segs = new Map<string, SidewalkSeg>();
  for (const e of edges) {
    if (!walkable(e)) continue;
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const ia = na.edges.indexOf(e.id);
    const ib = nb.edges.indexOf(e.id);
    const ka = na.edges.length;
    const kb = nb.edges.length;
    const plusA = ka === 1 ? capPlus[e.a] : cornerNode[e.a][ia];
    const minusA = ka === 1 ? capMinus[e.a] : cornerNode[e.a][(ia - 1 + ka) % ka];
    const plusB = kb === 1 ? capMinus[e.b] : cornerNode[e.b][(ib - 1 + kb) % kb];
    const minusB = kb === 1 ? capPlus[e.b] : cornerNode[e.b][ib];
    segs.set(`${e.id}:1`, { from: plusA, to: plusB, attachments: [] });
    segs.set(`${e.id}:-1`, { from: minusA, to: minusB, attachments: [] });
  }

  // project attachments
  for (const att of attachments) {
    const seg = segs.get(`${att.edge}:${att.side}`);
    if (!seg) continue;
    const a = pn[seg.from];
    const b = pn[seg.to];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    let t = ((att.point.x - a.x) * abx + (att.point.z - a.z) * abz) / l2;
    t = Math.max(0.04, Math.min(0.96, t));
    seg.attachments.push({ t, key: att.key, att });
  }

  const attachNode = new Map<string, number>();
  for (const [k, seg] of segs) {
    const edgeId = Number(k.split(':')[0]);
    seg.attachments.sort((p, q) => p.t - q.t);
    let prev = seg.from;
    const a = pn[seg.from];
    const b = pn[seg.to];
    let lastT = -1;
    let lastNode = -1;
    for (const at of seg.attachments) {
      let split: number;
      if (lastNode >= 0 && Math.abs(at.t - lastT) * Math.hypot(b.x - a.x, b.z - a.z) < 0.6) {
        split = lastNode;
      } else {
        split = addNode(a.x + (b.x - a.x) * at.t, a.z + (b.z - a.z) * at.t, at.att.kind === 'stop' ? 'stop' : 'corner');
        addEdge(prev, split, 'sidewalk', { crossesEdge: edgeId });
        prev = split;
        lastNode = split;
        lastT = at.t;
      }
      if (at.att.kind === 'stop') {
        attachNode.set(at.key, split);
      } else {
        const ent = addNode(at.att.point.x, at.att.point.z, 'entrance', { buildingId: at.att.buildingId });
        addEdge(split, ent, 'entrance');
        if (at.att.inner) {
          const inner = addNode(at.att.inner.x, at.att.inner.z, 'park', { buildingId: at.att.buildingId });
          addEdge(ent, inner, 'path');
          attachNode.set(at.key, inner);
        } else {
          attachNode.set(at.key, ent);
        }
      }
    }
    addEdge(prev, seg.to, 'sidewalk', { crossesEdge: edgeId });
  }
  // sidewalk edges carry crossesEdge only as a reference to their road; clear for clarity
  for (const e of pe) if (e.kind === 'sidewalk') delete e.crossesEdge;

  // crosswalks
  const crosswalkAt = new Map<string, number>();
  for (const n of nodes) {
    const k = n.edges.length;
    if (k >= 3) {
      for (let i = 0; i < k; i++) {
        const e = edges[n.edges[i]];
        if (e.cls === 'highway') continue;
        const c1 = cornerNode[n.id][(i - 1 + k) % k];
        const c2 = cornerNode[n.id][i];
        if (c1 === c2) continue;
        const id = addEdge(c1, c2, 'crosswalk', { roadNode: n.id, crossesEdge: e.id });
        crosswalkAt.set(`${n.id}:${e.id}`, id);
      }
    } else if (k === 1 && walkable(edges[n.edges[0]])) {
      const e = edges[n.edges[0]];
      const id = addEdge(capPlus[n.id], capMinus[n.id], 'crosswalk', { roadNode: n.id, crossesEdge: e.id });
      crosswalkAt.set(`${n.id}:${e.id}`, id);
    }
  }

  // drop nodes without edges and re-index
  const used = new Set<number>();
  for (const e of pe) {
    used.add(e.a);
    used.add(e.b);
  }
  const remap = new Map<number, number>();
  const outNodes: PedNode[] = [];
  for (const n of pn) {
    if (!used.has(n.id)) continue;
    remap.set(n.id, outNodes.length);
    outNodes.push({ ...n, id: outNodes.length });
  }
  const outEdges = pe.map((e) => ({ ...e, a: remap.get(e.a)!, b: remap.get(e.b)! }));
  const outAttach = new Map<string, number>();
  for (const [k, v] of attachNode) outAttach.set(k, remap.get(v)!);
  return { nodes: outNodes, edges: outEdges, attachNode: outAttach, crosswalkAt };
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
