/**
 * Runtime navigation graphs and A* search for vehicles (road graph) and
 * pedestrians (sidewalk graph).
 */
import type { PedEdge, PedNode, RoadEdge, RoadNode } from '@morphis/shared';
import { MinHeap } from '../core/heap';

export interface Traversal {
  edge: number;
  /** 0 = a -> b, 1 = b -> a */
  dir: 0 | 1;
}

export class RoadNav {
  readonly adj: { edge: number; to: number }[][];
  readonly maxSpeed: number;

  constructor(
    readonly nodes: RoadNode[],
    readonly edges: RoadEdge[],
  ) {
    this.adj = nodes.map(() => []);
    for (const e of edges) {
      this.adj[e.a].push({ edge: e.id, to: e.b });
      this.adj[e.b].push({ edge: e.id, to: e.a });
    }
    this.maxSpeed = Math.max(...edges.map((e) => e.speedLimit));
  }

  /**
   * Fastest route (sequence of traversals) between two road nodes.
   * `exclude` edges are never used; `extraCost` adds dynamic (congestion) cost.
   */
  route(from: number, to: number, opts: { exclude?: Set<number>; extraCost?: (edge: number) => number } = {}): Traversal[] | null {
    if (from === to) return [];
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap<number>();
    const tgt = this.nodes[to];
    const h = (i: number): number => Math.hypot(this.nodes[i].x - tgt.x, this.nodes[i].z - tgt.z) / this.maxSpeed;
    g[from] = 0;
    heap.push(from, h(from));
    while (heap.size) {
      const cur = heap.pop()!;
      if (closed[cur]) continue;
      if (cur === to) break;
      closed[cur] = 1;
      for (const { edge, to: nxt } of this.adj[cur]) {
        if (opts.exclude?.has(edge)) continue;
        const e = this.edges[edge];
        const cost = e.length / e.speedLimit + (opts.extraCost ? opts.extraCost(edge) : 0) + (this.nodes[nxt].signal ? 4 : 0.5);
        const ng = g[cur] + cost;
        if (ng < g[nxt]) {
          g[nxt] = ng;
          prevEdge[nxt] = edge;
          heap.push(nxt, ng + h(nxt));
        }
      }
    }
    if (!isFinite(g[to])) return null;
    const out: Traversal[] = [];
    let cur = to;
    while (cur !== from) {
      const eid = prevEdge[cur];
      const e = this.edges[eid];
      const prev = e.a === cur ? e.b : e.a;
      out.push({ edge: eid, dir: e.a === prev ? 0 : 1 });
      cur = prev;
    }
    return out.reverse();
  }
}

export class PedNav {
  readonly adj: { edge: number; to: number }[][];

  constructor(
    readonly nodes: PedNode[],
    readonly edges: PedEdge[],
  ) {
    this.adj = nodes.map(() => []);
    for (const e of edges) {
      this.adj[e.a].push({ edge: e.id, to: e.b });
      this.adj[e.b].push({ edge: e.id, to: e.a });
    }
  }

  /** Shortest walk as list of [pedEdgeId, fromNode, toNode]. */
  route(from: number, to: number): { edge: number; from: number; to: number }[] | null {
    if (from === to) return [];
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap<number>();
    const tgt = this.nodes[to];
    const h = (i: number): number => Math.hypot(this.nodes[i].x - tgt.x, this.nodes[i].z - tgt.z);
    g[from] = 0;
    heap.push(from, h(from));
    while (heap.size) {
      const cur = heap.pop()!;
      if (closed[cur]) continue;
      if (cur === to) break;
      closed[cur] = 1;
      for (const { edge, to: nxt } of this.adj[cur]) {
        const e = this.edges[edge];
        const ng = g[cur] + e.length + (e.kind === 'crosswalk' ? 3 : 0);
        if (ng < g[nxt]) {
          g[nxt] = ng;
          prevEdge[nxt] = edge;
          heap.push(nxt, ng + h(nxt));
        }
      }
    }
    if (!isFinite(g[to])) return null;
    const out: { edge: number; from: number; to: number }[] = [];
    let cur = to;
    while (cur !== from) {
      const e = this.edges[prevEdge[cur]];
      const prev = e.a === cur ? e.b : e.a;
      out.push({ edge: e.id, from: prev, to: cur });
      cur = prev;
    }
    return out.reverse();
  }

  /** Connected component labels (for validation). */
  components(): Int32Array {
    const label = new Int32Array(this.nodes.length).fill(-1);
    let c = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (label[i] >= 0) continue;
      const stack = [i];
      label[i] = c;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const { to } of this.adj[cur]) {
          if (label[to] < 0) {
            label[to] = c;
            stack.push(to);
          }
        }
      }
      c++;
    }
    return label;
  }
}
