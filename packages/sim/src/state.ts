/**
 * Serialisable simulation state. Everything needed to resume a city lives here;
 * the static world is regenerated from the seed on load (and verified by hash).
 */
import type {
  ActivityEntry,
  ActivityKind,
  Business,
  BuildingDynamic,
  CitizenDynamic,
  CitizenProfile,
  CityEvent,
  ClockState,
  CommandRecord,
  EconomySummary,
  NewsItem,
  RouteData,
  SimProject,
  SimTask,
  TravelMode,
  VehicleDynamic,
  VehicleInfo,
  WeatherState,
} from '@morphis/shared';

export interface CrossLeg {
  s0: number;
  s1: number;
  pedEdge: number;
  node: number;
  crosses: number;
}

export interface Walker {
  route: RouteData;
  crossings: CrossLeg[];
  s: number;
  speed: number;
  waiting: boolean;
  onCrosswalk: number;
}

export type TripStage =
  | { kind: 'walk'; toNode: number; then: 'arrive' | 'stop' }
  | { kind: 'car'; vehicleId: string }
  | { kind: 'taxiWait'; requestedAt: number; vehicleId: string | null }
  | { kind: 'taxiRide'; vehicleId: string }
  | { kind: 'busWait'; stopId: string; lineId: string; alightStopId: string; since: number }
  | { kind: 'busRide'; vehicleId: string; alightStopId: string };

export interface Trip {
  mode: TravelMode;
  destId: string;
  activity: ActivityKind;
  startedAt: number;
  stage: TripStage;
  /** Remaining stages after the current one (bus trips: ride + final walk). */
  queue: TripStage[];
  /** Fare / cost to settle on arrival. */
  cost: number;
}

export interface CitizenRT {
  profile: CitizenProfile;
  dyn: CitizenDynamic;
  nextDecision: number;
  trip: Trip | null;
  walker: Walker | null;
  carId: string | null;
  speedFactor: number;
  /** Building the citizen currently stands in (mirrors dyn.location for buildings). */
  insideId: string | null;
  arrivedAt: number;
  /** Purchase pending at the current building (settled on arrival). */
  lastNeedsUpdate: number;
}

export interface DriveLeg {
  kind: 'lane' | 'turn';
  s0: number;
  s1: number;
  /** Lane coordinate (distance from the lane start) at s0; 0 for turns. */
  t0: number;
  edge: number;
  dir: 0 | 1;
  lane: number;
  node: number;
  key: string;
}

export type VehicleJob =
  | { type: 'commute'; citizenId: string; destId: string }
  | { type: 'taxiPickup'; citizenId: string; pickupId: string; destId: string }
  | { type: 'taxiRide'; citizenId: string; destId: string }
  | { type: 'taxiReturn'; standId: string }
  | { type: 'bus' }
  | { type: 'delivery'; businessId: string; depotId: string; phase: 'outbound' | 'return' }
  | { type: 'visitor'; destId: string | null; phase: 'inbound' | 'outbound' | 'through'; leaveAt: number };

export interface BusRT {
  lineId: string;
  /** Index (into line.stops) of the stop at route s = 0. */
  startStop: number;
  /** Route s of each stop on the loop, starting at startStop. */
  stopS: number[];
  nextStop: number;
  dwellUntil: number;
  capacity: number;
}

export interface VehicleRT {
  info: VehicleInfo;
  dyn: VehicleDynamic;
  route: RouteData | null;
  legs: DriveLeg[];
  s: number;
  /** Speed in world units per motion second. */
  v: number;
  legIdx: number;
  job: VehicleJob | null;
  waitingSince: number;
  inNode: number;
  bus: BusRT | null;
  length: number;
  maxSpeed: number;
  /** Visitors are recycled when they leave the city. */
  active: boolean;
}

export interface BuildingRT {
  dyn: BuildingDynamic;
  occupants: string[];
}

export interface EconomyInternal {
  summary: EconomySummary;
  salaryPaidToday: number;
  salesTaxToday: number;
  incomeTaxToday: number;
  propertyTaxToday: number;
  utilitiesToday: number;
  maintenanceToday: number;
  transitToday: number;
  lastDay: number;
}

export interface SimState {
  version: 1;
  seed: number;
  worldHash: string;
  clock: ClockState;
  rng: number[];
  nextRouteId: number;
  nextId: number;
  citizens: CitizenRT[];
  vehicles: VehicleRT[];
  buildings: BuildingRT[];
  businesses: Business[];
  economy: EconomyInternal;
  weather: WeatherState;
  projects: SimProject[];
  tasks: SimTask[];
  news: NewsItem[];
  activity: ActivityEntry[];
  cityEvents: CityEvent[];
  commands: CommandRecord[];
  taxiQueue: string[];
  lastHour: number;
  cooldowns: Record<string, number>;
  /** Per-edge traffic load snapshot (updated each sim minute) used for congestion-aware routing. */
  edgeLoad: number[];
}
