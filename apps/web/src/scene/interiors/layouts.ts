/**
 * Interior floor plans for enterable buildings. Rooms are laid out on a grid
 * (x right, z towards the entrance at +z). Each room lists furniture and the
 * seats ("slots") where occupants are placed according to their activity.
 */
import type { ActivityKind, InteriorKind } from '@morphis/shared';

export type FurnitureKind =
  | 'desk'
  | 'chair'
  | 'table'
  | 'sofa'
  | 'rack'
  | 'core'
  | 'shelf'
  | 'screen'
  | 'bed'
  | 'counter'
  | 'plant'
  | 'reception'
  | 'bench'
  | 'console'
  | 'board';

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  z: number;
  r?: number;
}

export interface Slot {
  x: number;
  z: number;
  r: number;
  /** seated/standing pose: 'sit' lowers the character. */
  pose: 'sit' | 'stand' | 'lie';
}

export interface Room {
  name: string;
  purpose: string;
  x: number;
  z: number;
  w: number;
  d: number;
  floor: string;
  light: string;
  /** Activities that place occupants in this room. */
  hosts: ActivityKind[];
  furniture: Furniture[];
  slots: Slot[];
}

export interface Layout {
  title: string;
  rooms: Room[];
  /** Entrance door position (world, interior space). */
  entrance: { x: number; z: number };
}

function deskRow(x0: number, z0: number, n: number, dx: number, facing = 0): { furniture: Furniture[]; slots: Slot[] } {
  const furniture: Furniture[] = [];
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * dx;
    furniture.push({ kind: 'desk', x, z: z0, r: facing });
    furniture.push({ kind: 'chair', x, z: z0 + 0.9 * Math.cos(facing), r: facing });
    slots.push({ x, z: z0 + 0.95 * Math.cos(facing), r: facing + Math.PI, pose: 'sit' });
  }
  return { furniture, slots };
}

function meeting(cx: number, cz: number, seats: number): { furniture: Furniture[]; slots: Slot[] } {
  const furniture: Furniture[] = [{ kind: 'table', x: cx, z: cz }];
  const slots: Slot[] = [];
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2;
    const x = cx + Math.cos(a) * 1.9;
    const z = cz + Math.sin(a) * 1.3;
    furniture.push({ kind: 'chair', x, z, r: -a + Math.PI / 2 });
    slots.push({ x, z, r: Math.atan2(cx - x, cz - z), pose: 'sit' });
  }
  return { furniture, slots };
}

function merge(...parts: { furniture: Furniture[]; slots: Slot[] }[]): { furniture: Furniture[]; slots: Slot[] } {
  return { furniture: parts.flatMap((p) => p.furniture), slots: parts.flatMap((p) => p.slots) };
}

function standing(points: [number, number][]): Slot[] {
  return points.map(([x, z]) => ({ x, z, r: Math.random() * Math.PI * 2, pose: 'stand' }));
}

export function layoutFor(kind: InteriorKind, name: string): Layout {
  switch (kind) {
    case 'hq': {
      const ops = merge(deskRow(-14, -2, 5, 2.2), deskRow(-14, 2, 5, 2.2, Math.PI));
      const meet = meeting(14, -4, 8);
      return {
        title: name,
        entrance: { x: 0, z: 13 },
        rooms: [
          { name: 'Lobby', purpose: 'Reception and security', x: 0, z: 9, w: 10, d: 8, floor: '#1b2230', light: '#7dd3fc', hosts: ['leisure', 'event'], furniture: [{ kind: 'reception', x: 0, z: 8 }, { kind: 'plant', x: -4, z: 11 }, { kind: 'plant', x: 4, z: 11 }, { kind: 'sofa', x: -3.5, z: 6.5 }], slots: standing([[-2, 10], [2, 10], [0, 6.5]]) },
          { name: 'Operations Center', purpose: 'City operations monitoring', x: -9, z: 0, w: 14, d: 10, floor: '#161c28', light: '#38bdf8', hosts: ['work'], furniture: [...ops.furniture, { kind: 'screen', x: -9, z: -4.6 }], slots: ops.slots },
          { name: 'AI Command Center', purpose: 'JARVIS core and command consoles', x: 0, z: -2, w: 7, d: 10, floor: '#0f1622', light: '#22d3ee', hosts: ['work', 'meeting'], furniture: [{ kind: 'core', x: 0, z: -2 }, { kind: 'console', x: -2.4, z: 1.5, r: Math.PI }, { kind: 'console', x: 2.4, z: 1.5, r: Math.PI }, { kind: 'console', x: 0, z: -6, r: 0 }], slots: [{ x: -2.4, z: 2.4, r: Math.PI, pose: 'stand' }, { x: 2.4, z: 2.4, r: Math.PI, pose: 'stand' }, { x: 0, z: -5.2, r: 0, pose: 'stand' }] },
          { name: 'Meeting Rooms', purpose: 'Project planning and reviews', x: 12, z: -3, w: 10, d: 8, floor: '#1d1a2c', light: '#c084fc', hosts: ['meeting', 'work'], furniture: [...meet.furniture, { kind: 'board', x: 12, z: -6.8 }], slots: meet.slots },
          { name: 'Data Center', purpose: 'Compute and storage for JARVIS', x: 12, z: 6, w: 10, d: 7, floor: '#10151d', light: '#4ade80', hosts: ['work'], furniture: [0, 1, 2, 3].flatMap((i) => [{ kind: 'rack' as const, x: 8.5 + i * 2.3, z: 4.6 }, { kind: 'rack' as const, x: 8.5 + i * 2.3, z: 7.6 }]), slots: standing([[10, 6.1], [14, 6.1]]) },
          { name: 'Observation Deck', purpose: 'Break area overlooking the plaza', x: -9, z: 9, w: 14, d: 8, floor: '#1f2433', light: '#fbbf24', hosts: ['eat', 'leisure'], furniture: [{ kind: 'sofa', x: -12, z: 8 }, { kind: 'table', x: -7, z: 9 }, { kind: 'counter', x: -9, z: 12, r: 0 }, { kind: 'plant', x: -15, z: 12 }], slots: standing([[-12, 9.5], [-7, 7.5], [-6, 10.5], [-10, 11]]) },
        ],
      };
    }
    case 'lab': {
      const compute = merge(deskRow(-11, -3, 4, 2.2), deskRow(-11, 1.5, 4, 2.2, Math.PI));
      const meet = meeting(9, 5, 6);
      return {
        title: name,
        entrance: { x: 0, z: 12 },
        rooms: [
          { name: 'Lobby', purpose: 'Reception', x: 0, z: 8.5, w: 8, d: 6, floor: '#1a2230', light: '#86efac', hosts: ['leisure'], furniture: [{ kind: 'reception', x: 0, z: 8 }, { kind: 'plant', x: 3, z: 10.5 }], slots: standing([[-2, 10]]) },
          { name: 'AI Compute Lab', purpose: 'Model training and evaluation', x: -7.5, z: -1, w: 13, d: 10, floor: '#121a24', light: '#4ade80', hosts: ['work'], furniture: [...compute.furniture, { kind: 'screen', x: -7.5, z: -5.6 }], slots: compute.slots },
          { name: 'Wet Lab', purpose: 'Experimental benches', x: 8, z: -3, w: 12, d: 8, floor: '#1b2a2c', light: '#a7f3d0', hosts: ['work'], furniture: [{ kind: 'bench', x: 5, z: -4.5 }, { kind: 'bench', x: 11, z: -4.5 }, { kind: 'bench', x: 5, z: -1 }, { kind: 'bench', x: 11, z: -1 }, { kind: 'shelf', x: 8, z: -6.6 }], slots: standing([[5, -3.3], [11, -3.3], [5, 0.2], [11, 0.2]]) },
          { name: 'Meeting Room', purpose: 'Research reviews', x: 9, z: 5, w: 10, d: 6, floor: '#1d1a2c', light: '#c084fc', hosts: ['meeting'], furniture: meet.furniture, slots: meet.slots },
          { name: 'Server Room', purpose: 'GPU cluster', x: -8, z: 8, w: 10, d: 6, floor: '#0f141c', light: '#38bdf8', hosts: ['eat'], furniture: [0, 1, 2].flatMap((i) => [{ kind: 'rack' as const, x: -11 + i * 2.5, z: 7 }, { kind: 'rack' as const, x: -11 + i * 2.5, z: 9.6 }]), slots: standing([[-8, 8.3]]) },
        ],
      };
    }
    case 'university': {
      const classA = merge(deskRow(-14, -3, 4, 2), deskRow(-14, 0, 4, 2));
      const classB = merge(deskRow(-14, 6, 4, 2), deskRow(-14, 9, 4, 2));
      return {
        title: name,
        entrance: { x: 0, z: 13 },
        rooms: [
          { name: 'Lobby', purpose: 'Atrium and student services', x: 0, z: 9, w: 8, d: 8, floor: '#1c2230', light: '#93c5fd', hosts: ['leisure', 'event'], furniture: [{ kind: 'reception', x: 0, z: 7 }, { kind: 'plant', x: -3, z: 11 }, { kind: 'plant', x: 3, z: 11 }], slots: standing([[-2, 10], [2, 10], [0, 11.5]]) },
          { name: 'Classroom A', purpose: 'Lectures', x: -11, z: -1.5, w: 12, d: 8, floor: '#1a2132', light: '#60a5fa', hosts: ['study'], furniture: [...classA.furniture, { kind: 'board', x: -11, z: -5.3 }], slots: classA.slots },
          { name: 'Classroom B', purpose: 'Seminars', x: -11, z: 7.5, w: 12, d: 8, floor: '#1a2132', light: '#60a5fa', hosts: ['study', 'work'], furniture: [...classB.furniture, { kind: 'board', x: -11, z: 3.7 }], slots: classB.slots },
          { name: 'Library', purpose: 'Study and archives', x: 11, z: -1.5, w: 12, d: 8, floor: '#241f1a', light: '#fbbf24', hosts: ['study', 'leisure'], furniture: [...[0, 1, 2, 3].map((i) => ({ kind: 'shelf' as const, x: 6.5 + i * 3, z: -5 })), { kind: 'table', x: 9, z: -0.5 }, { kind: 'table', x: 13.5, z: -0.5 }], slots: [{ x: 8, z: 0.6, r: Math.PI, pose: 'sit' }, { x: 10, z: 0.6, r: Math.PI, pose: 'sit' }, { x: 12.5, z: 0.6, r: Math.PI, pose: 'sit' }, { x: 14.5, z: 0.6, r: Math.PI, pose: 'sit' }] },
          { name: 'Research Laboratory', purpose: 'Faculty research', x: 11, z: 7.5, w: 12, d: 8, floor: '#152022', light: '#4ade80', hosts: ['work', 'meeting'], furniture: [{ kind: 'bench', x: 8, z: 6 }, { kind: 'bench', x: 14, z: 6 }, { kind: 'desk', x: 8, z: 9.5 }, { kind: 'desk', x: 14, z: 9.5 }], slots: standing([[8, 7.2], [14, 7.2], [8, 10.5], [14, 10.5]]) },
        ],
      };
    }
    case 'office': {
      const open = merge(deskRow(-12, -3, 6, 2.2), deskRow(-12, 0.5, 6, 2.2, Math.PI), deskRow(-12, 4, 6, 2.2));
      const meet = meeting(10, -2.5, 6);
      return {
        title: name,
        entrance: { x: 0, z: 12 },
        rooms: [
          { name: 'Reception', purpose: 'Visitors', x: 0, z: 9, w: 8, d: 6, floor: '#1e2230', light: '#a5b4fc', hosts: ['leisure'], furniture: [{ kind: 'reception', x: 0, z: 8.4 }, { kind: 'sofa', x: -2.8, z: 10.4 }], slots: standing([[2, 10]]) },
          { name: 'Open Office', purpose: 'Desks and focus work', x: -6.5, z: 0.5, w: 15, d: 10, floor: '#181d29', light: '#a78bfa', hosts: ['work'], furniture: open.furniture, slots: open.slots },
          { name: 'Meeting Room', purpose: 'Client and team meetings', x: 10, z: -2.5, w: 10, d: 7, floor: '#1d1a2c', light: '#e879f9', hosts: ['meeting'], furniture: [...meet.furniture, { kind: 'screen', x: 10, z: -5.6 }], slots: meet.slots },
          { name: 'Break Room', purpose: 'Coffee and lunch', x: 10, z: 5, w: 10, d: 6, floor: '#22201c', light: '#fbbf24', hosts: ['eat', 'leisure'], furniture: [{ kind: 'counter', x: 10, z: 7.4 }, { kind: 'table', x: 8, z: 4.5 }, { kind: 'table', x: 12.5, z: 4.5 }, { kind: 'plant', x: 14, z: 7 }], slots: standing([[8, 5.8], [12.5, 5.8], [10, 6.4]]) },
        ],
      };
    }
    case 'cafe': {
      const tables: Furniture[] = [];
      const seats: Slot[] = [];
      for (const [x, z] of [[-6, -1], [-2, -1], [2, -1], [-6, 3], [-2, 3], [2, 3]] as const) {
        tables.push({ kind: 'table', x, z });
        seats.push({ x: x - 0.9, z, r: Math.PI / 2, pose: 'sit' }, { x: x + 0.9, z, r: -Math.PI / 2, pose: 'sit' });
      }
      return {
        title: name,
        entrance: { x: 0, z: 9 },
        rooms: [
          { name: 'Dining Room', purpose: 'Tables by the window', x: -2, z: 1, w: 13, d: 9, floor: '#2a211c', light: '#fbbf24', hosts: ['eat', 'leisure', 'event'], furniture: [...tables, { kind: 'plant', x: -8, z: 5 }, { kind: 'plant', x: 4, z: 5 }], slots: seats },
          { name: 'Counter', purpose: 'Orders and the espresso machine', x: 8, z: 1, w: 6, d: 9, floor: '#231d19', light: '#fb923c', hosts: ['work', 'build', 'shop'], furniture: [{ kind: 'counter', x: 7, z: 0, r: Math.PI / 2 }, { kind: 'shelf', x: 10.2, z: 0, r: -Math.PI / 2 }, { kind: 'screen', x: 10.2, z: 3.5, r: -Math.PI / 2 }], slots: standing([[8.6, -1.5], [8.6, 1.5], [5.6, 3.5]]) },
          { name: 'Kitchen', purpose: 'Prep and storage', x: 1, z: -6, w: 13, d: 5, floor: '#262626', light: '#fde68a', hosts: ['work', 'build'], furniture: [{ kind: 'counter', x: -2, z: -7.4 }, { kind: 'counter', x: 4, z: -7.4 }, { kind: 'shelf', x: 1, z: -4.6 }], slots: standing([[-2, -6.2], [4, -6.2], [1, -5.6]]) },
        ],
      };
    }
    case 'shop':
      return {
        title: name,
        entrance: { x: 0, z: 9 },
        rooms: [
          { name: 'Shop Floor', purpose: 'Aisles and displays', x: -2, z: 1, w: 14, d: 10, floor: '#1d2230', light: '#67e8f9', hosts: ['shop', 'leisure', 'eat', 'event'], furniture: [...[-7, -3.5, 0, 3.5].flatMap((x) => [{ kind: 'shelf' as const, x, z: -1, r: Math.PI / 2 }, { kind: 'shelf' as const, x, z: 3, r: Math.PI / 2 }]), { kind: 'plant', x: -8, z: 5.5 }], slots: standing([[-5.2, 0], [-1.7, 2], [1.8, 0], [-5.2, 4], [1.8, 4.6]]) },
          { name: 'Checkout', purpose: 'Tills', x: 8, z: 3, w: 6, d: 6, floor: '#1a1f2a', light: '#a5b4fc', hosts: ['work', 'build'], furniture: [{ kind: 'counter', x: 7.5, z: 3, r: Math.PI / 2 }, { kind: 'screen', x: 10.3, z: 3, r: -Math.PI / 2 }], slots: standing([[8.8, 2], [8.8, 4]]) },
          { name: 'Stockroom', purpose: 'Deliveries and storage', x: 8, z: -4, w: 6, d: 6, floor: '#181818', light: '#d4d4d8', hosts: ['work', 'build'], furniture: [{ kind: 'rack', x: 6.5, z: -5.5 }, { kind: 'rack', x: 9.5, z: -5.5 }, { kind: 'shelf', x: 8, z: -2.2 }], slots: standing([[8, -3.8]]) },
        ],
      };
    case 'hall': {
      const desks = merge(deskRow(-11, -4, 4, 2.3), deskRow(-11, -0.5, 4, 2.3, Math.PI));
      const meet = meeting(9, -3, 6);
      return {
        title: name,
        entrance: { x: 0, z: 11 },
        rooms: [
          { name: 'Hall', purpose: 'Public entrance and waiting area', x: 0, z: 6.5, w: 12, d: 8, floor: '#1c2230', light: '#93c5fd', hosts: ['leisure', 'event', 'eat', 'shop', 'park'], furniture: [{ kind: 'reception', x: 0, z: 5 }, { kind: 'bench', x: -4, z: 8.5 }, { kind: 'bench', x: 4, z: 8.5 }, { kind: 'plant', x: -5.5, z: 3.5 }, { kind: 'plant', x: 5.5, z: 3.5 }], slots: standing([[-4, 9.6], [4, 9.6], [-2, 7], [2, 7]]) },
          { name: 'Work Floor', purpose: 'Staff desks and stations', x: -7.5, z: -2, w: 13, d: 8, floor: '#171c27', light: '#a78bfa', hosts: ['work', 'study', 'build'], furniture: [...desks.furniture, { kind: 'screen', x: -7.5, z: -5.6 }], slots: desks.slots },
          { name: 'Briefing Room', purpose: 'Meetings', x: 9, z: -3, w: 10, d: 7, floor: '#1d1a2c', light: '#e879f9', hosts: ['meeting', 'work'], furniture: [...meet.furniture, { kind: 'board', x: 9, z: -6.2 }], slots: meet.slots },
        ],
      };
    }
    case 'apartment':
    default:
      return {
        title: name,
        entrance: { x: 0, z: 9 },
        rooms: [
          { name: 'Living Room', purpose: 'Lounge with a city view', x: -4, z: 1, w: 10, d: 9, floor: '#272224', light: '#fcd34d', hosts: ['home', 'leisure'], furniture: [{ kind: 'sofa', x: -5, z: 2.5 }, { kind: 'table', x: -4, z: 0.5 }, { kind: 'screen', x: -4, z: -3.2 }, { kind: 'plant', x: -8, z: 4.5 }], slots: [{ x: -6, z: 2.7, r: Math.PI, pose: 'sit' }, { x: -4, z: 2.7, r: Math.PI, pose: 'sit' }, { x: -2, z: 1.5, r: Math.PI, pose: 'stand' }] },
          { name: 'Kitchen', purpose: 'Cooking and dining', x: 5.5, z: 3, w: 8, d: 5, floor: '#2a2a2a', light: '#fde68a', hosts: ['eat'], furniture: [{ kind: 'counter', x: 5.5, z: 4.8 }, { kind: 'table', x: 5.5, z: 2 }], slots: [{ x: 4.5, z: 1.2, r: 0, pose: 'sit' }, { x: 6.5, z: 1.2, r: 0, pose: 'sit' }] },
          { name: 'Bedroom', purpose: 'Rest', x: 5.5, z: -3, w: 8, d: 6, floor: '#1f1d2a', light: '#c4b5fd', hosts: ['sleep'], furniture: [{ kind: 'bed', x: 5, z: -3.6 }, { kind: 'shelf', x: 8.6, z: -5.4 }], slots: [{ x: 4.5, z: -3.6, r: 0, pose: 'lie' }, { x: 5.5, z: -3.6, r: 0, pose: 'lie' }] },
        ],
      };
  }
}

/** Deterministic seat assignment shared by the 3D interior and the room list. */
export function placeOccupants<T extends { activity: string }>(
  layout: Layout,
  occupants: T[],
  rand: (n: number) => number,
): { o: T; room: Room; x: number; z: number; r: number; pose: Slot['pose'] }[] {
  const used = new Map<Room, number>();
  return occupants.map((o, i) => {
    const rooms = layout.rooms.filter((r) => r.hosts.includes(o.activity as ActivityKind));
    const room = rooms.find((r) => (used.get(r) ?? 0) < r.slots.length) ?? rooms[0] ?? layout.rooms[0];
    const n = used.get(room) ?? 0;
    used.set(room, n + 1);
    const slot = room.slots[n];
    if (slot) return { o, room, ...slot };
    const x = room.x + (rand(i * 3.1) - 0.5) * (room.w - 2);
    const z = room.z + (rand(i * 7.7) - 0.5) * (room.d - 2);
    return { o, room, x, z, r: rand(i) * 6.28, pose: 'stand' as const };
  });
}
