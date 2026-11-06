/** Geometry helpers for the Skyrail loop (closed polyline). */
import type { RailLine } from '@morphis/shared';
import { hash01 } from '../positions';

/** Point and direction at distance s along the closed loop. */
export function railPoint(line: RailLine, s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const n = line.points.length / 2;
  const L = line.length;
  const sv = ((s % L) + L) % L;
  let lo = 0;
  let hi = n; // cum has n + 1 entries (closing segment)
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= sv) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const j = (i + 1) % n;
  const ax = line.points[i * 2];
  const az = line.points[i * 2 + 1];
  const bx = line.points[j * 2];
  const bz = line.points[j * 2 + 1];
  const seg = line.cum[i + 1] - line.cum[i] || 1;
  const t = Math.min(1, Math.max(0, (sv - line.cum[i]) / seg));
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.dx = (bx - ax) / l;
  out.dz = (bz - az) / l;
}

/** Where a citizen waiting on a station platform stands (y = platform level). */
export function platformSpot(line: RailLine, stationId: string, citizenIndex: number): { x: number; y: number; z: number } | null {
  const st = line.stations.find((s) => s.id === stationId);
  if (!st) return null;
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  railPoint(line, st.s + (hash01(citizenIndex) - 0.5) * 7, p);
  const side = hash01(citizenIndex + 3) > 0.5 ? 1 : -1;
  const off = 1.9 + hash01(citizenIndex + 11) * 0.5;
  return { x: p.x - p.dz * off * side, y: line.height + 0.35, z: p.z + p.dx * off * side };
}
