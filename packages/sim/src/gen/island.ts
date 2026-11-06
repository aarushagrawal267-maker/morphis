/**
 * The floating island: an organic, rounded-square outline that encloses every
 * road and building with a margin, plus the sky-lift portals at the ends of
 * the expressways, and the small islets that drift around it.
 */
import type { IslandShape, SkylineBlock, Vec2 } from '@morphis/shared';
import type { Rng } from '../core/rng';

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildIsland(rng: Rng, size: number, content: Vec2[], lifts: Vec2[]): IslandShape {
  const half = size / 2;
  const N = 200;
  const p = 4.2;
  const R = half + 5;
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const radius: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    const base = R / Math.pow(Math.pow(c, p) + Math.pow(s, p), 1 / p);
    const n = 3.2 * Math.sin(3 * a + ph[0]) + 2.1 * Math.sin(7 * a + ph[1]) + 1.1 * Math.sin(13 * a + ph[2]) + 0.6 * Math.sin(29 * a + ph[3]);
    radius.push(base + 4 + n);
  }
  // nothing may hang over the edge: push the outline out where content comes close
  const bump = (pt: Vec2, margin: number) => {
    const a = (Math.atan2(pt.z, pt.x) + Math.PI * 2) % (Math.PI * 2);
    const r = Math.hypot(pt.x, pt.z) + margin;
    const i0 = Math.round((a / (Math.PI * 2)) * N);
    for (let k = -3; k <= 3; k++) {
      const i = (((i0 + k) % N) + N) % N;
      const need = r - Math.abs(k) * 0.8;
      if (radius[i] < need) radius[i] = need;
    }
  };
  for (const pt of content) bump(pt, 5);
  for (const pt of lifts) bump(pt, 3);
  // light smoothing so bumps blend into the coastline
  const smooth = radius.map((_, i) => (radius[(i - 1 + N) % N] + 2 * radius[i] + radius[(i + 1) % N]) / 4);
  const outline: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = Math.max(smooth[i], radius[i] - 0.5);
    outline.push(r2(Math.cos(a) * r), r2(Math.sin(a) * r));
  }
  return { outline, depth: r2(half * 0.75), lifts: lifts.map((l) => ({ x: r2(l.x), z: r2(l.z) })) };
}

/** Small floating islets around the island (scenery only). */
export function buildIslets(rng: Rng, size: number): SkylineBlock[] {
  const half = size / 2;
  const out: SkylineBlock[] = [];
  for (let i = 0; i < 34; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = half + 80 + Math.pow(rng.float(), 0.7) * 420;
    const w = rng.range(6, 30) * (1 + (r - half) / 600);
    out.push({
      x: r2(Math.cos(ang) * r),
      z: r2(Math.sin(ang) * r),
      w: r2(w),
      d: r2(w * rng.range(0.7, 1.3)),
      h: r2(w * rng.range(0.7, 1.4)),
      y: r2(rng.range(-70, 35)),
    });
  }
  return out;
}

/**
 * Fill the gaps between buildings with trees (the island is green wherever
 * there is no road, sidewalk, building or park path).
 */
export function fillerTrees(
  rng: Rng,
  island: IslandShape,
  roads: { a: Vec2; b: Vec2; clear: number }[],
  footprints: { x: number; z: number; c: number; s: number; hw: number; hd: number }[],
  keepClear: Vec2[],
): { x: number; z: number; r: number; s: number; k: number }[] {
  const N = island.outline.length / 2;
  const edgeR = (x: number, z: number): number => {
    const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.round((a / (Math.PI * 2)) * N) % N;
    return Math.hypot(island.outline[i * 2], island.outline[i * 2 + 1]);
  };
  const out: { x: number; z: number; r: number; s: number; k: number }[] = [];
  const step = 4.2;
  const ext = Math.max(...island.outline.map(Math.abs));
  for (let gx = -ext; gx <= ext; gx += step) {
    for (let gz = -ext; gz <= ext; gz += step) {
      const x = gx + rng.range(-1.8, 1.8);
      const z = gz + rng.range(-1.8, 1.8);
      const s = rng.range(1.2, 2.2);
      const k = rng.int(0, 2);
      const keep = rng.chance(0.78);
      if (!keep) continue;
      if (Math.hypot(x, z) > edgeR(x, z) - 3.5) continue;
      let blocked = false;
      for (const r of roads) {
        const abx = r.b.x - r.a.x;
        const abz = r.b.z - r.a.z;
        const l2 = abx * abx + abz * abz || 1;
        const t = Math.max(0, Math.min(1, ((x - r.a.x) * abx + (z - r.a.z) * abz) / l2));
        if (Math.hypot(x - r.a.x - abx * t, z - r.a.z - abz * t) < r.clear) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      for (const f of footprints) {
        const dx = x - f.x;
        const dz = z - f.z;
        const lx = dx * f.c - dz * f.s;
        const lz = dx * f.s + dz * f.c;
        if (Math.abs(lx) < f.hw + 0.9 && Math.abs(lz) < f.hd + 0.9) {
          blocked = true;
          break;
        }
      }
      if (blocked || keepClear.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      out.push({ x: r2(x), z: r2(z), r: r2(rng.range(0, 6.28)), s: r2(s), k });
    }
  }
  return out;
}
