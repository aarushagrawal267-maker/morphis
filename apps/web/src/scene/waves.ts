/**
 * Citizens currently waving back at a guest (from `citizen.waved` events).
 * Renderer-only state, keyed by citizen index.
 */
import { simClient } from '../sim/client';
import { useSim } from '../state/simStore';

export interface Wave {
  until: number;
  x: number;
  z: number;
}

export const WAVE_MS = 2800;
export const waves = new Map<number, Wave>();
const listeners = new Set<(citizenIds: string[]) => void>();
let attached = false;

export function onWavedBack(fn: (citizenIds: string[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function attachWaveListener(): void {
  if (attached) return;
  attached = true;
  simClient.onEvents((events) => {
    const ids: string[] = [];
    const sim = useSim.getState();
    for (const e of events) {
      if (e.type !== 'citizen.waved') continue;
      const p = sim.citizensById.get(e.payload.citizenId);
      if (!p) continue;
      waves.set(p.index, { until: performance.now() + WAVE_MS, x: e.payload.x, z: e.payload.z });
      ids.push(p.id);
    }
    if (ids.length) for (const l of listeners) l(ids);
  });
}

/** 0..1 arm raise for a citizen at time `now`. */
export function waveAmount(index: number, now: number): number {
  const w = waves.get(index);
  if (!w) return 0;
  const left = w.until - now;
  if (left <= 0) {
    waves.delete(index);
    return 0;
  }
  const age = WAVE_MS - left;
  return Math.min(1, age / 250, left / 300);
}
