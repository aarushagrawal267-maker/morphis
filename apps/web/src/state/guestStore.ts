/**
 * The visitor ("guest") walking the streets in first-person-ish third person.
 * Pose data that changes every frame lives in `guestPose` (no React renders);
 * the store holds what the interface shows.
 */
import { create } from 'zustand';

export interface Look {
  coat: string;
  trousers: string;
  hair: string;
  skin: string;
  eyes: string;
  /** Body build 0.9 .. 1.15 and height 0.92 .. 1.08. */
  build: number;
  height: number;
}

export type ChatterMode = 'off' | 'mini' | 'full';

export const LOOK_SWATCHES = {
  coat: ['#14b8a6', '#e11d48', '#7c3aed', '#f59e0b', '#0ea5e9', '#22c55e', '#f472b6', '#334155', '#fafafa', '#b45309'],
  trousers: ['#111827', '#1f2937', '#334155', '#1e3a8a', '#3f3f46', '#44403c', '#7f1d1d', '#065f46'],
  hair: ['#1a1a1a', '#3b2416', '#6b4423', '#c19a6b', '#e5e5e5', '#7c2d12', '#22d3ee', '#e879f9', '#a3e635'],
  skin: ['#ffdbac', '#f1c7a3', '#e0ac69', '#d4a07a', '#c68642', '#a8714a', '#8d5524', '#6b3e26'],
  eyes: ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80', '#f8fafc'],
} as const;

const DEFAULT_LOOK: Look = { coat: '#14b8a6', trousers: '#1f2937', hair: '#3b2416', skin: '#e0ac69', eyes: '#22d3ee', build: 1, height: 1 };

export interface GuestPose {
  x: number;
  z: number;
  /** Avatar facing (radians, atan2(dx, dz)). */
  yaw: number;
  /** Camera orbit around the avatar. */
  camYaw: number;
  camPitch: number;
  camDist: number;
  speed: number;
  /** Elevation (on a skyrail train or platform). */
  y: number;
  /** Click-to-walk waypoints. */
  path: { x: number; z: number }[];
  waveUntil: number;
}

export const guestPose: GuestPose = { x: 0, z: 0, yaw: 0, camYaw: 0, camPitch: 0.32, camDist: 9, speed: 0, y: 0, path: [], waveUntil: 0 };

export interface Place {
  street: string;
  landmark: string | null;
  landmarkDist: number;
}

export interface RideState {
  phase: 'waiting' | 'riding';
  fromId: string;
  toId: string;
  train: number;
}

interface GuestState {
  active: boolean;
  look: Look;
  chatter: ChatterMode;
  place: Place | null;
  /** Building door within reach. */
  door: { id: string; name: string } | null;
  /** Skyrail station within reach (street-level stair tower). */
  station: string | null;
  ride: RideState | null;
  welcomeSeen: boolean;
  enter(x: number, z: number, yaw?: number): void;
  exit(): void;
  setLook(l: Partial<Look>): void;
  randomLook(): void;
  setChatter(m: ChatterMode): void;
  setPlace(p: Place | null): void;
  setDoor(d: GuestState['door']): void;
  setStation(s: string | null): void;
  setRide(r: RideState | null): void;
  dismissWelcome(): void;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

function loadString<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export const useGuest = create<GuestState>((set, get) => ({
  active: false,
  look: load('morphis.look', DEFAULT_LOOK),
  chatter: loadString('morphis.chatter', ['off', 'mini', 'full'] as const, 'mini'),
  place: null,
  door: null,
  station: null,
  ride: null,
  welcomeSeen: (() => {
    try {
      return localStorage.getItem('morphis.welcome') === '1';
    } catch {
      return false;
    }
  })(),
  enter: (x, z, yaw = 0) => {
    guestPose.x = x;
    guestPose.z = z;
    guestPose.yaw = yaw;
    guestPose.camYaw = yaw + Math.PI;
    guestPose.y = 0;
    guestPose.path = [];
    set({ active: true, ride: null });
  },
  exit: () => set({ active: false, door: null, station: null, ride: null, place: null }),
  setLook: (l) => {
    const look = { ...get().look, ...l };
    save('morphis.look', look);
    set({ look });
  },
  randomLook: () => {
    const look: Look = {
      coat: pick(LOOK_SWATCHES.coat),
      trousers: pick(LOOK_SWATCHES.trousers),
      hair: pick(LOOK_SWATCHES.hair),
      skin: pick(LOOK_SWATCHES.skin),
      eyes: pick(LOOK_SWATCHES.eyes),
      build: Math.round((0.9 + Math.random() * 0.25) * 100) / 100,
      height: Math.round((0.92 + Math.random() * 0.16) * 100) / 100,
    };
    save('morphis.look', look);
    set({ look });
  },
  setChatter: (chatter) => {
    try {
      localStorage.setItem('morphis.chatter', chatter);
    } catch {
      /* ignore */
    }
    set({ chatter });
  },
  setPlace: (place) => {
    const cur = get().place;
    if (cur && place && cur.street === place.street && cur.landmark === place.landmark && Math.abs(cur.landmarkDist - place.landmarkDist) < 4) return;
    set({ place });
  },
  setDoor: (door) => {
    if (get().door?.id === door?.id) return;
    set({ door });
  },
  setStation: (station) => {
    if (get().station === station) return;
    set({ station });
  },
  setRide: (ride) => set({ ride }),
  dismissWelcome: () => {
    try {
      localStorage.setItem('morphis.welcome', '1');
    } catch {
      /* ignore */
    }
    set({ welcomeSeen: true });
  },
}));

/** Live input (keyboard + on-screen stick), read by the guest controller each frame. */
export const guestInput = {
  keys: new Set<string>(),
  stickX: 0,
  stickY: 0,
};
