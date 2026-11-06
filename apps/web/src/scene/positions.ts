/**
 * Where is an entity right now? Combines interpolated motion (walking /
 * driving) with simulation location (inside a building, waiting at a stop,
 * riding a vehicle, strolling in a park).
 */
import * as THREE from 'three';
import type { BuildingDef, CitizenDynamic } from '@morphis/shared';
import { localToWorld } from '@morphis/sim';
import { simClient } from '../sim/client';
import { useSim } from '../state/simStore';

const out = new THREE.Vector3();

export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Stand-still spot for a citizen inside an open-air place (park/plaza). */
export function parkSpot(b: BuildingDef, citizenIndex: number, time: number): { x: number; z: number; dir: number } {
  const a = hash01(citizenIndex) * Math.PI * 2 + time * 0.00004 * (hash01(citizenIndex + 7) - 0.5);
  const r = 2.5 + hash01(citizenIndex + 3) * Math.min(b.width, b.depth) * 0.32;
  const lx = Math.cos(a) * r * (b.width / Math.max(b.width, b.depth));
  const lz = Math.sin(a) * r * (b.depth / Math.max(b.width, b.depth));
  const p = localToWorld(b.position.x, b.position.z, b.rotation, lx, lz);
  return { x: p.x, z: p.z, dir: a + Math.PI / 2 };
}

export function stopSpot(stopId: string, citizenIndex: number): { x: number; z: number } | null {
  const world = useSim.getState().world;
  const st = world?.busStops.find((s) => s.id === stopId);
  if (!world || !st) return null;
  const e = world.roads.edges[st.edge];
  const a = world.roads.nodes[e.a];
  const b = world.roads.nodes[e.b];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / l;
  const uz = (b.z - a.z) / l;
  const off = e.width / 2 + e.sidewalk * 0.55;
  const along = st.s + (hash01(citizenIndex) - 0.5) * 3;
  return { x: a.x + ux * along - uz * st.side * off, z: a.z + uz * along + ux * st.side * off };
}

/** Current world position of a citizen (y = 0 ground), or null if unknown. */
export function citizenPosition(index: number, dyn?: CitizenDynamic): THREE.Vector3 | null {
  const sample = simClient.sampleMotion();
  if (sample && sample.cVisible[index]) return out.set(sample.cX[index], 0.15, sample.cZ[index]);
  const sim = useSim.getState();
  const d = dyn ?? sim.state?.citizens[index];
  if (!d) return null;
  const loc = d.location;
  if (loc.kind === 'building') {
    const b = sim.buildingsById.get(loc.id);
    if (!b) return null;
    if (b.type === 'park' || b.type === 'plaza') {
      const p = parkSpot(b, index, sample?.time ?? 0);
      return out.set(p.x, 0.2, p.z);
    }
    return out.set(b.entrance.x, 0.15, b.entrance.z);
  }
  if (loc.kind === 'stop') {
    const p = stopSpot(loc.id, index);
    return p ? out.set(p.x, 0.15, p.z) : null;
  }
  if (loc.kind === 'vehicle') {
    const v = sim.vehicles.findIndex((x) => x.id === loc.id);
    if (v >= 0) return vehiclePosition(v);
  }
  return null;
}

export function vehiclePosition(index: number): THREE.Vector3 | null {
  const sample = simClient.sampleMotion();
  if (sample && sample.vVisible[index]) return out.set(sample.vX[index], 0.6, sample.vZ[index]);
  const sim = useSim.getState();
  const d = sim.state?.vehicles[index];
  if (d?.parkedAt) {
    const b = sim.buildingsById.get(d.parkedAt);
    if (b) return out.set(b.access.point.x, 0.6, b.access.point.z);
  }
  return null;
}
