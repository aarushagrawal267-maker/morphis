/**
 * Wire protocol between the simulation authority (Node server or in-browser worker)
 * and the visual client. Both transports use exactly the same message shapes.
 */
import type { RouteData, SimEvent } from './events';
import type {
  ActivityEntry,
  Business,
  CitizenDynamic,
  CitizenProfile,
  CityEvent,
  CityStats,
  ClockState,
  CommandRecord,
  EconomySummary,
  NewsItem,
  SimProject,
  SimTask,
  VehicleDynamic,
  VehicleInfo,
  WeatherState,
} from './types/sim';
import type { BuildingDynamic } from './types/sim';
import type { StaticWorld } from './types/world';

/** High-frequency motion frame (~15 Hz). */
export interface MotionFrame {
  tick: number;
  time: number;
  /** Moving citizens: flattened [citizenIndex, routeId, s] triples. */
  citizens: number[];
  /** Moving vehicles: flattened [vehicleIndex, routeId, s, speed] quads. */
  vehicles: number[];
  /** Phase (0..5) of each signalised node, ordered by ascending node id. */
  signals: number[];
}

/** Low-frequency state frame (~1 Hz). */
export interface StateFrame {
  clock: ClockState;
  citizens: CitizenDynamic[];
  vehicles: VehicleDynamic[];
  /** Occupant count per building index. */
  occupancy: number[];
  stats: CityStats;
  economy: EconomySummary;
  weather: WeatherState;
  /** Included every few frames (and always in the init payload). */
  businesses?: Business[];
  buildings?: Record<string, BuildingDynamic>;
  perf: { tickMs: number; ticksPerSecond: number };
}

export interface ActiveRoute {
  kind: 'citizen' | 'vehicle';
  index: number;
  route: RouteData;
}

export type AuthorityMode = 'local' | 'server';

export interface PersistenceInfo {
  backend: 'postgres' | 'file' | 'browser' | 'none';
  detail: string;
}

export interface AiProviderInfo {
  connected: boolean;
  provider: string | null;
  detail: string;
}

export interface InitPayload {
  mode: AuthorityMode;
  sessionId: string;
  world: StaticWorld;
  citizens: CitizenProfile[];
  vehicles: VehicleInfo[];
  state: StateFrame;
  routes: ActiveRoute[];
  projects: SimProject[];
  tasks: SimTask[];
  news: NewsItem[];
  activity: ActivityEntry[];
  cityEvents: CityEvent[];
  commands: CommandRecord[];
  persistence: PersistenceInfo;
  ai: AiProviderInfo;
}

export interface SaveSummary {
  id: string;
  name: string;
  seed: number;
  simTime: number;
  savedAt: string;
  population: number;
  backend: PersistenceInfo['backend'];
}

export type AuthorityMessage =
  | { t: 'init'; payload: InitPayload }
  | { t: 'frame'; frame: MotionFrame }
  | { t: 'state'; state: StateFrame }
  | { t: 'events'; events: SimEvent[] }
  | { t: 'reply'; id: number; ok: boolean; data?: unknown; error?: string };

/** Socket.IO event names. */
export const SOCKET_EVENTS = {
  init: 'world.init',
  frame: 'sim.frame',
  state: 'sim.state',
  events: 'sim.events',
  command: 'sim.command',
} as const;
