/**
 * World generation pipeline:
 *   SEED -> DISTRICTS -> ROAD NETWORK -> ZONING/BUILDINGS -> TRANSIT ->
 *   PEDESTRIAN NETWORK -> PROPS -> SKYLINE
 * The same CityConfig always yields the same StaticWorld (verified by `hash`).
 */
import type {
  BuildingDef,
  BuildingType,
  BusLine,
  BusStop,
  CityConfig,
  PropInstance,
  RoadEdge,
  SkylineBlock,
  StaticWorld,
  Vec2,
  WorldProps,
} from '@morphis/shared';
import { BUILDING_TYPES, DEFAULT_SEED, LANE_WIDTH, WORLD_VERSION } from '@morphis/shared';
import { Rng, hashString } from '../core/rng';
import { norm, perp, pointSegmentDistance, sub } from '../core/geom';
import { RoadNav, type Traversal } from '../nav/graphs';
import {
  BuildingPlacer,
  LANDMARKS,
  capacityFor,
  chooseType,
  heightFor,
  interiorFor,
  localToWorld,
  massingFor,
  nameFor,
  sizeFor,
} from './buildings';
import { buildDistricts, districtAt } from './districts';
import { buildPedGraph, type PedAttachment } from './pedestrian';
import { buildRail } from './rail';
import { finaliseIntersections, generateStrokes, planarise, sidewalkOffset } from './roads';

export function defaultConfig(overrides: Partial<CityConfig> = {}): CityConfig {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && !Number.isNaN(v))) as Partial<CityConfig>;
  return {
    seed: DEFAULT_SEED,
    size: 256,
    population: 400,
    coreCitizens: 25,
    buildingDensity: 1,
    roadDensity: 1,
    trafficDensity: 1,
    parkFrequency: 0.5,
    heightScale: 1,
    ...clean,
  };
}

export interface GeneratedWorld {
  world: StaticWorld;
  /** Landmark key (e.g. 'ai_lab') -> building id. */
  landmarks: Record<string, string>;
  /** "roadNode:roadEdge" -> crosswalk ped edge id. */
  crosswalkAt: Map<string, number>;
}

interface PlacementRecord {
  id: string;
  edge: number;
  side: 1 | -1;
  s: number;
}

export function generateWorld(config: CityConfig): GeneratedWorld {
  const rng = Rng.derive(config.seed, 'world');
  const size = config.size;
  const districts = buildDistricts(size);

  // ---------------------------------------------------------------- roads
  const { strokes } = generateStrokes(Rng.derive(config.seed, 'roads'), size, config.roadDensity);
  const { nodes, edges } = planarise(strokes);
  const corners = finaliseIntersections(nodes, edges);

  // ---------------------------------------------------------------- buildings
  const placer = new BuildingPlacer({
    rng,
    nodes,
    edges,
    corners,
    districts,
    size,
    buildingDensity: config.buildingDensity,
    heightScale: config.heightScale,
    parkFrequency: config.parkFrequency,
  });
  const buildings: BuildingDef[] = [];
  const records: PlacementRecord[] = [];
  const landmarks: Record<string, string> = {};

  const nextId = (): string => `building_${String(buildings.length).padStart(5, '0')}`;

  const finishDef = (
    type: BuildingType,
    name: string,
    center: Vec2,
    rot: number,
    w: number,
    d: number,
    h: number,
    opts: { named?: boolean; important?: boolean; sign?: string | null; construction?: boolean } = {},
  ): BuildingDef => {
    const district = districtAt(districts, center);
    const isOpen = type === 'park' || type === 'plaza';
    const m = isOpen
      ? { tiers: [], facade: 'none' as const, rooftop: 'flat' as const, windowDensity: 0, palette: 0, antennas: 0, balconies: false, neon: null }
      : massingFor(rng, type, w, d, h, district);
    const floors = isOpen ? 0 : Math.max(1, Math.round(h / 1.6));
    const { capacity, jobs } = capacityFor(type, w, d, floors);
    const important = !!opts.important;
    const entrance = localToWorld(center.x, center.z, rot, 0, d / 2);
    let sign = opts.sign ?? null;
    if (!sign && !isOpen && (type === 'shop' || type === 'cafe' || type === 'restaurant' || type === 'entertainment') && rng.chance(0.45)) {
      sign = name.toUpperCase();
    }
    return {
      id: nextId(),
      index: buildings.length,
      name,
      type,
      districtId: district.id,
      position: { x: r3(center.x), z: r3(center.z) },
      rotation: r3(rot),
      width: r3(w),
      depth: r3(d),
      height: r3(h),
      floorCount: floors,
      tiers: m.tiers.map((t) => ({ ...t, ox: r3(t.ox), oz: r3(t.oz), w: r3(t.w), d: r3(t.d), y0: r3(t.y0), h: r3(t.h) })),
      facade: m.facade,
      windowDensity: r3(m.windowDensity),
      palette: m.palette,
      rooftop: m.rooftop,
      neon: m.neon,
      sign,
      antennas: m.antennas,
      balconies: m.balconies,
      entrance: { x: r3(entrance.x), z: r3(entrance.z) },
      entranceNode: -1,
      access: { edge: -1, s: 0, side: 1, point: { x: 0, z: 0 } },
      capacity,
      jobs,
      enterable: !isOpen && interiorFor(type, important) !== null,
      interior: isOpen ? null : interiorFor(type, important),
      named: !!opts.named,
      important,
      construction: !!opts.construction,
    };
  };

  // JARVIS HQ in the plaza ring
  {
    const w = 18;
    const d = 18;
    const h = 96 * config.heightScale;
    const def = finishDef('hq', 'JARVIS HQ', { x: 0, z: 0 }, 0, w, d, h, { named: true, important: true, sign: 'JARVIS' });
    def.tiers = [
      { shape: 'cylinder', ox: 0, oz: 0, w: 22, d: 22, y0: 0, h: 5, facade: 'glass' },
      { shape: 'hex', ox: 0, oz: 0, w: 15, d: 15, y0: 5, h: h * 0.55, facade: 'glass' },
      { shape: 'hex', ox: 0, oz: 0, w: 11, d: 11, y0: 5 + h * 0.55, h: h * 0.3, facade: 'ribbon' },
      { shape: 'cylinder', ox: 0, oz: 0, w: 5, d: 5, y0: 5 + h * 0.85, h: h * 0.15 - 5, facade: 'none' },
    ];
    def.rooftop = 'spire';
    def.neon = { color: '#22d3ee', style: 'edge' };
    def.capacity = 400;
    def.jobs = 60;
    def.entrance = { x: 0, z: 11 };
    def.enterable = true;
    def.interior = 'hq';
    buildings.push(def);
    landmarks.hq = def.id;
    placer.add({ cx: 0, cz: 0, hw: 11, hd: 11, rot: 0 }, def);
    placer.reserveName(def.name);
    records.push({ id: def.id, ...nearestAccess({ x: 0, z: 19 }) });
  }

  function nearestAccess(p: Vec2): { edge: number; side: 1 | -1; s: number } {
    let best = { edge: 0, side: 1 as 1 | -1, s: 0, d: Infinity };
    for (const e of edges) {
      if (e.cls === 'highway') continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const r = pointSegmentDistance(p, a, b);
      if (r.d < best.d) {
        const u = norm(sub(b, a));
        const pp = perp(u);
        const side: 1 | -1 = (p.x - a.x) * pp.x + (p.z - a.z) * pp.z >= 0 ? 1 : -1;
        best = { edge: e.id, side, s: r.t * e.length, d: r.d };
      }
    }
    return { edge: best.edge, side: best.side, s: best.s };
  }

  // Landmarks and parks, placed near their targets
  const k = size / 256;
  const tryPlaceNear = (target: Vec2, w: number, d: number): { edge: RoadEdge; side: 1 | -1; s: number; rot: number; center: Vec2; obb: import('../core/geom').OBB } | null => {
    const cands = edges
      .filter((e) => e.cls !== 'highway')
      .map((e) => ({ e, r: pointSegmentDistance(target, nodes[e.a], nodes[e.b]) }))
      .sort((p, q) => p.r.d - q.r.d)
      .slice(0, 14);
    for (const { e, r } of cands) {
      for (const side of [1, -1] as const) {
        const [t0, t1] = placer.frontageInterval(e, side);
        if (t1 - t0 < w * 0.8) continue;
        const sT = r.t * e.length - w / 2;
        for (let o = 0; o <= 24; o += 2) {
          for (const sgn of [1, -1]) {
            const s = Math.max(t0, Math.min(t1 - w, sT + o * sgn));
            for (const scaleD of [1, 0.85, 0.7]) {
              const res = placer.tryAt(e, side, s, w, d * scaleD);
              if (res) return { edge: e, side, s, ...res };
            }
          }
        }
      }
    }
    return null;
  };

  for (const lm of LANDMARKS) {
    const target = { x: lm.target[0] * k, z: lm.target[1] * k };
    const res = tryPlaceNear(target, lm.w, lm.d);
    if (!res) continue;
    const realD = res.obb.hd * 2;
    const def = finishDef(lm.type, lm.name, res.center, res.rot, lm.w, realD, lm.h * config.heightScale, {
      named: true,
      important: true,
      sign: lm.sign ?? null,
    });
    buildings.push(def);
    landmarks[lm.key] = def.id;
    placer.add(res.obb, def);
    placer.reserveName(lm.name);
    records.push({ id: def.id, edge: res.edge.id, side: res.side, s: res.s + lm.w / 2 });
  }

  // extra neighbourhood parks
  const parkDistricts = districts.filter((d) => ['residential', 'creative', 'education', 'healthcare', 'central', 'technology'].includes(d.type));
  const extraParks = Math.round(config.parkFrequency * 8);
  for (let i = 0; i < extraParks; i++) {
    const d = rng.pick(parkDistricts);
    const target = { x: d.center.x + rng.range(-d.radius, d.radius) * 0.7, z: d.center.z + rng.range(-d.radius, d.radius) * 0.7 };
    const w = rng.range(14, 22);
    const dd = rng.range(12, 18);
    const res = tryPlaceNear(target, w, dd);
    if (!res) continue;
    const name = placer.uniqueName(() => nameFor(rng, 'park', d.name, i));
    const def = finishDef('park', name, res.center, res.rot, w, res.obb.hd * 2, 0, { named: false });
    buildings.push(def);
    placer.add(res.obb, def);
    records.push({ id: def.id, edge: res.edge.id, side: res.side, s: res.s + w / 2 });
  }

  // frontage fill
  const growable: { def: BuildingDef; placedIndex: number; edge: RoadEdge; side: 1 | -1; s: number; w: number; avail: number }[] = [];
  const rank = { highway: 3, avenue: 2, street: 1, local: 0 } as const;
  const order = rng.shuffle(edges.filter((e) => e.cls !== 'highway').slice()).sort((p, q) => rank[q.cls] - rank[p.cls]);
  for (const e of order) {
    for (const side of [1, -1] as const) {
      const [t0, t1] = placer.frontageInterval(e, side);
      let s = t0;
      let guard = 0;
      while (s < t1 - 3.5 && guard++ < 200) {
        const f = placer.frontageFrame(e, side);
        const probe = { x: f.a.x + f.u.x * s + f.out.x * (f.off + 4), z: f.a.z + f.u.z * s + f.out.z * (f.off + 4) };
        const district = districtAt(districts, probe);
        const density = Math.min(1, district.buildingDensity * config.buildingDensity + 0.15);
        if (!rng.chance(density)) {
          s += rng.range(2, 5);
          continue;
        }
        let type = chooseType(rng, district, e.cls);
        const size = sizeFor(rng, type);
        let w = size.w;
        const d = size.d;
        const remaining = t1 - s;
        if (remaining < w) {
          if (remaining < 4) break;
          w = remaining;
          if (w < 7 && !['shop', 'cafe', 'restaurant'].includes(type)) type = rng.pick(['shop', 'cafe', 'restaurant'] as const);
        }
        let placed = null as ReturnType<typeof placer.tryAt>;
        let usedD = d;
        const avail = placer.depthAvailable(e, side, s, w);
        // share the block with the street behind: never take more than half the depth
        const dMax = avail < 2 * d + 1 ? Math.max(4.5, avail / 2 - 0.4) : d;
        outer: for (const wf of [1, 0.7]) {
          const ww = Math.max(4.5, w * wf);
          for (const df of [1, 0.8, 0.62]) {
            const dd = Math.max(4.5, dMax * df);
            placed = placer.tryAt(e, side, s, ww, dd);
            if (placed) {
              usedD = dd;
              w = ww;
              break outer;
            }
          }
        }
        if (!placed) {
          s += 1.5;
          continue;
        }
        const name = placer.uniqueName(() => nameFor(rng, type, district.name, buildings.length));
        const h = heightFor(rng, type, district, placed.center, config.heightScale);
        const construction =
          ['office', 'corporate_tower'].includes(type) && ['technology', 'corporate', 'central', 'finance'].includes(district.type) && rng.chance(0.05);
        const def = finishDef(type, name, placed.center, placed.rot, w, usedD, h, { construction });
        buildings.push(def);
        placer.add(placed.obb, def);
        records.push({ id: def.id, edge: e.id, side, s: s + w / 2 });
        growable.push({ def, placedIndex: placer.placed.length - 1, edge: e, side, s, w, avail });
        s += w + rng.range(0.4, 1.2);
      }
    }
  }

  // second pass: grow lots backwards into block interiors left free by the opposite street
  const maxDepthFor = (t: BuildingType): number =>
    ['factory', 'warehouse', 'corporate_tower', 'data_center', 'parking'].includes(t) ? 26 : ['shop', 'cafe', 'restaurant'].includes(t) ? 14 : 20;
  for (const g of growable) {
    const target = Math.min(maxDepthFor(g.def.type), g.avail - 0.4);
    if (target <= g.def.depth + 1) continue;
    const grown = placer.tryGrow(g.placedIndex, g.edge, g.side, g.s, g.w, target);
    if (grown === null) continue;
    const ob = placer.placed[g.placedIndex].obb;
    const m = massingFor(rng, g.def.type, g.w, grown, g.def.height, districts.find((d) => d.id === g.def.districtId)!);
    const floors = Math.max(1, Math.round(g.def.height / 1.6));
    const cap = capacityFor(g.def.type, g.w, grown, floors);
    Object.assign(g.def, {
      position: { x: r3(ob.cx), z: r3(ob.cz) },
      depth: r3(grown),
      tiers: m.tiers.map((t) => ({ ...t, ox: r3(t.ox), oz: r3(t.oz), w: r3(t.w), d: r3(t.d), y0: r3(t.y0), h: r3(t.h) })),
      facade: m.facade,
      rooftop: m.rooftop,
      windowDensity: r3(m.windowDensity),
      palette: m.palette,
      antennas: m.antennas,
      balconies: m.balconies,
      neon: g.def.neon ?? m.neon,
      capacity: cap.capacity,
      jobs: cap.jobs,
    });
    const ent = localToWorld(ob.cx, ob.cz, g.def.rotation, 0, grown / 2);
    g.def.entrance = { x: r3(ent.x), z: r3(ent.z) };
  }

  // third pass: backfill holes inside blocks with buildings aligned to the nearest street
  {
    const lim = size / 2 - 14;
    const pts: Vec2[] = [];
    for (let x = -lim; x <= lim; x += 3) for (let z = -lim; z <= lim; z += 3) pts.push({ x, z });
    rng.shuffle(pts);
    for (const pt of pts) {
      const acc = nearestAccess(pt);
      const e = edges[acc.edge];
      const a = nodes[e.a];
      const u = norm(sub(nodes[e.b], a));
      const pp = perp(u);
      const out = { x: pp.x * acc.side, z: pp.z * acc.side };
      const rot = Math.atan2(-out.x, -out.z);
      const district = districtAt(districts, pt);
      if (district.type === 'command') continue;
      const type = chooseType(rng, district, 'local');
      const base = sizeFor(rng, type);
      for (const f of [1, 0.75, 0.55]) {
        const w = Math.max(5, base.w * f);
        const d = Math.max(5, base.d * f);
        const obb = { cx: pt.x, cz: pt.z, hw: w / 2, hd: d / 2, rot: -rot };
        if (!placer.fits(obb, 0.6, 0.6)) continue;
        const name = placer.uniqueName(() => nameFor(rng, type, district.name, buildings.length));
        const h = heightFor(rng, type, district, pt, config.heightScale);
        const def = finishDef(type, name, pt, rot, w, d, h);
        buildings.push(def);
        placer.add(obb, def);
        records.push({ id: def.id, edge: acc.edge, side: acc.side, s: acc.s });
        break;
      }
    }
  }

  // vehicle access points
  const byId = new Map(buildings.map((b) => [b.id, b]));
  for (const r of records) {
    const b = byId.get(r.id)!;
    const e = edges[r.edge];
    const s = Math.max(e.setbackA + 1.5, Math.min(e.length - e.setbackB - 1.5, r.s));
    b.access = { edge: e.id, s: r3(s), side: r.side, point: kerbPoint(e, s, r.side) };
  }

  function kerbPoint(e: RoadEdge, s: number, side: 1 | -1): Vec2 {
    const a = nodes[e.a];
    const u = norm(sub(nodes[e.b], a));
    const p = perp(u);
    const off = e.median / 2 + (e.lanes - 0.5) * LANE_WIDTH;
    return { x: r3(a.x + u.x * s + p.x * side * off), z: r3(a.z + u.z * s + p.z * side * off) };
  }

  // ---------------------------------------------------------------- transit
  const nav = new RoadNav(nodes, edges);
  const nodeNear = (id: string | undefined, fallback: Vec2): number => {
    const b = id ? byId.get(id) : undefined;
    if (b) {
      const e = edges[b.access.edge];
      return b.access.s < e.length / 2 ? e.a : e.b;
    }
    let best = 0;
    let bd = Infinity;
    for (const n of nodes) {
      if (n.gate) continue;
      const dd = Math.hypot(n.x - fallback.x, n.z - fallback.z);
      if (dd < bd) {
        bd = dd;
        best = n.id;
      }
    }
    return best;
  };
  const lineDefs: { id: string; name: string; color: string; via: string[] }[] = [
    { id: 'line_1', name: 'Neon Loop', color: '#22d3ee', via: ['station', 'market', 'studio', 'university', 'ai_lab', 'orbital', 'corporate', 'bank', 'hospital', 'forge'] },
    { id: 'line_2', name: 'Meridian Line', color: '#fbbf24', via: ['station', 'cityhall', 'library', 'ai_lab', 'cybercafe', 'skyline'] },
    { id: 'line_3', name: 'Crosstown', color: '#e879f9', via: ['school', 'lumen_park', 'cityhall', 'skyline', 'bank', 'hospital', 'synapse_gardens', 'arena'] },
  ];
  const busStops: BusStop[] = [];
  const busLines: BusLine[] = [];
  const stopKey = new Map<string, string>();
  for (const ld of lineDefs) {
    const wps = ld.via.map((key) => nodeNear(landmarks[key], { x: 0, z: 0 }));
    const path: Traversal[] = [];
    let ok = true;
    for (let i = 0; i < wps.length; i++) {
      const from = wps[i];
      const to = wps[(i + 1) % wps.length];
      const exclude = new Set<number>();
      if (path.length) exclude.add(path[path.length - 1].edge);
      for (const ed of edges) if (ed.cls === 'highway') exclude.add(ed.id);
      const leg = nav.route(from, to, { exclude }) ?? nav.route(from, to, {});
      if (!leg) {
        ok = false;
        break;
      }
      path.push(...leg);
    }
    if (!ok || path.length < 3) continue;
    const stops: string[] = [];
    let acc = 40;
    for (const t of path) {
      const e = edges[t.edge];
      acc += e.length;
      if (acc < 55 || e.sidewalk <= 0 || e.length < e.setbackA + e.setbackB + 10) continue;
      acc = 0;
      const side: 1 | -1 = t.dir === 0 ? 1 : -1;
      const sk = `${e.id}:${side}`;
      let sid = stopKey.get(sk);
      if (!sid) {
        sid = `stop_${String(busStops.length).padStart(3, '0')}`;
        stopKey.set(sk, sid);
        const s = e.setbackA + (e.length - e.setbackA - e.setbackB) / 2;
        busStops.push({ id: sid, name: `${e.name} Stop`, pedNode: -1, edge: e.id, s: r3(s), side, position: kerbPoint(e, s, side) });
      }
      if (stops[stops.length - 1] !== sid && stops[0] !== sid) stops.push(sid);
    }
    if (stops.length >= 2) busLines.push({ id: ld.id, name: ld.name, color: ld.color, stops });
  }

  // ---------------------------------------------------------------- pedestrian network
  const attachments: PedAttachment[] = [];
  for (const b of buildings) {
    const open = b.type === 'park' || b.type === 'plaza';
    attachments.push({
      key: b.id,
      edge: b.access.edge,
      side: b.access.side,
      point: b.entrance,
      kind: 'entrance',
      buildingId: b.id,
      inner: open ? b.position : undefined,
    });
  }
  for (const st of busStops) {
    const e = edges[st.edge];
    const a = nodes[e.a];
    const u = norm(sub(nodes[e.b], a));
    const p = perp(u);
    const off = sidewalkOffset(e);
    attachments.push({
      key: st.id,
      edge: st.edge,
      side: st.side,
      point: { x: a.x + u.x * st.s + p.x * st.side * off, z: a.z + u.z * st.s + p.z * st.side * off },
      kind: 'stop',
    });
  }
  const ped = buildPedGraph(nodes, edges, corners, attachments);
  for (const b of buildings) b.entranceNode = ped.attachNode.get(b.id) ?? -1;
  for (const st of busStops) st.pedNode = ped.attachNode.get(st.id) ?? -1;

  // ---------------------------------------------------------------- props + skyline
  const rail = buildRail(nodes, edges, nav, landmarks, buildings, ped.nodes, (id) => nodeNear(id, { x: 0, z: 0 }));
  const props = generateProps(Rng.derive(config.seed, 'props'), nodes, edges, buildings, busStops, ped.nodes, ped.edges);
  const skyline = generateSkyline(Rng.derive(config.seed, 'skyline'), size);

  const world: StaticWorld = {
    version: WORLD_VERSION,
    seed: config.seed,
    config,
    size,
    hash: '',
    districts,
    roads: { nodes, edges },
    ped: { nodes: ped.nodes, edges: ped.edges },
    buildings,
    props,
    busStops,
    busLines,
    rail,
    skyline,
    landmarks: buildings.filter((b) => b.named).map((b) => b.id),
    hqId: landmarks.hq,
  };
  world.hash = worldHash(world);
  return { world, landmarks, crosswalkAt: ped.crosswalkAt };
}

export function worldHash(w: StaticWorld): string {
  const core = JSON.stringify([
    w.seed,
    w.roads.nodes.map((n) => [n.x, n.z]),
    w.roads.edges.map((e) => [e.a, e.b, e.cls]),
    w.buildings.map((b) => [b.id, b.type, b.position.x, b.position.z, b.height]),
    w.ped.nodes.length,
    w.ped.edges.length,
  ]);
  return hashString(core).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ props

function generateProps(
  rng: Rng,
  nodes: StaticWorld['roads']['nodes'],
  edges: RoadEdge[],
  buildings: BuildingDef[],
  stops: BusStop[],
  pedNodes: StaticWorld['ped']['nodes'],
  pedEdges: StaticWorld['ped']['edges'],
): WorldProps {
  const props: WorldProps = {
    streetLights: [],
    trees: [],
    benches: [],
    planters: [],
    billboards: [],
    vents: [],
    barriers: [],
    parkedCars: [],
    busStops: [],
    crosswalks: [],
  };
  const P = (x: number, z: number, r: number, s?: number, kk?: number): PropInstance => {
    const o: PropInstance = { x: r3(x), z: r3(z), r: r3(r) };
    if (s !== undefined) o.s = r3(s);
    if (kk !== undefined) o.k = kk;
    return o;
  };

  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const u = norm(sub(b, a));
    const p = perp(u);
    const s0 = e.setbackA + 2;
    const s1 = e.length - e.setbackB - 2;
    if (s1 <= s0) continue;
    if (e.cls === 'highway') {
      // median lights and side barriers
      for (let s = s0; s < s1; s += 15) {
        props.streetLights.push(P(a.x + u.x * s, a.z + u.z * s, Math.atan2(u.x, u.z), 0, 1));
      }
      for (const side of [1, -1]) {
        const off = e.width / 2 + 0.4;
        for (let s = s0; s < s1; s += 6) {
          props.barriers.push(P(a.x + u.x * (s + 3) + p.x * side * off, a.z + u.z * (s + 3) + p.z * side * off, Math.atan2(u.x, u.z), Math.min(6, s1 - s)));
        }
      }
      continue;
    }
    const spacing = e.cls === 'avenue' ? 13 : 16;
    for (const side of [1, -1] as const) {
      const lightOff = e.width / 2 + 0.35;
      const treeOff = e.width / 2 + e.sidewalk * 0.72;
      const phase = side === 1 ? 0 : spacing / 2;
      for (let s = s0 + phase; s < s1; s += spacing) {
        props.streetLights.push(
          P(a.x + u.x * s + p.x * side * lightOff, a.z + u.z * s + p.z * side * lightOff, Math.atan2(-p.x * side, -p.z * side), 0, 0),
        );
        if (e.sidewalk >= 1.5 && rng.chance(e.cls === 'avenue' ? 0.8 : 0.45)) {
          const ts = s + spacing / 2;
          if (ts < s1) props.trees.push(P(a.x + u.x * ts + p.x * side * treeOff, a.z + u.z * ts + p.z * side * treeOff, rng.range(0, 6.28), rng.range(0.8, 1.2), 0));
        }
        if (rng.chance(0.06)) {
          const vs = s + rng.range(2, spacing - 2);
          if (vs < s1) props.vents.push(P(a.x + u.x * vs + p.x * side * (e.width / 2 - 1.2), a.z + u.z * vs + p.z * side * (e.width / 2 - 1.2), 0));
        }
      }
    }
  }

  // parks, plaza
  for (const b of buildings) {
    if (b.type === 'park') {
      const n = Math.round((b.width * b.depth) / 22);
      for (let i = 0; i < n; i++) {
        const lx = rng.range(-b.width / 2 + 1, b.width / 2 - 1);
        const lz = rng.range(-b.depth / 2 + 1, b.depth / 2 - 1);
        if (Math.abs(lx) < 1.6 || Math.hypot(lx, lz) < 3) continue; // keep the paths clear
        const w = localToWorld(b.position.x, b.position.z, b.rotation, lx, lz);
        props.trees.push(P(w.x, w.z, rng.range(0, 6.28), rng.range(0.8, 1.5), rng.int(0, 2)));
      }
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + 0.4;
        const w = localToWorld(b.position.x, b.position.z, b.rotation, Math.cos(ang) * 4, Math.sin(ang) * 4);
        props.benches.push(P(w.x, w.z, b.rotation + ang + Math.PI / 2));
      }
    } else if (b.type === 'hq') {
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const r = 12.6;
        if (Math.abs(ang - Math.PI / 2) < 0.4) continue; // entrance path (south, +z)
        props.planters.push(P(Math.cos(ang) * r, Math.sin(ang) * r, ang));
        if (i % 2 === 0) props.trees.push(P(Math.cos(ang + 0.26) * r, Math.sin(ang + 0.26) * r, ang, 1.1, 1));
      }
    } else if (b.type === 'parking') {
      const top = b.tiers[0];
      if (!top) continue;
      for (let i = 0; i < Math.floor((b.width - 2) / 2.6); i++) {
        if (!rng.chance(0.6)) continue;
        const lx = -b.width / 2 + 1.6 + i * 2.6;
        const w = localToWorld(b.position.x, b.position.z, b.rotation, lx, rng.chance(0.5) ? -b.depth * 0.25 : b.depth * 0.25);
        props.parkedCars.push(P(w.x, w.z, b.rotation, top.h, rng.int(0, 5)));
      }
    }
    // rooftop billboards on some mid-rise buildings in lively districts
    if (b.tiers.length && b.height > 10 && b.height < 45 && !b.named && rng.chance(b.neon ? 0.35 : 0.08)) {
      const top = b.tiers.reduce((m, t) => (t.y0 + t.h > m.y0 + m.h ? t : m), b.tiers[0]);
      if (top.shape === 'box' && top.w > 6) {
        const w = localToWorld(b.position.x, b.position.z, b.rotation, top.ox, top.oz);
        props.billboards.push(P(w.x, w.z, b.rotation, top.y0 + top.h, rng.int(0, 7)));
      }
    }
  }

  for (const st of stops) {
    const e = edges[st.edge];
    const a = nodes[e.a];
    const u = norm(sub(nodes[e.b], a));
    const p = perp(u);
    const off = e.width / 2 + e.sidewalk * 0.75;
    props.busStops.push(P(a.x + u.x * st.s + p.x * st.side * off, a.z + u.z * st.s + p.z * st.side * off, Math.atan2(-p.x * st.side, -p.z * st.side)));
  }

  for (const pe of pedEdges) {
    if (pe.kind !== 'crosswalk') continue;
    const na = pedNodes[pe.a];
    const nb = pedNodes[pe.b];
    props.crosswalks.push(P((na.x + nb.x) / 2, (na.z + nb.z) / 2, Math.atan2(nb.x - na.x, nb.z - na.z), pe.length));
  }
  return props;
}

function generateSkyline(rng: Rng, size: number): SkylineBlock[] {
  const out: SkylineBlock[] = [];
  const half = size / 2;
  for (let i = 0; i < 560; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = half + 170 + Math.pow(rng.float(), 0.8) * 420;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    // keep expressway corridors clear
    if (Math.abs(x) < 9 && Math.abs(z) > half) continue;
    if (Math.abs(z - 6) < 9 && Math.abs(x) > half) continue;
    const far = (r - half - 170) / 420;
    const w = rng.range(10, 24) * (1 + far);
    out.push({ x: r3(x), z: r3(z), w: r3(w), d: r3(w * rng.range(0.7, 1.3)), h: r3(rng.range(18, 60) * (1 + far * 2.2) * (rng.chance(0.1) ? 1.7 : 1)) });
  }
  return out;
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function buildingMeta(type: BuildingType) {
  return BUILDING_TYPES[type];
}
