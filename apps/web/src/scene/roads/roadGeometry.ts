/**
 * Geometry builders for the road network (pure functions of the static world).
 */
import * as THREE from 'three';
import type { RoadClass, StaticWorld } from '@morphis/shared';
import { LANE_WIDTH } from '@morphis/shared';

function dirOf(world: StaticWorld, e: StaticWorld['roads']['edges'][number]) {
  const a = world.roads.nodes[e.a];
  const b = world.roads.nodes[e.b];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { a, b, ux: (b.x - a.x) / l, uz: (b.z - a.z) / l, len: l };
}

class GeoBuilder {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(p: [number, number, number][], uv: [number, number][]): void {
    const base = this.pos.length / 3;
    for (const q of p) this.pos.push(q[0], q[1], q[2]);
    for (const t of uv) this.uv.push(t[0], t[1]);
    this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  fan(cx: number, cz: number, y: number, ring: [number, number][]): void {
    const base = this.pos.length / 3;
    this.pos.push(cx, y, cz);
    this.uv.push(0.5, 0.5);
    for (const [x, z] of ring) {
      this.pos.push(x, y, z);
      this.uv.push(0.5 + (x - cx) * 0.05, 0.5 + (z - cz) * 0.05);
    }
    for (let i = 0; i < ring.length; i++) this.idx.push(base, base + 1 + ((i + 1) % ring.length), base + 1 + i);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** Carriageway quads per road class. uv.x across the road, uv.y along (period 8 units). */
export function buildCarriageways(world: StaticWorld): Record<RoadClass, THREE.BufferGeometry> {
  const builders: Record<RoadClass, GeoBuilder> = { highway: new GeoBuilder(), avenue: new GeoBuilder(), street: new GeoBuilder(), local: new GeoBuilder() };
  for (const e of world.roads.edges) {
    const { a, ux, uz, len } = dirOf(world, e);
    const px = -uz;
    const pz = ux;
    const hw = e.width / 2;
    const s0 = e.setbackA;
    const s1 = len - e.setbackB;
    const y = e.cls === 'highway' ? 0.035 : 0.03;
    const P = (s: number, o: number): [number, number, number] => [a.x + ux * s + px * o, y, a.z + uz * s + pz * o];
    builders[e.cls].quad([P(s0, -hw), P(s0, hw), P(s1, hw), P(s1, -hw)], [
      [0, s0 / 8],
      [1, s0 / 8],
      [1, s1 / 8],
      [0, s1 / 8],
    ]);
  }
  return { highway: builders.highway.build(), avenue: builders.avenue.build(), street: builders.street.build(), local: builders.local.build() };
}

/** Intersection pads (convex fans) and bend fillers. */
export function buildJunctions(world: StaticWorld): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const n of world.roads.nodes) {
    if (n.edges.length < 2) continue;
    const ring: [number, number, number][] = [];
    for (const eid of n.edges) {
      const e = world.roads.edges[eid];
      const other = world.roads.nodes[e.a === n.id ? e.b : e.a];
      const l = Math.hypot(other.x - n.x, other.z - n.z) || 1;
      const dx = (other.x - n.x) / l;
      const dz = (other.z - n.z) / l;
      const sb = (e.a === n.id ? e.setbackA : e.setbackB) + 0.02;
      const hw = e.width / 2;
      for (const side of [-1, 1]) {
        const x = n.x + dx * sb - dz * hw * side;
        const z = n.z + dz * sb + dx * hw * side;
        ring.push([x, z, Math.atan2(z - n.z, x - n.x)]);
      }
    }
    if (n.edges.length === 2) {
      // bends: a disc covers the wedge between the two quads
      const hw = Math.max(...n.edges.map((id) => world.roads.edges[id].width / 2));
      const disc: [number, number][] = [];
      for (let i = 0; i < 16; i++) disc.push([n.x + Math.cos((i / 16) * Math.PI * 2) * hw, n.z + Math.sin((i / 16) * Math.PI * 2) * hw]);
      b.fan(n.x, n.z, 0.028, disc);
      continue;
    }
    ring.sort((p, q) => p[2] - q[2]);
    b.fan(n.x, n.z, 0.032, ring.map(([x, z]) => [x, z]));
  }
  return b.build();
}

/** Raised sidewalks (top surfaces) + kerb faces + corner fills. */
export function buildSidewalks(world: StaticWorld): { top: THREE.BufferGeometry; kerb: THREE.BufferGeometry } {
  const top = new GeoBuilder();
  const kerb = new GeoBuilder();
  const H = 0.12;
  for (const e of world.roads.edges) {
    if (e.sidewalk <= 0) continue;
    const { a, ux, uz, len } = dirOf(world, e);
    const px = -uz;
    const pz = ux;
    const s0 = 0;
    const s1 = len;
    for (const side of [-1, 1]) {
      const o0 = (e.width / 2) * side;
      const o1 = (e.width / 2 + e.sidewalk) * side;
      const P = (s: number, o: number, y: number): [number, number, number] => [a.x + ux * s + px * o, y, a.z + uz * s + pz * o];
      const u0 = s0 / 2;
      const u1 = s1 / 2;
      if (side > 0) top.quad([P(s0, o0, H), P(s0, o1, H), P(s1, o1, H), P(s1, o0, H)], [[0, u0], [e.sidewalk / 2, u0], [e.sidewalk / 2, u1], [0, u1]]);
      else top.quad([P(s0, o1, H), P(s0, o0, H), P(s1, o0, H), P(s1, o1, H)], [[0, u0], [e.sidewalk / 2, u0], [e.sidewalk / 2, u1], [0, u1]]);
      // kerb face toward the road
      const ks = e.setbackA;
      const ke = len - e.setbackB;
      if (ke > ks) {
        if (side > 0) kerb.quad([P(ks, o0, 0), P(ke, o0, 0), P(ke, o0, H), P(ks, o0, H)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        else kerb.quad([P(ke, o0, 0), P(ks, o0, 0), P(ks, o0, H), P(ke, o0, H)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
  }
  for (const p of world.ped.nodes) {
    if (p.kind !== 'corner' || p.roadNode === undefined) continue;
    const r = 1.5;
    const ring: [number, number][] = [];
    for (let i = 0; i < 10; i++) ring.push([p.x + Math.cos((i / 10) * Math.PI * 2) * r, p.z + Math.sin((i / 10) * Math.PI * 2) * r]);
    top.fan(p.x, p.z, H - 0.005, ring);
  }
  return { top: top.build(), kerb: kerb.build() };
}

export interface BarInstance {
  x: number;
  z: number;
  rot: number;
  len: number;
  width: number;
}

/** Zebra stripes for every crosswalk and stop lines at signalled/junction approaches. */
export function buildMarkings(world: StaticWorld): { stripes: BarInstance[]; stopLines: BarInstance[] } {
  const stripes: BarInstance[] = [];
  for (const cw of world.props.crosswalks) {
    const len = cw.s ?? 4;
    const n = Math.max(3, Math.floor(len / 0.75));
    const dx = Math.sin(cw.r);
    const dz = Math.cos(cw.r);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      // stripes run parallel to the road, i.e. perpendicular to the walking direction
      stripes.push({ x: cw.x + dx * t * len * 0.86, z: cw.z + dz * t * len * 0.86, rot: cw.r, len: 1.5, width: 0.36 });
    }
  }
  const stopLines: BarInstance[] = [];
  for (const e of world.roads.edges) {
    if (e.cls === 'highway') continue;
    const { a, b, ux, uz, len } = dirOf(world, e);
    const px = -uz;
    const pz = ux;
    const lanesW = e.lanes * LANE_WIDTH;
    const mid = e.median / 2 + lanesW / 2;
    if (e.setbackA > 0 && world.roads.nodes[e.a].edges.length >= 3) {
      // traffic travelling b -> a uses the -perp side
      const s = e.setbackA + 0.25;
      stopLines.push({ x: a.x + ux * s - px * mid, z: a.z + uz * s - pz * mid, rot: Math.atan2(ux, uz), len: lanesW, width: 0.3 });
    }
    if (e.setbackB > 0 && world.roads.nodes[e.b].edges.length >= 3) {
      const s = len - e.setbackB - 0.25;
      stopLines.push({ x: a.x + ux * s + px * mid, z: a.z + uz * s + pz * mid, rot: Math.atan2(ux, uz), len: lanesW, width: 0.3 });
    }
    void b;
  }
  return { stripes, stopLines };
}

/** Lane-marking texture per road class (albedo + glow mask). */
export function roadTextures(cls: RoadClass): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const W = 256;
  const H = 256;
  const make = (glowOnly: boolean): THREE.CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    if (glowOnly) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = cls === 'highway' ? '#15171c' : '#17191f';
      g.fillRect(0, 0, W, H);
      // asphalt speckle
      for (let i = 0; i < 2600; i++) {
        const v = 20 + Math.random() * 22;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
        g.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
      }
      // tyre wear lanes
      g.fillStyle = 'rgba(0,0,0,0.18)';
    }
    const spec = { highway: { lanes: 3, median: 1.0 }, avenue: { lanes: 2, median: 0.6 }, street: { lanes: 1, median: 0 }, local: { lanes: 1, median: 0 } }[cls];
    const width = spec.lanes * 2 * LANE_WIDTH + spec.median;
    const X = (m: number): number => ((m + width / 2) / width) * W;
    const white = glowOnly ? '#ffffff' : '#c9ccd2';
    const line = (m: number, dashed: boolean, color: string, w = 2.4): void => {
      g.fillStyle = color;
      if (dashed) {
        for (let y = 0; y < H; y += 64) g.fillRect(X(m) - w / 2, y, w, 34);
      } else g.fillRect(X(m) - w / 2, 0, w, H);
    };
    // edge lines
    line(-width / 2 + 0.2, false, white);
    line(width / 2 - 0.2, false, white);
    if (spec.median > 0) {
      const c = glowOnly ? '#22d3ee' : '#2fbfd2';
      line(-spec.median / 2, false, c, 2.6);
      line(spec.median / 2, false, c, 2.6);
      if (!glowOnly) {
        g.fillStyle = '#101216';
        g.fillRect(X(-spec.median / 2) + 2, 0, X(spec.median / 2) - X(-spec.median / 2) - 4, H);
      }
    } else {
      line(0, cls === 'local', glowOnly ? '#fbbf24' : '#c9a227', 2.4);
    }
    for (let k = 1; k < spec.lanes; k++) {
      line(spec.median / 2 + k * LANE_WIDTH, true, white, 2);
      line(-spec.median / 2 - k * LANE_WIDTH, true, white, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = glowOnly ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    return t;
  };
  return { map: make(false), glow: make(true) };
}

export function tileTexture(base: string, line: string, cells = 4): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    g.beginPath();
    g.moveTo((i * 128) / cells, 0);
    g.lineTo((i * 128) / cells, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (i * 128) / cells);
    g.lineTo(128, (i * 128) / cells);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
