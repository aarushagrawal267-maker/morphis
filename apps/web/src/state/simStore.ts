/**
 * Simulation data for the React UI (low-frequency). High-frequency motion
 * never goes through React; the renderer reads it from simClient directly.
 */
import { create } from 'zustand';
import type {
  ActivityEntry,
  ApprovalRequest,
  AiProviderInfo,
  AuthorityMode,
  BuildingDef,
  BuildingDynamic,
  Business,
  CitizenProfile,
  CityEvent,
  CommandRecord,
  District,
  InitPayload,
  NewsItem,
  PersistenceInfo,
  SimEvent,
  SimProject,
  SimTask,
  StateFrame,
  StaticWorld,
  VehicleInfo,
} from '@morphis/shared';
import type { ConnectionStatus } from '../sim/transport';

interface SimData {
  ready: boolean;
  mode: AuthorityMode | null;
  connection: ConnectionStatus;
  sessionId: string;
  world: StaticWorld | null;
  buildingsById: Map<string, BuildingDef>;
  districtsById: Map<string, District>;
  citizens: CitizenProfile[];
  citizensById: Map<string, CitizenProfile>;
  vehicles: VehicleInfo[];
  state: StateFrame | null;
  businesses: Business[];
  businessByBuilding: Map<string, Business>;
  buildingDyn: Record<string, BuildingDynamic>;
  projects: SimProject[];
  tasks: Map<string, SimTask>;
  news: NewsItem[];
  activity: ActivityEntry[];
  cityEvents: CityEvent[];
  commands: CommandRecord[];
  persistence: PersistenceInfo | null;
  ai: AiProviderInfo | null;
  approvals: ApprovalRequest[];
  eventCount: number;
  /** Bumped when profiles change (hiring etc.). */
  revision: number;
  setConnection(mode: AuthorityMode, s: ConnectionStatus): void;
  applyInit(p: InitPayload): void;
  applyState(s: StateFrame): void;
  applyEvents(events: SimEvent[]): void;
}

export const useSim = create<SimData>((set, get) => ({
  ready: false,
  mode: null,
  connection: 'connecting',
  sessionId: '',
  world: null,
  buildingsById: new Map(),
  districtsById: new Map(),
  citizens: [],
  citizensById: new Map(),
  vehicles: [],
  state: null,
  businesses: [],
  businessByBuilding: new Map(),
  buildingDyn: {},
  projects: [],
  tasks: new Map(),
  news: [],
  activity: [],
  cityEvents: [],
  commands: [],
  persistence: null,
  ai: null,
  approvals: [],
  eventCount: 0,
  revision: 0,

  setConnection: (mode, connection) => set({ mode, connection }),

  applyInit: (p) => {
    const businesses = p.state.businesses ?? [];
    set({
      ready: true,
      mode: p.mode,
      sessionId: p.sessionId,
      world: p.world,
      buildingsById: new Map(p.world.buildings.map((b) => [b.id, b])),
      districtsById: new Map(p.world.districts.map((d) => [d.id, d])),
      citizens: p.citizens,
      citizensById: new Map(p.citizens.map((c) => [c.id, c])),
      vehicles: p.vehicles,
      state: p.state,
      businesses,
      businessByBuilding: new Map(businesses.map((b) => [b.buildingId, b])),
      buildingDyn: p.state.buildings ?? {},
      projects: p.projects,
      tasks: new Map(p.tasks.map((t) => [t.id, t])),
      news: p.news,
      activity: p.activity,
      cityEvents: p.cityEvents,
      commands: p.commands,
      persistence: p.persistence,
      ai: p.ai,
      approvals: p.approvals ?? [],
      revision: get().revision + 1,
    });
  },

  applyState: (s) => {
    const patch: Partial<SimData> = { state: s };
    if (s.businesses) {
      patch.businesses = s.businesses;
      patch.businessByBuilding = new Map(s.businesses.map((b) => [b.buildingId, b]));
    }
    if (s.buildings) patch.buildingDyn = s.buildings;
    set(patch);
  },

  applyEvents: (events) => {
    const st = get();
    let news = st.news;
    let activity = st.activity;
    let projects = st.projects;
    let tasks = st.tasks;
    let cityEvents = st.cityEvents;
    let commands = st.commands;
    let buildingDyn = st.buildingDyn;
    let vehicles = st.vehicles;
    let changed = false;
    for (const e of events) {
      switch (e.type) {
        case 'city.news':
          news = [...news.slice(-119), e.payload.item];
          changed = true;
          break;
        case 'city.activity':
          activity = [...activity.slice(-149), e.payload.entry];
          changed = true;
          break;
        case 'project.created':
        case 'project.completed': {
          const p = e.payload.project;
          projects = [...projects.filter((x) => x.id !== p.id), p];
          changed = true;
          break;
        }
        case 'task.created':
        case 'task.started':
        case 'task.completed': {
          tasks = new Map(tasks);
          tasks.set(e.payload.task.id, e.payload.task);
          changed = true;
          break;
        }
        case 'city.event': {
          const ev = e.payload.event;
          cityEvents = [...cityEvents.filter((x) => x.id !== ev.id), ev];
          changed = true;
          break;
        }
        case 'jarvis.command': {
          const c = e.payload.command;
          commands = [...commands.filter((x) => x.id !== c.id), c];
          changed = true;
          break;
        }
        case 'building.updated':
          buildingDyn = { ...buildingDyn, [e.payload.buildingId]: e.payload.state };
          changed = true;
          break;
        case 'vehicle.moved':
          break;
      }
    }
    if (vehicles.length !== st.vehicles.length) vehicles = st.vehicles;
    set({ eventCount: st.eventCount + events.length, ...(changed ? { news, activity, projects, tasks, cityEvents, commands, buildingDyn } : {}) });
  },
}));
