import type { Vec2 } from '@morphis/shared';

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};
export const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
};
/** Rotate +90° in the atan2(z, x) sense. Seen from above (z = south) this is the RIGHT-hand side. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.z, z: a.x });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const angleOf = (a: Vec2): number => Math.atan2(a.z, a.x);
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return { d: Math.hypot(p.x - cx, p.z - cz), t };
}

/** Proper segment intersection; returns parameters along both segments. */
export function segmentIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { t: number; u: number; p: Vec2 } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, p: add(a, scale(r, t)) };
}

/** Intersection of two infinite lines p + r t and q + s u. */
export function lineIntersection(p: Vec2, r: Vec2, q: Vec2, s: Vec2): Vec2 | null {
  const den = cross(r, s);
  if (Math.abs(den) < 1e-6) return null;
  const t = cross(sub(q, p), s) / den;
  return add(p, scale(r, t));
}

export interface OBB {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  rot: number;
}

export function obbCorners(o: OBB): Vec2[] {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const pts: Vec2[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const lx = sx * o.hw;
    const lz = sz * o.hd;
    pts.push({ x: o.cx + lx * c - lz * s, z: o.cz + lx * s + lz * c });
  }
  return pts;
}

/** Separating axis test for two oriented rectangles. */
export function obbOverlap(a: OBB, b: OBB, margin = 0): boolean {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  const ca = obbCorners({ ...a, hw: a.hw + margin, hd: a.hd + margin });
  const cb = obbCorners(b);
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const az = Math.sin(ang);
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of ca) {
      const d = p.x * ax + p.z * az;
      if (d < amin) amin = d;
      if (d > amax) amax = d;
    }
    for (const p of cb) {
      const d = p.x * ax + p.z * az;
      if (d < bmin) bmin = d;
      if (d > bmax) bmax = d;
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/** Distance from an oriented rectangle to a segment (0 if overlapping). */
export function obbSegmentDistance(o: OBB, a: Vec2, b: Vec2): number {
  // transform segment into box local space
  const c = Math.cos(-o.rot);
  const s = Math.sin(-o.rot);
  const toLocal = (p: Vec2): Vec2 => {
    const dx = p.x - o.cx;
    const dz = p.z - o.cz;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  const la = toLocal(a);
  const lb = toLocal(b);
  // sample-free exact: distance between segment and axis-aligned box
  const boxDist = (p: Vec2): number => {
    const dx = Math.max(Math.abs(p.x) - o.hw, 0);
    const dz = Math.max(Math.abs(p.z) - o.hd, 0);
    return Math.hypot(dx, dz);
  };
  // check intersection of segment with box edges
  const corners = obbCorners({ cx: 0, cz: 0, hw: o.hw, hd: o.hd, rot: 0 });
  for (let i = 0; i < 4; i++) {
    if (segmentIntersection(la, lb, corners[i], corners[(i + 1) % 4])) return 0;
  }
  if (Math.abs(la.x) <= o.hw && Math.abs(la.z) <= o.hd) return 0;
  let best = Math.min(boxDist(la), boxDist(lb));
  for (const cpt of corners) best = Math.min(best, pointSegmentDistance(cpt, la, lb).d);
  return best;
}

/** Polyline helpers: flattened [x0,z0,x1,z1,...] */
export function polylineCum(points: number[]): number[] {
  const cum = [0];
  for (let i = 2; i < points.length; i += 2) {
    cum.push(cum[cum.length - 1] + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]));
  }
  return cum;
}

export function samplePolyline(points: number[], cum: number[], s: number, out: { x: number; z: number; dx: number; dz: number }): void {
  const n = cum.length;
  if (n === 1) {
    out.x = points[0];
    out.z = points[1];
    out.dx = 1;
    out.dz = 0;
    return;
  }
  if (s <= 0) s = 0;
  const total = cum[n - 1];
  if (s >= total) s = total;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1e-6;
  const t = (s - cum[lo]) / segLen;
  const ax = points[lo * 2];
  const az = points[lo * 2 + 1];
  const bx = points[hi * 2];
  const bz = points[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / segLen;
  out.dz = (bz - az) / segLen;
}
