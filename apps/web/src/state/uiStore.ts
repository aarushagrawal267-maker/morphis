/**
 * UI and interaction state (Zustand). Purely presentational: nothing here is
 * simulation truth.
 */
import { create } from 'zustand';

export type Selection =
  | { kind: 'building'; id: string }
  | { kind: 'citizen'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'district'; id: string }
  | null;

export type CameraMode = 'overview' | 'district' | 'street' | 'building' | 'follow' | 'interior' | 'cinematic';

export type Highlight = 'none' | 'pedestrians' | 'enterable' | 'transport' | 'clickable';

export type Panel = 'features' | 'story' | 'news' | 'clock' | 'settings' | 'saves' | 'jarvis' | 'projects' | 'profile' | 'task' | 'journal' | 'look' | 'agents' | null;

export interface DebugLayers {
  roads: boolean;
  ped: boolean;
  districts: boolean;
  bounds: boolean;
  destinations: boolean;
  collision: boolean;
}

export interface Quality {
  bloom: boolean;
  shadows: boolean;
  ao: boolean;
  pixelRatio: number;
}

/** A camera request consumed by the camera rig. */
export interface CameraRequest {
  id: number;
  kind: 'overview' | 'district' | 'building' | 'point' | 'street' | 'cinematic';
  x?: number;
  z?: number;
  y?: number;
  radius?: number;
  height?: number;
}

interface UIState {
  selection: Selection;
  hovered: Selection;
  cameraMode: CameraMode;
  follow: { kind: 'citizen' | 'vehicle'; id: string } | null;
  cameraRequest: CameraRequest | null;
  pins: boolean;
  panel: Panel;
  highlight: Highlight;
  debug: boolean;
  debugLayers: DebugLayers;
  quality: Quality;
  interior: { buildingId: string; room: number } | null;
  activeTab: string;
  toast: { id: number; text: string; tone: 'info' | 'error' } | null;
  fading: boolean;
  setFading(v: boolean): void;
  select(s: Selection): void;
  setHovered(s: Selection): void;
  requestCamera(r: Omit<CameraRequest, 'id'>, mode?: CameraMode): void;
  setFollow(f: UIState['follow']): void;
  setPanel(p: Panel): void;
  togglePanel(p: Exclude<Panel, null>): void;
  setPins(v: boolean): void;
  setHighlight(h: Highlight): void;
  setDebug(v: boolean): void;
  setDebugLayer(k: keyof DebugLayers, v: boolean): void;
  setQuality(q: Partial<Quality>): void;
  enterInterior(buildingId: string): void;
  setRoom(i: number): void;
  exitInterior(): void;
  setTab(t: string): void;
  notify(text: string, tone?: 'info' | 'error'): void;
}

let reqId = 1;
let toastId = 1;

const defaultQuality = (): Quality => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  if (q === 'low') return { bloom: false, shadows: false, ao: false, pixelRatio: 1 };
  if (q === 'medium') return { bloom: true, shadows: false, ao: false, pixelRatio: 1 };
  const low = typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent);
  return { bloom: true, shadows: !low, ao: false, pixelRatio: low ? 1 : Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) };
};

export const useUI = create<UIState>((set, get) => ({
  selection: null,
  hovered: null,
  cameraMode: 'overview',
  follow: null,
  cameraRequest: null,
  pins: false,
  panel: null,
  highlight: 'none',
  debug: false,
  debugLayers: { roads: false, ped: false, districts: true, bounds: false, destinations: false, collision: false },
  quality: defaultQuality(),
  interior: null,
  activeTab: 'overview',
  toast: null,
  fading: false,
  setFading: (fading) => set({ fading }),
  select: (selection) => set({ selection }),
  setHovered: (hovered) => set({ hovered }),
  requestCamera: (r, mode) =>
    set({ cameraRequest: { ...r, id: reqId++ }, cameraMode: mode ?? get().cameraMode, follow: mode === 'follow' ? get().follow : null }),
  setFollow: (follow) => set({ follow, cameraMode: follow ? 'follow' : 'overview' }),
  setPanel: (panel) => set({ panel }),
  togglePanel: (p) => set({ panel: get().panel === p ? null : p }),
  setPins: (pins) => set({ pins }),
  setHighlight: (h) => set({ highlight: get().highlight === h ? 'none' : h }),
  setDebug: (debug) => set({ debug }),
  setDebugLayer: (k, v) => set({ debugLayers: { ...get().debugLayers, [k]: v } }),
  setQuality: (q) => set({ quality: { ...get().quality, ...q } }),
  enterInterior: (buildingId) => set({ interior: { buildingId, room: 0 }, cameraMode: 'interior', follow: null }),
  setRoom: (room) => {
    const i = get().interior;
    if (i) set({ interior: { ...i, room } });
  },
  exitInterior: () => set({ interior: null, cameraMode: 'building' }),
  setTab: (activeTab) => set({ activeTab }),
  notify: (text, tone = 'info') => set({ toast: { id: toastId++, text, tone } }),
}));
