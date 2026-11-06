/**
 * Building generation: frontage-based lot placement + procedural massing.
 *
 * Buildings are placed along every road edge side, facing the street, packed
 * tightly and grown backwards into the block until they collide with another
 * building or road. Landmarks and parks are placed first near target points.
 */
import type {
  BuildingDef,
  BuildingTier,
  BuildingType,
  District,
  FacadeType,
  InteriorKind,
  NeonSpec,
  RoadEdge,
  RoadNode,
  RooftopType,
  Vec2,
} from '@morphis/shared';
import { BUILDING_TYPES } from '@morphis/shared';
import { Rng } from '../core/rng';
import { type OBB, norm, obbOverlap, obbSegmentDistance, perp, sub } from '../core/geom';
import { districtAt } from './districts';
import type { CornerSet } from './roads';

export interface LandmarkSpec {
  key: string;
  name: string;
  type: BuildingType;
  target: [number, number];
  w: number;
  d: number;
  h: number;
  sign?: string;
}

export const LANDMARKS: LandmarkSpec[] = [
  { key: 'cityhall', name: 'MORPHIS CITY HALL', type: 'government', target: [-27, 27], w: 18, d: 14, h: 26 },
  { key: 'cybercafe', name: 'CYBER CAFE', type: 'cafe', target: [24, -27], w: 9, d: 9, h: 7, sign: 'CYBER CAFE' },
  { key: 'skyline', name: 'SKYLINE RESIDENCES', type: 'luxury_apartment', target: [27, 26], w: 14, d: 14, h: 78 },
  { key: 'ai_lab', name: 'MORPHIS AI LAB', type: 'ai_lab', target: [-6, -98], w: 26, d: 18, h: 26, sign: 'AI LAB' },
  { key: 'university', name: 'MORPHIS UNIVERSITY', type: 'university', target: [-84, -96], w: 30, d: 20, h: 20, sign: 'MORPHIS UNIVERSITY' },
  { key: 'library', name: 'CENTRAL LIBRARY', type: 'library', target: [-60, -66], w: 18, d: 14, h: 12 },
  { key: 'orbital', name: 'ORBITAL SYSTEMS', type: 'corporate_tower', target: [66, -76], w: 18, d: 18, h: 74, sign: 'ORBITAL' },
  { key: 'datacenter', name: 'CORE DATA CENTER', type: 'data_center', target: [104, -100], w: 22, d: 16, h: 14 },
  { key: 'corporate', name: 'AXIOM TOWER', type: 'corporate_tower', target: [92, -46], w: 20, d: 20, h: 92, sign: 'AXIOM' },
  { key: 'bank', name: 'NOVA BANK', type: 'bank', target: [94, 16], w: 20, d: 16, h: 66, sign: 'NOVA BANK' },
  { key: 'hospital', name: 'MORPHIS GENERAL HOSPITAL', type: 'hospital', target: [96, 60], w: 26, d: 18, h: 30, sign: 'HOSPITAL' },
  { key: 'studio', name: 'PRISM STUDIOS', type: 'office', target: [-90, -46], w: 18, d: 14, h: 18, sign: 'PRISM' },
  { key: 'market', name: 'NEON MARKET', type: 'shop', target: [-78, 58], w: 24, d: 14, h: 8, sign: 'NEON MARKET' },
  { key: 'arena', name: 'ARCADIA ARENA', type: 'entertainment', target: [-98, 96], w: 26, d: 20, h: 14, sign: 'ARCADIA' },
  { key: 'station', name: 'MORPHIS CENTRAL STATION', type: 'transit_hub', target: [-24, 100], w: 30, d: 16, h: 12, sign: 'CENTRAL STATION' },
  { key: 'forge', name: 'FORGE WORKS', type: 'factory', target: [40, 100], w: 28, d: 20, h: 12 },
  { key: 'fusion', name: 'HELIOS FUSION PLANT', type: 'power_plant', target: [100, 98], w: 24, d: 22, h: 16 },
  { key: 'water', name: 'AQUA WORKS', type: 'water_facility', target: [66, 104], w: 20, d: 16, h: 10 },
  { key: 'school', name: 'NEXGEN ACADEMY', type: 'school', target: [-100, 34], w: 18, d: 14, h: 9 },
  { key: 'lumen_park', name: 'LUMEN PARK', type: 'park', target: [-60, 14], w: 26, d: 22, h: 0 },
  { key: 'orbit_gardens', name: 'ORBIT GARDENS', type: 'park', target: [42, -56], w: 22, d: 20, h: 0 },
  { key: 'echo_green', name: 'ECHO GREEN', type: 'park', target: [-40, -100], w: 22, d: 18, h: 0 },
  { key: 'synapse_gardens', name: 'SYNAPSE GARDENS', type: 'park', target: [62, 58], w: 22, d: 18, h: 0 },
];

const NAME_A = ['Axion', 'Helix', 'Vanta', 'Quanta', 'Stratos', 'Lumina', 'Cygnus', 'Arclight', 'Kairo', 'Obsidian', 'Halcyon', 'Vireo', 'Parallax', 'Zenra', 'Tessera', 'Novis', 'Ferro', 'Solace', 'Cobalt', 'Meridian'];
const NAME_B = ['Systems', 'Dynamics', 'Labs', 'Networks', 'Holdings', 'Group', 'Analytics', 'Robotics', 'Logic', 'Collective', 'Works', 'Ventures'];
const CAFE_A = ['Byte', 'Drip', 'Synth', 'Pixel', 'Steam', 'Glow', 'Static', 'Ion', 'Velvet', 'Rain'];
const CAFE_B = ['Brew', 'Bean', 'Cafe', 'Roastery', 'Espresso Bar', 'Tea House'];
const FOOD_A = ['Golden', 'Chrome', 'Midnight', 'Lotus', 'Ember', 'Jade', 'Neon', 'Lucky', 'Orbit', 'Paper Lantern'];
const FOOD_B = ['Noodle Bar', 'Grill', 'Kitchen', 'Dumpling House', 'Diner', 'Bistro', 'Bao Shop', 'Taqueria'];
const SHOP_A = ['Synth', 'Holo', 'Volt', 'Circuit', 'Nova', 'Flux', 'Kinetic', 'Retro', 'Prime', 'Mono'];
const SHOP_B = ['Mart', 'Wares', 'Goods', 'Tech Store', 'Supply', 'Boutique', 'Optics', 'Records'];
const RES_A = ['Aurora', 'Cedar', 'Harbor', 'Linden', 'Moon', 'Oak', 'Sable', 'Willow', 'Iris', 'Echo', 'Atlas', 'Vesper'];
const RES_B = ['Residences', 'Heights', 'Court', 'Lofts', 'Towers', 'Commons', 'House', 'Terrace'];
const FUN_A = ['Holo', 'Pulse', 'Starlight', 'Bass', 'Afterglow', 'Quantum'];
const FUN_B = ['Arcade', 'Club', 'Cinema', 'Lounge', 'Bowl', 'Theatre'];

export const NEON_COLORS = ['#22d3ee', '#e879f9', '#a855f7', '#f472b6', '#fbbf24', '#2dd4bf', '#38bdf8', '#fb7185'];

export interface PlacementContext {
  rng: Rng;
  nodes: RoadNode[];
  edges: RoadEdge[];
  corners: CornerSet[];
  districts: District[];
  size: number;
  buildingDensity: number;
  heightScale: number;
  parkFrequency: number;
}

interface Placed {
  obb: OBB;
  def: BuildingDef;
}

/** Three.js-style Y rotation: local (lx, lz) -> world offset. */
export function localToWorld(cx: number, cz: number, rot: number, lx: number, lz: number): Vec2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

export class BuildingPlacer {
  readonly placed: Placed[] = [];
  private grid = new Map<string, number[]>();
  private roadGrid = new Map<string, number[]>();
  private names = new Set<string>();
  readonly landmarkIds = new Map<string, string>();

  constructor(private ctx: PlacementContext) {
    for (const e of ctx.edges) {
      const a = ctx.nodes[e.a];
      const b = ctx.nodes[e.b];
      const r = e.width / 2 + e.sidewalk + 3;
      for (const k of this.cellsFor(Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r)) {
        const l = this.roadGrid.get(k);
        if (l) l.push(e.id);
        else this.roadGrid.set(k, [e.id]);
      }
    }
  }

  private cellsFor(x0: number, z0: number, x1: number, z1: number): string[] {
    const out: string[] = [];
    for (let gx = Math.floor(x0 / 16); gx <= Math.floor(x1 / 16); gx++)
      for (let gz = Math.floor(z0 / 16); gz <= Math.floor(z1 / 16); gz++) out.push(`${gx},${gz}`);
    return out;
  }

  private obbBounds(o: OBB): [number, number, number, number] {
    const r = Math.hypot(o.hw, o.hd);
    return [o.cx - r, o.cz - r, o.cx + r, o.cz + r];
  }

  fits(o: OBB, roadClear = 0.25, buildingGap = 0.35): boolean {
    const lim = this.ctx.size / 2 - 11;
    if (Math.abs(o.cx) + Math.hypot(o.hw, o.hd) * 0.7 > lim || Math.abs(o.cz) + Math.hypot(o.hw, o.hd) * 0.7 > lim) return false;
    const [x0, z0, x1, z1] = this.obbBounds(o);
    const seenE = new Set<number>();
    for (const k of this.cellsFor(x0, z0, x1, z1)) {
      for (const eid of this.roadGrid.get(k) ?? []) {
        if (seenE.has(eid)) continue;
        seenE.add(eid);
        const e = this.ctx.edges[eid];
        const clear = e.width / 2 + (e.cls === 'highway' ? 3 : e.sidewalk) + roadClear;
        if (obbSegmentDistance(o, this.ctx.nodes[e.a], this.ctx.nodes[e.b]) < clear) return false;
      }
    }
    const seenB = new Set<number>();
    for (const k of this.cellsFor(x0, z0, x1, z1)) {
      for (const bi of this.grid.get(k) ?? []) {
        if (seenB.has(bi)) continue;
        seenB.add(bi);
        if (obbOverlap(o, this.placed[bi].obb, buildingGap)) return false;
      }
    }
    return true;
  }

  add(obb: OBB, def: BuildingDef): void {
    const idx = this.placed.length;
    this.placed.push({ obb, def });
    this.register(idx);
  }

  private register(idx: number): void {
    const [x0, z0, x1, z1] = this.obbBounds(this.placed[idx].obb);
    for (const k of this.cellsFor(x0, z0, x1, z1)) {
      const l = this.grid.get(k);
      if (!l) this.grid.set(k, [idx]);
      else if (!l.includes(idx)) l.push(idx);
    }
  }

  /** Frame of an edge side: origin at node a, along u, outward normal n (away from road). */
  frontageFrame(e: RoadEdge, side: 1 | -1): { a: Vec2; u: Vec2; out: Vec2; off: number } {
    const a = this.ctx.nodes[e.a];
    const u = norm(sub(this.ctx.nodes[e.b], a));
    const p = perp(u);
    return { a, u, out: { x: p.x * side, z: p.z * side }, off: e.width / 2 + e.sidewalk + 0.3 };
  }

  /** Valid frontage interval along an edge side (avoid intersections and their sidewalks). */
  frontageInterval(e: RoadEdge, side: 1 | -1): [number, number] {
    const { nodes, corners } = this.ctx;
    const proj = (nid: number, sideAtNode: 'plus' | 'minus', fromA: boolean): number => {
      const n = nodes[nid];
      const k = n.edges.length;
      const idx = n.edges.indexOf(e.id);
      if (k < 2) return 0;
      const c = sideAtNode === 'plus' ? corners[nid].corners[idx] : corners[nid].corners[(idx - 1 + k) % k];
      const other = nodes[fromA ? e.b : e.a];
      const d = norm(sub(other, n));
      return (c.x - n.x) * d.x + (c.z - n.z) * d.z;
    };
    // side +1 relative to a->b is the "plus" side at a and the "minus" side at b.
    const at = side === 1 ? proj(e.a, 'plus', true) : proj(e.a, 'minus', true);
    const bt = side === 1 ? proj(e.b, 'minus', false) : proj(e.b, 'plus', false);
    const na = nodes[e.a].edges.length;
    const nb = nodes[e.b].edges.length;
    const startPad = na >= 3 ? 1.4 : na === 2 ? 0.4 : 1.5;
    const endPad = nb >= 3 ? 1.4 : nb === 2 ? 0.4 : 1.5;
    return [Math.max(0, at) + startPad, e.length - Math.max(0, bt) - endPad];
  }

  /** Distance from a point to the clearance zone of the nearest road other than `skipEdge`. */
  private roadClearanceAt(x: number, z: number, skipEdge: number): number {
    let best = Infinity;
    const cell = this.roadGrid.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) ?? [];
    for (const eid of cell) {
      if (eid === skipEdge) continue;
      const e = this.ctx.edges[eid];
      const a = this.ctx.nodes[e.a];
      const b = this.ctx.nodes[e.b];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
      const d = Math.hypot(x - a.x - abx * t, z - a.z - abz * t) - (e.width / 2 + (e.cls === 'highway' ? 3 : e.sidewalk) + 0.25);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Block depth available behind a frontage slot: march outward from the kerb
   * line until another road's clearance zone (or the city limit) is reached.
   */
  depthAvailable(e: RoadEdge, side: 1 | -1, s: number, w: number, max = 70): number {
    const f = this.frontageFrame(e, side);
    const lim = this.ctx.size / 2 - 11;
    let best = max;
    for (const t of [s + 0.3, s + w / 2, s + w - 0.3]) {
      const bx = f.a.x + f.u.x * t + f.out.x * f.off;
      const bz = f.a.z + f.u.z * t + f.out.z * f.off;
      let dd = 0;
      while (dd < best) {
        const x = bx + f.out.x * dd;
        const z = bz + f.out.z * dd;
        if (Math.abs(x) > lim || Math.abs(z) > lim || this.roadClearanceAt(x, z, e.id) < 0) break;
        dd += 0.5;
      }
      best = Math.min(best, dd);
    }
    return best;
  }

  /** Grow a placed building backwards into free space (keeps its frontage). */
  tryGrow(index: number, e: RoadEdge, side: 1 | -1, s: number, w: number, maxD: number): number | null {
    const cur = this.placed[index];
    const d0 = cur.obb.hd * 2;
    let bestD: number | null = null;
    for (let d = maxD; d > d0 + 0.9; d -= 1) {
      const f = this.frontageFrame(e, side);
      const along = s + w / 2;
      const obb: OBB = {
        cx: f.a.x + f.u.x * along + f.out.x * (f.off + d / 2),
        cz: f.a.z + f.u.z * along + f.out.z * (f.off + d / 2),
        hw: w / 2,
        hd: d / 2,
        rot: cur.obb.rot,
      };
      const saved = this.placed[index].obb;
      this.placed[index].obb = { cx: 1e6, cz: 1e6, hw: 0, hd: 0, rot: 0 };
      const ok = this.fits(obb);
      this.placed[index].obb = saved;
      if (ok) {
        this.placed[index].obb = obb;
        this.register(index);
        bestD = d;
        break;
      }
    }
    return bestD;
  }

  /** Try to place a building of size w x d on edge side at distance s from node a. */
  tryAt(e: RoadEdge, side: 1 | -1, s: number, w: number, d: number): { obb: OBB; rot: number; center: Vec2 } | null {
    const f = this.frontageFrame(e, side);
    const along = s + w / 2;
    const cx = f.a.x + f.u.x * along + f.out.x * (f.off + d / 2);
    const cz = f.a.z + f.u.z * along + f.out.z * (f.off + d / 2);
    // front of the building faces the road: local +z = -out
    const rot = Math.atan2(-f.out.x, -f.out.z);
    const obb: OBB = { cx, cz, hw: w / 2, hd: d / 2, rot: -rot };
    if (!this.fits(obb)) return null;
    return { obb, rot, center: { x: cx, z: cz } };
  }

  uniqueName(gen: () => string): string {
    for (let i = 0; i < 20; i++) {
      const n = gen();
      if (!this.names.has(n)) {
        this.names.add(n);
        return n;
      }
    }
    const n = `${gen()} ${this.placed.length}`;
    this.names.add(n);
    return n;
  }

  reserveName(n: string): void {
    this.names.add(n);
  }
}

// ------------------------------------------------------------------ type + size selection

const TYPE_WEIGHT: Partial<Record<BuildingType, number>> = {
  shop: 0.5,
  cafe: 0.35,
  restaurant: 0.35,
  parking: 0.25,
  school: 0.15,
  library: 0.1,
  data_center: 0.35,
  bank: 0.4,
  entertainment: 0.6,
};

export function chooseType(rng: Rng, district: District, frontageCls: RoadEdge['cls']): BuildingType {
  const types = district.buildingTypes;
  const t = rng.weighted(types, (ty) => {
    let w = TYPE_WEIGHT[ty] ?? 1;
    // small commercial units prefer busy streets
    if ((ty === 'shop' || ty === 'cafe' || ty === 'restaurant') && frontageCls === 'avenue') w *= 1.5;
    return w;
  });
  return t ?? 'office';
}

export function sizeFor(rng: Rng, type: BuildingType): { w: number; d: number } {
  switch (type) {
    case 'shop':
    case 'cafe':
      return { w: rng.range(5, 8), d: rng.range(6, 10) };
    case 'restaurant':
      return { w: rng.range(6, 9), d: rng.range(7, 11) };
    case 'corporate_tower':
      return { w: rng.range(12, 18), d: rng.range(12, 20) };
    case 'office':
    case 'bank':
      return { w: rng.range(9, 15), d: rng.range(10, 18) };
    case 'apartment':
      return { w: rng.range(9, 15), d: rng.range(9, 15) };
    case 'luxury_apartment':
      return { w: rng.range(9, 13), d: rng.range(9, 14) };
    case 'factory':
      return { w: rng.range(16, 26), d: rng.range(14, 22) };
    case 'warehouse':
      return { w: rng.range(14, 22), d: rng.range(12, 20) };
    case 'data_center':
      return { w: rng.range(14, 20), d: rng.range(12, 18) };
    case 'research_lab':
      return { w: rng.range(12, 20), d: rng.range(10, 16) };
    case 'parking':
      return { w: rng.range(12, 18), d: rng.range(12, 18) };
    case 'entertainment':
      return { w: rng.range(10, 16), d: rng.range(10, 16) };
    case 'school':
    case 'library':
      return { w: rng.range(14, 20), d: rng.range(10, 14) };
    default:
      return { w: rng.range(8, 14), d: rng.range(8, 14) };
  }
}

export function heightFor(rng: Rng, type: BuildingType, district: District, pos: Vec2, heightScale: number): number {
  const [lo, hi] = district.heightRange;
  let h: number;
  switch (type) {
    case 'shop':
    case 'cafe':
      h = rng.range(3.4, 7);
      break;
    case 'restaurant':
      h = rng.range(3.4, 8);
      break;
    case 'warehouse':
      h = rng.range(5, 9);
      break;
    case 'factory':
      h = rng.range(6, 12);
      break;
    case 'parking':
      h = rng.range(6, 11);
      break;
    case 'data_center':
      h = rng.range(8, 16);
      break;
    case 'school':
    case 'library':
      h = rng.range(6, 11);
      break;
    case 'entertainment':
      h = rng.range(8, 18);
      break;
    case 'corporate_tower':
      h = Math.max(lo, 30) + (hi - Math.max(lo, 30)) * Math.pow(rng.float(), 0.8);
      break;
    default:
      h = lo + (hi - lo) * Math.pow(rng.float(), 1.5);
  }
  // downtown core is taller near the centre
  const r = Math.hypot(pos.x, pos.z);
  if (district.type === 'central' && type !== 'shop' && type !== 'cafe' && type !== 'restaurant') {
    h *= 1.25 - Math.min(1, r / 80) * 0.45;
  }
  return Math.max(3.2, h * heightScale);
}

export function nameFor(rng: Rng, type: BuildingType, districtName: string, idx: number): string {
  switch (type) {
    case 'cafe':
      return `${rng.pick(CAFE_A)} ${rng.pick(CAFE_B)}`;
    case 'restaurant':
      return `${rng.pick(FOOD_A)} ${rng.pick(FOOD_B)}`;
    case 'shop':
      return `${rng.pick(SHOP_A)} ${rng.pick(SHOP_B)}`;
    case 'apartment':
    case 'luxury_apartment':
      return rng.chance(0.25) ? `Block ${String.fromCharCode(65 + (idx % 26))}-${10 + (idx % 90)}` : `${rng.pick(RES_A)} ${rng.pick(RES_B)}`;
    case 'entertainment':
      return `${rng.pick(FUN_A)} ${rng.pick(FUN_B)}`;
    case 'office':
    case 'corporate_tower':
      return `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
    case 'bank':
      return `${rng.pick(NAME_A)} Capital`;
    case 'research_lab':
      return `${rng.pick(NAME_A)} Research Lab`;
    case 'data_center':
      return `${rng.pick(NAME_A)} Data Vault`;
    case 'factory':
      return `${rng.pick(NAME_A)} Fabrication`;
    case 'warehouse':
      return `${rng.pick(NAME_A)} Logistics Depot`;
    case 'parking':
      return `${districtName.split(' ')[0]} Parking ${idx % 9 + 1}`;
    case 'school':
      return `${rng.pick(RES_A)} School`;
    case 'library':
      return `${rng.pick(RES_A)} Library`;
    case 'park':
      return `${rng.pick(RES_A)} Park`;
    default:
      return `${rng.pick(NAME_A)} ${BUILDING_TYPES[type].label}`;
  }
}

// ------------------------------------------------------------------ massing

export interface Massing {
  tiers: BuildingTier[];
  facade: FacadeType;
  rooftop: RooftopType;
  windowDensity: number;
  palette: number;
  antennas: number;
  balconies: boolean;
  neon: NeonSpec | null;
}

export function massingFor(rng: Rng, type: BuildingType, w: number, d: number, h: number, district: District): Massing {
  const tiers: BuildingTier[] = [];
  const box = (ox: number, oz: number, tw: number, td: number, y0: number, th: number, facade: FacadeType): void => {
    tiers.push({ shape: 'box', ox, oz, w: tw, d: td, y0, h: th, facade });
  };
  let facade: FacadeType = 'grid';
  let rooftop: RooftopType = 'hvac';
  let windowDensity = 0.7;
  let palette = rng.int(0, 5);
  let antennas = 0;
  let balconies = false;
  let neon: NeonSpec | null = null;
  const neonChance = { entertainment: 0.85, central: 0.35, creative: 0.4, technology: 0.3, corporate: 0.25, finance: 0.2 } as Record<string, number>;
  const pickNeon = (style?: NeonSpec['style']): NeonSpec => ({
    color: rng.chance(0.5) ? district.color : rng.pick(NEON_COLORS),
    style: style ?? rng.pick(['edge', 'crown', 'band'] as const),
  });

  switch (type) {
    case 'corporate_tower': {
      facade = rng.chance(0.65) ? 'glass' : 'ribbon';
      windowDensity = 0.92;
      palette = rng.pick([0, 1, 6, 7]);
      const podiumH = rng.range(4, 7);
      box(0, 0, w, d, 0, podiumH, 'glass');
      const tw = w * rng.range(0.62, 0.82);
      const td = d * rng.range(0.62, 0.82);
      const shapeRoll = rng.float();
      if (shapeRoll < 0.22) {
        tiers.push({ shape: 'cylinder', ox: 0, oz: 0, w: Math.min(tw, td), d: Math.min(tw, td), y0: podiumH, h: h - podiumH, facade });
      } else if (shapeRoll < 0.34) {
        tiers.push({ shape: 'hex', ox: 0, oz: 0, w: Math.min(tw, td), d: Math.min(tw, td), y0: podiumH, h: h - podiumH, facade });
      } else {
        const mid = podiumH + (h - podiumH) * rng.range(0.55, 0.75);
        box(0, 0, tw, td, podiumH, mid - podiumH, facade);
        box(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), tw * 0.78, td * 0.78, mid, h - mid, facade);
      }
      rooftop = rng.pick(['spire', 'crown', 'helipad', 'antenna'] as const);
      antennas = rooftop === 'antenna' ? rng.int(1, 3) : 0;
      if (rng.chance(neonChance[district.type] ?? 0.2)) neon = pickNeon(rng.chance(0.5) ? 'crown' : 'edge');
      break;
    }
    case 'office':
    case 'bank':
    case 'government': {
      facade = rng.pick(['grid', 'ribbon', 'glass', 'panel'] as const);
      windowDensity = rng.range(0.7, 0.9);
      if (h > 18 && rng.chance(0.6)) {
        const split = h * rng.range(0.55, 0.8);
        box(0, 0, w, d, 0, split, facade);
        box(0, rng.range(-1, 0), w * rng.range(0.65, 0.85), d * rng.range(0.65, 0.85), split, h - split, facade);
      } else if (rng.chance(0.25)) {
        // L-shaped office
        box(-w * 0.2, 0, w * 0.6, d, 0, h, facade);
        box(w * 0.3, d * 0.2, w * 0.4, d * 0.6, 0, h * rng.range(0.5, 0.85), facade);
      } else {
        box(0, 0, w, d, 0, h, facade);
      }
      rooftop = rng.pick(['hvac', 'hvac', 'antenna', 'garden', 'dish'] as const);
      antennas = rooftop === 'antenna' ? rng.int(1, 2) : 0;
      if (type === 'government') {
        palette = 8;
        rooftop = 'crown';
      }
      if (rng.chance((neonChance[district.type] ?? 0.12) * 0.7)) neon = pickNeon();
      break;
    }
    case 'apartment':
    case 'luxury_apartment': {
      facade = type === 'luxury_apartment' ? 'glass' : 'residential';
      windowDensity = rng.range(0.55, 0.8);
      balconies = type === 'apartment' && rng.chance(0.6);
      palette = type === 'luxury_apartment' ? rng.pick([0, 6, 7]) : rng.pick([2, 3, 4, 5, 9]);
      if (type === 'apartment' && rng.chance(0.35) && w > 11) {
        // twin slabs sharing a base
        const base = Math.min(h * 0.25, 5);
        box(0, 0, w, d, 0, base, 'panel');
        box(-w * 0.25, 0, w * 0.42, d, base, h - base, facade);
        box(w * 0.25, 0, w * 0.42, d * 0.85, base, (h - base) * rng.range(0.7, 1), facade);
      } else if (h > 24 && rng.chance(0.5)) {
        const split = h * rng.range(0.6, 0.8);
        box(0, 0, w, d, 0, split, facade);
        box(0, 0, w * 0.75, d * 0.75, split, h - split, facade);
      } else {
        box(0, 0, w, d, 0, h, facade);
      }
      rooftop = rng.pick(['tanks', 'hvac', 'garden', 'antenna'] as const);
      antennas = rooftop === 'antenna' ? 1 : 0;
      if (rng.chance((neonChance[district.type] ?? 0.08) * 0.5)) neon = pickNeon('edge');
      break;
    }
    case 'shop':
    case 'cafe':
    case 'restaurant': {
      facade = 'glass';
      windowDensity = 0.95;
      palette = rng.pick([1, 3, 4, 9]);
      box(0, 0, w, d, 0, h, rng.chance(0.5) ? 'glass' : 'grid');
      rooftop = rng.pick(['hvac', 'flat', 'tanks'] as const);
      neon = rng.chance(0.75) ? pickNeon('band') : null;
      break;
    }
    case 'entertainment': {
      facade = 'panel';
      windowDensity = 0.3;
      palette = rng.pick([1, 7]);
      box(0, 0, w, d, 0, h * 0.75, 'panel');
      tiers.push({ shape: 'cylinder', ox: 0, oz: 0, w: Math.min(w, d) * 0.7, d: Math.min(w, d) * 0.7, y0: h * 0.75, h: h * 0.25, facade: 'glass' });
      rooftop = 'flat';
      neon = pickNeon(rng.chance(0.5) ? 'band' : 'edge');
      break;
    }
    case 'research_lab':
    case 'ai_lab': {
      facade = 'glass';
      windowDensity = 0.85;
      palette = rng.pick([6, 7, 0]);
      box(0, 0, w, d, 0, h * 0.6, 'ribbon');
      box(w * 0.15, 0, w * 0.55, d * 0.7, h * 0.6, h * 0.4, 'glass');
      if (type === 'ai_lab') {
        tiers.push({ shape: 'cylinder', ox: -w * 0.3, oz: 0, w: d * 0.6, d: d * 0.6, y0: 0, h: h * 0.85, facade: 'glass' });
        neon = { color: '#4ade80', style: 'crown' };
      }
      rooftop = 'dish';
      break;
    }
    case 'university':
    case 'school':
    case 'library': {
      facade = 'grid';
      windowDensity = 0.7;
      palette = 8;
      box(0, 0, w, d, 0, h * (type === 'university' ? 0.6 : 1), 'grid');
      if (type === 'university') {
        box(-w * 0.35, 0, w * 0.3, d * 0.9, 0, h * 0.75, 'grid');
        box(w * 0.35, 0, w * 0.3, d * 0.9, 0, h * 0.75, 'grid');
        box(0, 0, w * 0.18, d * 0.4, h * 0.6, h * 0.95, 'ribbon');
        neon = { color: '#60a5fa', style: 'crown' };
      }
      rooftop = type === 'university' ? 'spire' : 'garden';
      break;
    }
    case 'factory': {
      facade = 'industrial';
      windowDensity = 0.25;
      palette = rng.pick([10, 11]);
      box(0, 0, w, d, 0, h * 0.7, 'industrial');
      box(-w * 0.2, -d * 0.1, w * 0.45, d * 0.6, h * 0.7, h * 0.3, 'industrial');
      const stacks = rng.int(1, 3);
      for (let i = 0; i < stacks; i++) {
        tiers.push({ shape: 'cylinder', ox: w * 0.3 - i * 2.4, oz: -d * 0.3, w: 1.6, d: 1.6, y0: h * 0.7, h: h * rng.range(0.9, 1.6), facade: 'none' });
      }
      rooftop = 'hvac';
      break;
    }
    case 'warehouse': {
      facade = 'industrial';
      windowDensity = 0.12;
      palette = rng.pick([10, 11, 3]);
      box(0, 0, w, d, 0, h, 'industrial');
      rooftop = 'flat';
      break;
    }
    case 'data_center': {
      facade = 'panel';
      windowDensity = 0.05;
      palette = 1;
      box(0, 0, w, d, 0, h, 'panel');
      rooftop = 'hvac';
      neon = { color: '#38bdf8', style: 'band' };
      break;
    }
    case 'hospital': {
      facade = 'grid';
      windowDensity = 0.85;
      palette = 12;
      box(0, 0, w, d * 0.5, 0, h, 'grid');
      box(0, 0, w * 0.4, d, 0, h * 0.75, 'grid');
      rooftop = 'helipad';
      neon = { color: '#f87171', style: 'crown' };
      break;
    }
    case 'parking': {
      facade = 'ribbon';
      windowDensity = 0.0;
      palette = 3;
      box(0, 0, w, d, 0, h, 'ribbon');
      rooftop = 'flat';
      break;
    }
    case 'power_plant': {
      facade = 'industrial';
      palette = 11;
      box(w * 0.2, 0, w * 0.55, d, 0, h * 0.55, 'industrial');
      tiers.push({ shape: 'cylinder', ox: -w * 0.28, oz: -d * 0.22, w: d * 0.42, d: d * 0.42, y0: 0, h, facade: 'none' });
      tiers.push({ shape: 'cylinder', ox: -w * 0.28, oz: d * 0.24, w: d * 0.42, d: d * 0.42, y0: 0, h: h * 0.85, facade: 'none' });
      rooftop = 'flat';
      neon = { color: '#a3e635', style: 'band' };
      break;
    }
    case 'water_facility': {
      facade = 'industrial';
      palette = 10;
      box(0, -d * 0.25, w, d * 0.5, 0, h * 0.6, 'industrial');
      for (let i = 0; i < 3; i++) {
        tiers.push({ shape: 'cylinder', ox: -w * 0.33 + i * w * 0.33, oz: d * 0.22, w: w * 0.26, d: w * 0.26, y0: 0, h: h * 0.7, facade: 'none' });
      }
      rooftop = 'flat';
      break;
    }
    case 'transit_hub': {
      facade = 'glass';
      windowDensity = 0.9;
      palette = 6;
      box(0, 0, w, d, 0, h * 0.7, 'glass');
      tiers.push({ shape: 'cylinder', ox: 0, oz: 0, w: d * 0.9, d: d * 0.9, y0: h * 0.7, h: h * 0.3, facade: 'glass' });
      rooftop = 'flat';
      neon = { color: '#facc15', style: 'band' };
      break;
    }
    default: {
      box(0, 0, w, d, 0, h, facade);
    }
  }
  return { tiers, facade, rooftop, windowDensity, palette, antennas, balconies, neon };
}

export function capacityFor(type: BuildingType, w: number, d: number, floors: number): { capacity: number; jobs: number } {
  const meta = BUILDING_TYPES[type];
  const areaFactor = (w * d) / 120;
  const residents = Math.round(meta.residentsPerFloor * floors * areaFactor);
  const jobs = Math.round(meta.jobsPerFloor * Math.min(floors, 40) * areaFactor * 2.2);
  let capacity: number;
  switch (meta.category) {
    case 'residential':
      capacity = Math.max(6, residents);
      break;
    case 'food':
    case 'retail':
      capacity = Math.max(8, Math.round(w * d * 0.35));
      break;
    case 'leisure':
      capacity = Math.max(30, Math.round(w * d * 0.6));
      break;
    case 'open':
      capacity = Math.round(w * d * 0.3);
      break;
    default:
      capacity = Math.max(10, jobs * 2);
  }
  return { capacity, jobs: meta.category === 'residential' ? Math.round(jobs) : Math.max(1, jobs) };
}

export function interiorFor(type: BuildingType, important: boolean): InteriorKind | null {
  const k = BUILDING_TYPES[type].interior;
  if (!k) return null;
  // every HQ/lab/university/landmark office is enterable; generic apartments/offices too
  return important || k === 'apartment' || k === 'office' ? k : null;
}
