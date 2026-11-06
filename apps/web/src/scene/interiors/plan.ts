/**
 * Building plans: every building gets its own variation of its type's layout
 * (mirrored or not, its own colours), and taller buildings have upstairs
 * floors (flats above shops and cafés, more office floors, apartments).
 * The simulation does not model floors, so people are spread over floors by
 * what they are doing: customers and visitors on the ground floor, residents
 * and staff across the storeys.
 */
import type { BuildingDef, InteriorKind } from '@morphis/shared';
import { layoutFor, type Layout } from './layouts';

const MULTI: InteriorKind[] = ['apartment', 'office', 'hall', 'cafe', 'shop', 'lab', 'university', 'hq'];
const PUBLIC_GROUND: InteriorKind[] = ['cafe', 'shop', 'hall'];
const PUBLIC_ACTS = new Set(['eat', 'shop', 'leisure', 'event', 'park']);

const FLOOR_TINTS = ['#1b2230', '#2a211c', '#1d2a24', '#271d2c', '#1c2433', '#2b2622', '#202a2e'];
const LIGHT_TINTS = ['#fbbf24', '#a78bfa', '#67e8f9', '#f9a8d4', '#86efac', '#fde68a', '#93c5fd'];

function rnd(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export function floorsOf(b: BuildingDef): number {
  const kind = b.interior ?? 'office';
  if (!MULTI.includes(kind)) return 1;
  return Math.max(1, Math.min(4, b.floorCount || 1));
}

function upstairs(kind: InteriorKind): InteriorKind {
  if (kind === 'cafe' || kind === 'shop' || kind === 'apartment') return 'apartment';
  if (kind === 'hall' || kind === 'hq' || kind === 'university') return 'office';
  return kind;
}

export function floorLabel(f: number): string {
  return f === 0 ? 'Ground floor' : `Floor ${f}`;
}

export function planFor(b: BuildingDef, floor: number, name: string): Layout {
  const kind = b.interior ?? 'office';
  const k = floor === 0 ? kind : upstairs(kind);
  const base = layoutFor(k, name);
  const r = rnd(b.index * 31 + floor * 7 + 3);
  const mirror = r() < 0.5;
  const tint = Math.floor(r() * FLOOR_TINTS.length);
  const m = (x: number) => (mirror ? -x : x);
  return {
    title: floor === 0 ? base.title : `${base.title} · ${floorLabel(floor)}`,
    entrance: { x: m(base.entrance.x), z: base.entrance.z },
    rooms: base.rooms.map((room, i) => ({
      ...room,
      x: m(room.x),
      floor: r() < 0.55 ? FLOOR_TINTS[(tint + i) % FLOOR_TINTS.length] : room.floor,
      light: r() < 0.45 ? LIGHT_TINTS[(tint + i * 2) % LIGHT_TINTS.length] : room.light,
      furniture: room.furniture.map((f) => ({ ...f, x: m(f.x), r: mirror && f.r !== undefined ? -f.r : f.r })),
      slots: room.slots.map((s) => ({ ...s, x: m(s.x), r: mirror ? -s.r : s.r })),
    })),
  };
}

/** Which floor a person is on (stable per person). */
export function floorOfOccupant(b: BuildingDef, citizenIndex: number, activity: string): number {
  const floors = floorsOf(b);
  if (floors <= 1) return 0;
  const kind = b.interior ?? 'office';
  if (PUBLIC_ACTS.has(activity)) return 0;
  const h = ((citizenIndex * 2654435761) >>> 0) % 1000;
  if (PUBLIC_GROUND.includes(kind)) {
    // staff work downstairs; residents live upstairs
    if (activity === 'work' || activity === 'build') return 0;
    return 1 + (h % (floors - 1));
  }
  return h % floors;
}
