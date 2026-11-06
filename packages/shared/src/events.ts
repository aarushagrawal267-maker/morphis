/**
 * Typed simulation event catalogue. Every event emitted by the simulation engine
 * flows through the engine's EventBus and is forwarded to clients unchanged.
 */
import type {
  ActivityEntry,
  BuildingDynamic,
  CitizenStatus,
  CityEvent,
  CommandRecord,
  EconomySummary,
  NewsItem,
  SimProject,
  SimTask,
  TravelMode,
  WeatherKind,
} from './types/sim';
import type { Deed, Venture } from './types/life';
import type { BuildingDef } from './types/world';

/** A travel route: flattened polyline [x0, z0, x1, z1, ...] with cumulative lengths. */
export interface RouteData {
  id: number;
  points: number[];
  cum: number[];
  length: number;
}

export interface SimEventMap {
  'citizen.created': { citizenId: string };
  'citizen.moved': { citizenId: string; route: RouteData; mode: TravelMode; destinationId: string | null };
  'citizen.statusChanged': { citizenId: string; status: CitizenStatus; prev: CitizenStatus };
  'citizen.enteredBuilding': { citizenId: string; buildingId: string };
  'citizen.leftBuilding': { citizenId: string; buildingId: string };
  'citizen.boardedVehicle': { citizenId: string; vehicleId: string };
  'citizen.alighted': { citizenId: string; vehicleId: string };
  'vehicle.moved': { vehicleId: string; route: RouteData; destinationId: string | null };
  'vehicle.arrived': { vehicleId: string; buildingId: string | null };
  'vehicle.parked': { vehicleId: string; buildingId: string | null };
  'building.created': { building: BuildingDef };
  'building.updated': { buildingId: string; state: BuildingDynamic };
  'task.created': { task: SimTask };
  'task.started': { task: SimTask };
  'task.completed': { task: SimTask };
  'project.created': { project: SimProject };
  'project.completed': { project: SimProject };
  /** Reserved for real AI agents (Milestone 11). Never emitted by the simulated workforce. */
  'agent.started': { agentId: string; citizenId: string; taskId: string };
  'agent.completed': { agentId: string; citizenId: string; taskId: string };
  'agent.moved': { agentId: string; citizenId: string; buildingId: string };
  'weather.changed': { weather: WeatherKind; previous: WeatherKind; manual: boolean };
  'economy.updated': { summary: EconomySummary };
  'city.time.updated': { time: number; day: number; hour: number };
  'city.news': { item: NewsItem };
  'city.event': { event: CityEvent };
  'city.activity': { entry: ActivityEntry };
  'jarvis.command': { command: CommandRecord };
  /** An agent did something worth logging (founded, invested, graduated...). */
  'citizen.deed': { deed: Deed };
  /** A citizen stopped, turned to a guest at (x, z) and waved back. */
  'citizen.waved': { citizenId: string; x: number; z: number };
  'venture.updated': { venture: Venture };
  /** An agent's plan for the day changed. */
  'agent.plan': { citizenId: string; plan: string; by: 'ai' | 'sim' };
}

export type SimEventType = keyof SimEventMap;

export type SimEvent = {
  [K in SimEventType]: { type: K; time: number; payload: SimEventMap[K] };
}[SimEventType];

export const SIM_EVENT_TYPES: SimEventType[] = [
  'citizen.created',
  'citizen.moved',
  'citizen.statusChanged',
  'citizen.enteredBuilding',
  'citizen.leftBuilding',
  'citizen.boardedVehicle',
  'citizen.alighted',
  'vehicle.moved',
  'vehicle.arrived',
  'vehicle.parked',
  'building.created',
  'building.updated',
  'task.created',
  'task.started',
  'task.completed',
  'project.created',
  'project.completed',
  'agent.started',
  'agent.completed',
  'agent.moved',
  'weather.changed',
  'economy.updated',
  'city.time.updated',
  'city.news',
  'city.event',
  'city.activity',
  'jarvis.command',
  'citizen.deed',
  'citizen.waved',
  'venture.updated',
  'agent.plan',
];
