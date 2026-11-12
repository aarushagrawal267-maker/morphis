/**
 * Dynamic simulation state as published by the authority (server or local worker).
 */
import type { BuildingType, Vec2 } from './world';
import type { AgentPersona } from './life';

export type CitizenStatus =
  | 'SLEEPING'
  | 'AT_HOME'
  | 'WALKING'
  | 'TRAVELING'
  | 'WORKING'
  | 'EATING'
  | 'SHOPPING'
  | 'SOCIALIZING'
  | 'LEARNING'
  | 'RESTING'
  | 'IDLE';

export type ActivityKind =
  | 'sleep'
  | 'home'
  | 'work'
  | 'study'
  | 'eat'
  | 'shop'
  | 'leisure'
  | 'park'
  | 'event'
  | 'meeting'
  /** Helping fit out an agent's new venture. */
  | 'build';

export interface ScheduleBlock {
  /** Minute of day the block starts. */
  start: number;
  activity: ActivityKind;
}

export type CoreRole =
  | 'researcher'
  | 'data_analyst'
  | 'product_manager'
  | 'ux_researcher'
  | 'ui_designer'
  | 'frontend_developer'
  | 'backend_developer'
  | 'ai_engineer'
  | 'qa_engineer'
  | 'devops_engineer'
  | 'finance_analyst'
  | 'marketing_strategist'
  | 'sales_specialist'
  | 'business_strategist'
  | 'operations_manager'
  | 'content_writer'
  | 'media_specialist'
  | 'customer_support'
  | 'hr_coordinator'
  | 'legal_researcher'
  | 'security_analyst'
  | 'innovation_lead'
  | 'educator'
  | 'project_manager'
  | 'documentation_specialist';

export interface Appearance {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  height: number;
  build: number;
}

export interface CitizenProfile {
  id: string;
  index: number;
  name: string;
  age: number;
  occupation: string;
  department: string;
  /** Core workforce citizens carry a role and will later be bound to a real AI agent. */
  core: boolean;
  role: CoreRole | null;
  homeId: string;
  workplaceId: string | null;
  districtId: string;
  skills: Record<string, number>;
  schedule: ScheduleBlock[];
  weekendSchedule: ScheduleBlock[];
  appearance: Appearance;
  ownsCar: boolean;
  /** Simulated monthly salary in simulated credits (§). Fictional. */
  salary: number;
  /** Simulated monthly rent. Fictional. */
  rent: number;
  bio: string;
  /** Present only once a real AI agent is bound to this citizen. */
  agentId?: string;
  /** One of the 50 agents (25 JARVIS workforce + 25 independent agents). */
  agent?: AgentPersona;
}

export type TravelMode = 'walk' | 'car' | 'taxi' | 'bus' | 'rail';

export type CitizenLocation =
  | { kind: 'building'; id: string }
  | { kind: 'street' }
  | { kind: 'vehicle'; id: string }
  | { kind: 'stop'; id: string }
  /** On the skyrail: waiting at a station (station id) or riding (train id). */
  | { kind: 'rail'; id: string };

export interface CitizenDynamic {
  status: CitizenStatus;
  activity: ActivityKind;
  location: CitizenLocation;
  destinationId: string | null;
  travelMode: TravelMode | null;
  energy: number;
  satiety: number;
  social: number;
  fun: number;
  happiness: number;
  money: number;
  savings: number;
  currentTaskId: string | null;
  /** Expenses this simulated month, by category. */
  spending: { food: number; shopping: number; transport: number; entertainment: number; rent: number };
  earnedThisMonth: number;
  employed: boolean;
}

export type VehicleKind = 'car' | 'taxi' | 'bus' | 'delivery' | 'visitor';

export type VehicleStatus = 'PARKED' | 'DRIVING' | 'WAITING' | 'BOARDING' | 'IDLE';

export interface VehicleInfo {
  id: string;
  index: number;
  kind: VehicleKind;
  color: string;
  ownerId: string | null;
  label: string;
  /** Bus line id for buses. */
  lineId?: string;
}

export interface VehicleDynamic {
  status: VehicleStatus;
  speed: number;
  passengers: string[];
  destinationId: string | null;
  /** Parked in / at this building (hidden from streets). */
  parkedAt: string | null;
  odometer: number;
  trips: number;
}

export type BuildingStatus = 'ACTIVE' | 'CLOSED' | 'CONSTRUCTION' | 'OUTAGE';

export interface BuildingDynamic {
  occupants: number;
  status: BuildingStatus;
  /** 0..1 fraction of the building's peak energy draw. */
  energyUsage: number;
  ownerId: string | null;
  employees: number;
}

export interface Business {
  id: string;
  name: string;
  type: BuildingType;
  buildingId: string;
  category: 'food' | 'retail' | 'company' | 'finance' | 'industry' | 'service' | 'public' | 'housing';
  employees: string[];
  jobs: number;
  revenue: number;
  expenses: number;
  /** Revenue and expenses for the current simulated day. */
  revenueToday: number;
  expensesToday: number;
  profit: number;
  cash: number;
  inventory: number;
  inventoryCapacity: number;
  capacity: number;
  operatingStatus: 'OPEN' | 'CLOSED' | 'BANKRUPT' | 'PLANNED';
  pricePerVisit: number;
  visitsToday: number;
  /** Delivery truck en route. */
  restockPending: boolean;
  products: string[];
}

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'storm';

export interface WeatherState {
  kind: WeatherKind;
  /** 0..1, ramps smoothly when weather changes. */
  intensity: number;
  /** Target weather the state is transitioning to. */
  target: WeatherKind;
  /** Wetness of surfaces 0..1 (lags behind rain). */
  wetness: number;
  windDir: number;
  manual: boolean;
}

export interface ClockState {
  /** Simulation seconds since Day 1 00:00. */
  time: number;
  tick: number;
  paused: boolean;
  speed: number;
}

export interface ResourceStats {
  powerDemand: number;
  powerSupply: number;
  waterDemand: number;
  waterSupply: number;
}

export interface EconomySummary {
  cityBudget: number;
  taxRevenueToday: number;
  cityExpensesToday: number;
  gdpToday: number;
  gdpYesterday: number;
  employed: number;
  unemployed: number;
  avgHappiness: number;
  avgMoney: number;
  businessesOpen: number;
  housingOccupancy: number;
  transitRidersToday: number;
  taxiTripsToday: number;
  resources: ResourceStats;
  /** Daily history (newest last), max 30 entries. */
  history: { day: number; gdp: number; budget: number; happiness: number; employment: number }[];
}

export type TaskStatus = 'PENDING' | 'BLOCKED' | 'ACTIVE' | 'REVIEW' | 'COMPLETED';

export interface SimTask {
  id: string;
  projectId: string;
  title: string;
  role: CoreRole;
  /** Specialist from The Agency hired for this task (catalogue id); `role` is the fallback. */
  specialist?: string;
  assigneeId: string | null;
  status: TaskStatus;
  progress: number;
  /** Required simulated work minutes. */
  work: number;
  dependsOn: string[];
  buildingId: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Summary of the simulated deliverable (generated from simulation state, not by AI). */
  output: string | null;
  artifact: string | null;
}

export interface SimProject {
  id: string;
  name: string;
  description: string;
  companyId: string | null;
  buildingId: string;
  source: 'company' | 'jarvis';
  status: 'ACTIVE' | 'COMPLETED';
  progress: number;
  tasks: string[];
  createdAt: number;
  completedAt: number | null;
  /** Shared workspace path for artifacts (virtual). */
  workspace: string;
  report: string | null;
  commandId: string | null;
  /** Company to found when the project completes (JARVIS startup plans). */
  foundsCompany?: string | null;
  planner?: string;
  /** Urgent projects call their assignees in to work immediately (overtime). */
  urgent?: boolean;
}

/** A tool call by an AI agent waiting for a human decision. */
export interface ApprovalRequest {
  id: string;
  tool: string;
  /** Human readable summary, e.g. the URL to fetch. */
  summary: string;
  args: Record<string, string>;
  citizenId: string;
  agentName: string;
  taskTitle: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
}

export type NewsCategory =
  | 'traffic'
  | 'weather'
  | 'economy'
  | 'event'
  | 'infrastructure'
  | 'project'
  | 'city'
  | 'transit';

export interface NewsItem {
  id: string;
  time: number;
  category: NewsCategory;
  headline: string;
  body: string;
  severity: 'info' | 'notice' | 'warning';
  location?: Vec2;
  buildingId?: string;
}

export interface CityEvent {
  id: string;
  name: string;
  kind: 'market' | 'concert' | 'lecture' | 'conference' | 'exhibition' | 'sports';
  buildingId: string;
  start: number;
  end: number;
  attendees: number;
  capacity: number;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED';
}

export interface ActivityEntry {
  id: string;
  time: number;
  citizenId: string;
  text: string;
  kind: 'status' | 'task' | 'meeting' | 'travel' | 'project';
  buildingId?: string;
}

export interface CityStats {
  population: number;
  activeCitizens: number;
  walking: number;
  traveling: number;
  working: number;
  sleeping: number;
  vehiclesMoving: number;
  vehiclesTotal: number;
  avgTrafficSpeed: number;
  congestion: number;
  status: 'NORMAL' | 'BUSY' | 'CONGESTED' | 'STORM ALERT' | 'POWER STRAIN';
  activeRoutes: number;
}

export interface CommandRecord {
  id: string;
  text: string;
  time: number;
  status: 'PLANNED' | 'RUNNING' | 'COMPLETED' | 'REJECTED';
  projectId: string | null;
  planner: string;
  message: string;
}

/** A task in a project plan produced by a planner (template or LLM). */
export interface PlanTask {
  key: string;
  title: string;
  role: CoreRole;
  /** Specialist from The Agency to hire (catalogue id); `role` is used if none is free. */
  specialist?: string;
  /** Estimated work in simulated minutes. */
  work: number;
  dependsOn: string[];
  /** Landmark key where the work happens (defaults to the assignee's workplace). */
  location?: string;
  description: string;
  artifact: string;
}

export interface ProjectPlan {
  name: string;
  kind: string;
  description: string;
  tasks: PlanTask[];
  /** Which planner produced the plan, e.g. "template-planner" or "llm:nvidia/…". */
  planner: string;
  /** Optional: when the project completes, found a company with this name. */
  foundsCompany?: string | null;
}
