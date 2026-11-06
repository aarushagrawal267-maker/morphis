/**
 * Walking collision for the guest: building footprints as oriented boxes in a
 * coarse grid. Parks and plazas are open to walk through.
 */
import type { BuildingDef, StaticWorld } from '@morphis/shared';

interface Box {
  b: BuildingDef;
  cx: number;
  cz: number;
  c: number;
  s: number;
  hw: number;
  hd: number;
}

const CELL = 16;

const cache = new WeakMap<StaticWorld, Colliders>();

/** One collider set per world (shared by the walk controller and drop-in clicks). */
export function collidersFor(world: StaticWorld): Colliders {
  let c = cache.get(world);
  if (!c) {
    c = new Colliders(world);
    cache.set(world, c);
  }
  return c;
}

export class Colliders {
  private grid = new Map<string, Box[]>();
  readonly half: number;
  /** Island edge radius by angle (the walkable ground ends at the railing). */
  private edge: number[] | null = null;

  constructor(world: StaticWorld) {
    this.half = world.size / 2 + 20;
    if (world.island) {
      const o = world.island.outline;
      this.edge = [];
      for (let i = 0; i < o.length; i += 2) this.edge.push(Math.hypot(o[i], o[i + 1]));
    }
    for (const b of world.buildings) {
      if (b.type === 'park' || b.type === 'plaza') continue;
      // tiers can overhang the base footprint slightly; use the widest tier extent
      let hw = b.width / 2;
      let hd = b.depth / 2;
      for (const t of b.tiers) {
        hw = Math.max(hw, Math.abs(t.ox) + t.w / 2);
        hd = Math.max(hd, Math.abs(t.oz) + t.d / 2);
      }
      const box: Box = { b, cx: b.position.x, cz: b.position.z, c: Math.cos(b.rotation), s: Math.sin(b.rotation), hw, hd };
      const r = Math.hypot(hw, hd);
      for (let gx = Math.floor((box.cx - r) / CELL); gx <= Math.floor((box.cx + r) / CELL); gx++) {
        for (let gz = Math.floor((box.cz - r) / CELL); gz <= Math.floor((box.cz + r) / CELL); gz++) {
          const k = `${gx},${gz}`;
          const l = this.grid.get(k);
          if (l) l.push(box);
          else this.grid.set(k, [box]);
        }
      }
    }
  }

  private near(x: number, z: number): Box[] {
    return this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  }

  /** Building whose footprint contains the point (with margin), if any. */
  inside(x: number, z: number, margin = 0): BuildingDef | null {
    for (const box of this.near(x, z)) {
      const dx = x - box.cx;
      const dz = z - box.cz;
      // inverse of localToWorld: lx = dx c - dz s, lz = dx s + dz c
      const lx = dx * box.c - dz * box.s;
      const lz = dx * box.s + dz * box.c;
      if (Math.abs(lx) < box.hw + margin && Math.abs(lz) < box.hd + margin) return box.b;
    }
    return null;
  }

  /** Push a circle of radius r out of every building it overlaps. */
  resolve(p: { x: number; z: number }, r: number): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const box of this.near(p.x, p.z)) {
        const dx = p.x - box.cx;
        const dz = p.z - box.cz;
        const lx = dx * box.c - dz * box.s;
        const lz = dx * box.s + dz * box.c;
        const px = box.hw + r - Math.abs(lx);
        const pz = box.hd + r - Math.abs(lz);
        if (px <= 0 || pz <= 0) continue;
        let nlx = lx;
        let nlz = lz;
        if (px < pz) nlx = Math.sign(lx || 1) * (box.hw + r);
        else nlz = Math.sign(lz || 1) * (box.hd + r);
        // back to world: x = lx c + lz s, z = -lx s + lz c
        p.x = box.cx + nlx * box.c + nlz * box.s;
        p.z = box.cz - nlx * box.s + nlz * box.c;
        moved = true;
      }
      if (!moved) break;
    }
    this.keepOnIsland(p);
  }

  /** Radius of the walkable ground in the direction of (x, z). */
  edgeRadius(x: number, z: number): number {
    if (!this.edge) return Infinity;
    const n = this.edge.length;
    const a = ((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n;
    const i = Math.floor(a) % n;
    const t = a - Math.floor(a);
    return this.edge[i] * (1 - t) + this.edge[(i + 1) % n] * t - 2.2; // stay inside the railing
  }

  onIsland(x: number, z: number): boolean {
    return Math.hypot(x, z) <= this.edgeRadius(x, z);
  }

  keepOnIsland(p: { x: number; z: number }): void {
    if (this.edge) {
      const r = Math.hypot(p.x, p.z);
      const max = this.edgeRadius(p.x, p.z);
      if (r > max && r > 0) {
        p.x *= max / r;
        p.z *= max / r;
      }
      return;
    }
    p.x = Math.max(-this.half, Math.min(this.half, p.x));
    p.z = Math.max(-this.half, Math.min(this.half, p.z));
  }

  /** True when the straight segment crosses a building. */
  blocked(x0: number, z0: number, x1: number, z1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.8);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.inside(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.2)) return true;
    }
    return false;
  }

  /** Building taller than `y` covering the point (used to keep the camera out of walls). */
  solidAt(x: number, z: number, y: number): boolean {
    const b = this.inside(x, z, 0.3);
    return !!b && b.height > y;
  }
}
