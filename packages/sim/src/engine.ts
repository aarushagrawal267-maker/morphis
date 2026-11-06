/**
 * CitySimulation: the authoritative simulation engine.
 *
 * Fixed timestep: one tick = one simulated second (TICK_SECONDS). Systems run in
 * a fixed order each tick; slower systems run on minute / hour / day
 * boundaries. The engine is renderer-agnostic and runs identically inside the
 * Node server and the browser worker (local mode).
 */
import type {
  ActiveRoute,
  AiProviderInfo,
  AuthorityMode,
  BuildingDef,
  BuildingType,
  CityConfig,
  CityStats,
  CitizenDynamic,
  InitPayload,
  MotionFrame,
  PersistenceInfo,
  ProjectPlan,
  SimCommand,
  StateFrame,
  StaticWorld,
  Business,
} from '@morphis/shared';
import { BUILDING_TYPES, SIGNAL_CYCLE, SIM_SECONDS_PER_MOTION_SECOND, START_TIME, dayOf, hourOf, minuteOfDay } from '@morphis/shared';
import { Rng } from './core/rng';
import { EventBus } from './events';
import { defaultConfig, generateWorld } from './gen/world';
import { PedNav, RoadNav } from './nav/graphs';
import { DriveRouter } from './nav/routes';
import type { CitizenRT, SimState } from './state';
import { CitizenSystem } from './systems/citizens';
import { CityEventSystem } from './systems/cityEvents';
import { EconomySystem, createBusinesses } from './systems/economy';
import { buildSchedule, generatePopulation } from './systems/population';
import { templatePlan, validatePlan } from './systems/planner';
import { TrafficSystem } from './systems/traffic';
import { WeatherSystem } from './systems/weather';
import { WorkforceSystem } from './systems/workforce';

export const SAVE_FORMAT = 'morphis-save';

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: 1;
  name: string;
  savedAt: string;
  config: CityConfig;
  worldHash: string;
  state: SimState;
}

export interface CommandReply {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export class CitySimulation {
  readonly world: StaticWorld;
  readonly landmarks: Record<string, string>;
  readonly crosswalkAt: Map<string, number>;
  readonly roadNav: RoadNav;
  readonly pedNav: PedNav;
  readonly router: DriveRouter;
  readonly signalNodes: number[];
  readonly taxiStands: string[];
  readonly bus = new EventBus();
  state!: SimState;
  rng!: Rng;

  citizens!: CitizenSystem;
  traffic!: TrafficSystem;
  economy!: EconomySystem;
  weather!: WeatherSystem;
  cityEvents!: CityEventSystem;
  workforce!: WorkforceSystem;

  private bIdx = new Map<string, number>();
  private typeIndex = new Map<string, BuildingDef[]>();
  private perf = { tickMs: 0, ticks: 0, lastWindow: 0, tps: 0 };

  private constructor(config: CityConfig) {
    const gen = generateWorld(config);
    this.world = gen.world;
    this.landmarks = gen.landmarks;
    this.crosswalkAt = gen.crosswalkAt;
    this.roadNav = new RoadNav(this.world.roads.nodes, this.world.roads.edges);
    this.pedNav = new PedNav(this.world.ped.nodes, this.world.ped.edges);
    this.router = new DriveRouter(this.world.roads.nodes, this.world.roads.edges, this.roadNav);
    this.signalNodes = this.world.roads.nodes.filter((n) => n.signal).map((n) => n.id);
    this.world.buildings.forEach((b, i) => {
      this.bIdx.set(b.id, i);
      const l = this.typeIndex.get(b.type);
      if (l) l.push(b);
      else this.typeIndex.set(b.type, [b]);
    });
    this.taxiStands = ['station', 'hq', 'market', 'skyline', 'cybercafe']
      .map((k) => this.landmarks[k])
      .filter((id): id is string => !!id);
    if (!this.taxiStands.length) this.taxiStands.push(this.world.hqId);
  }

  /** Create a brand new city. */
  static create(overrides: Partial<CityConfig> = {}): CitySimulation {
    const sim = new CitySimulation(defaultConfig(overrides));
    sim.initFresh();
    return sim;
  }

  /** Restore a city from a save. Throws if the save is incompatible. */
  static fromSave(save: SaveData): CitySimulation {
    if (save.format !== SAVE_FORMAT || save.version !== 1) throw new Error('Unsupported save format');
    const sim = new CitySimulation(save.config);
    if (sim.world.hash !== save.worldHash) throw new Error(`World hash mismatch (${sim.world.hash} != ${save.worldHash})`);
    sim.state = save.state;
    sim.rng = new Rng(save.state.rng);
    sim.attachSystems();
    return sim;
  }

  private initFresh(): void {
    const w = this.world;
    this.rng = Rng.derive(w.seed, 'sim');
    this.state = {
      version: 1,
      seed: w.seed,
      worldHash: w.hash,
      clock: { time: START_TIME, tick: 0, paused: false, speed: 1 },
      rng: [],
      nextRouteId: 1,
      nextId: 1,
      citizens: [],
      vehicles: [],
      buildings: w.buildings.map((b) => ({
        dyn: { occupants: 0, status: b.construction ? 'CONSTRUCTION' : 'ACTIVE', energyUsage: 0.2, ownerId: null, employees: 0 },
        occupants: [],
      })),
      businesses: [],
      economy: {
        summary: {
          cityBudget: 2_500_000,
          taxRevenueToday: 0,
          cityExpensesToday: 0,
          gdpToday: 0,
          gdpYesterday: 0,
          employed: 0,
          unemployed: 0,
          avgHappiness: 0.7,
          avgMoney: 0,
          businessesOpen: 0,
          housingOccupancy: 0,
          transitRidersToday: 0,
          taxiTripsToday: 0,
          resources: { powerDemand: 0, powerSupply: 0, waterDemand: 0, waterSupply: 0 },
          history: [],
        },
        salaryPaidToday: 0,
        salesTaxToday: 0,
        incomeTaxToday: 0,
        propertyTaxToday: 0,
        utilitiesToday: 0,
        maintenanceToday: 0,
        transitToday: 0,
        lastDay: 0,
      },
      weather: { kind: 'clear', intensity: 1, target: 'clear', wetness: 0, windDir: 0.6, manual: false },
      projects: [],
      tasks: [],
      news: [],
      activity: [],
      cityEvents: [],
      commands: [],
      taxiQueue: [],
      lastHour: Math.floor(hourOf(START_TIME)),
      cooldowns: {},
      edgeLoad: w.roads.edges.map(() => 0),
    };
    this.state.businesses = createBusinesses(this);
    for (const biz of this.state.businesses) this.state.buildings[this.bIndex(biz.buildingId)].dyn.ownerId = biz.id;
    // systems that population generation depends on
    this.traffic = new TrafficSystem(this);
    generatePopulation(this);
    this.attachSystems();
    this.economy.rebuildEmployees();
    this.cityEvents.scheduleDay();
    this.economy.hourly();
    for (const c of this.state.citizens) this.bus.emit('citizen.created', this.time, { citizenId: c.profile.id });
    this.cityEvents.news('city', 'Welcome to Morphis', `${this.state.citizens.length} citizens, ${this.world.buildings.length} buildings and ${this.state.vehicles.length} vehicles are now simulated.`, 'info', this.world.hqId);
    this.bus.drain(); // creation noise is covered by the init payload
  }

  private attachSystems(): void {
    if (!this.traffic) this.traffic = new TrafficSystem(this);
    else this.traffic.reindex();
    this.economy = new EconomySystem(this);
    this.citizens = new CitizenSystem(this);
    this.weather = new WeatherSystem(this);
    this.cityEvents = new CityEventSystem(this);
    this.workforce = new WorkforceSystem(this);
    for (const b of this.state.buildings) b.dyn.occupants = b.occupants.length;
  }

  // ---------------------------------------------------------------- accessors

  get time(): number {
    return this.state.clock.time;
  }

  bIndex(id: string): number {
    const i = this.bIdx.get(id);
    if (i === undefined) throw new Error(`unknown building ${id}`);
    return i;
  }

  building(id: string): BuildingDef {
    return this.world.buildings[this.bIndex(id)];
  }

  landmark(key: string): BuildingDef | null {
    const id = this.landmarks[key];
    return id ? this.building(id) : null;
  }

  buildingsOfType(types: string[]): BuildingDef[] {
    const out: BuildingDef[] = [];
    for (const t of types) out.push(...(this.typeIndex.get(t) ?? []));
    return out;
  }

  randomBuilding(types: BuildingType[]): BuildingDef | null {
    const list = this.buildingsOfType(types).filter((b) => !b.construction);
    return list.length ? this.rng.pick(list) : null;
  }

  citizenById(id: string): CitizenRT | undefined {
    return this.citizens.get(id);
  }

  businessById(id: string): Business | undefined {
    return this.economy.byId(id);
  }

  newRouteId(): number {
    return this.state.nextRouteId++;
  }

  newId(prefix: string): string {
    return `${prefix}_${(this.state.nextId++).toString(36)}`;
  }

  makeSchedule(shift: 'day') {
    return buildSchedule(this.rng, shift, false);
  }

  /** Bus line connecting two buildings with short walks at both ends. */
  transitOption(from: BuildingDef, to: BuildingDef): { line: string; a: string; b: string } | null {
    const w = this.world;
    const stopsById = new Map(w.busStops.map((s) => [s.id, s]));
    let best: { line: string; a: string; b: string; cost: number } | null = null;
    const direct = Math.hypot(from.position.x - to.position.x, from.position.z - to.position.z);
    for (const line of w.busLines) {
      let a: string | null = null;
      let ad = Infinity;
      let b: string | null = null;
      let bd = Infinity;
      for (const sid of line.stops) {
        const s = stopsById.get(sid)!;
        const da = Math.hypot(s.position.x - from.position.x, s.position.z - from.position.z);
        const db = Math.hypot(s.position.x - to.position.x, s.position.z - to.position.z);
        if (da < ad) {
          ad = da;
          a = sid;
        }
        if (db < bd) {
          bd = db;
          b = sid;
        }
      }
      if (!a || !b || a === b) continue;
      const walk = ad + bd;
      if (ad > 40 || bd > 40 || walk > direct * 0.6) continue;
      if (!best || walk < best.cost) best = { line: line.id, a, b, cost: walk };
    }
    return best ? { line: best.line, a: best.a, b: best.b } : null;
  }

  /** Construction site or empty office for a newly founded company. */
  findCompanySite(): BuildingDef | null {
    const sites = this.world.buildings.filter((b) => b.construction && this.state.buildings[b.index].dyn.status === 'CONSTRUCTION');
    if (sites.length) return sites[0];
    const offices = this.buildingsOfType(['office']).filter((b) => (this.economy.byBuilding(b.id)?.employees.length ?? 0) === 0);
    return offices[0] ?? null;
  }

  // ---------------------------------------------------------------- tick

  tick(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const st = this.state;
    const prevMinute = minuteOfDay(st.clock.time);
    const prevDay = dayOf(st.clock.time);
    st.clock.time += 1;
    st.clock.tick += 1;
    const time = st.clock.time;
    const minute = minuteOfDay(time);

    if (minute !== prevMinute) {
      this.weather.minute();
      this.cityEvents.minute();
      this.workforce.minute();
      if (minute % 5 === 0) this.citizens.updateNeeds(5);
      if (minute % 10 === 0) {
        this.traffic.manageVisitors();
        this.citizens.handleTimeouts();
      }
      if (minute % 15 === 0) this.cityEvents.monitor();
      if (minute % 60 === 0) {
        const hour = Math.floor(minute / 60);
        st.lastHour = hour;
        this.weather.hourly();
        this.economy.hourly();
        this.workforce.hourly();
        this.bus.emit('city.time.updated', time, { time, day: dayOf(time), hour });
      }
    }
    if (dayOf(time) !== prevDay) {
      this.economy.daily();
      this.cityEvents.scheduleDay();
    }
    this.citizens.tick();
    this.traffic.tick();

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.perf.tickMs = this.perf.tickMs * 0.98 + (t1 - t0) * 0.02;
    this.perf.ticks++;
  }

  /** Run `n` ticks (used by fast-forward and tests). */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  // ---------------------------------------------------------------- commands

  command(cmd: SimCommand): CommandReply {
    const st = this.state;
    switch (cmd.type) {
      case 'sim.setPaused':
        st.clock.paused = cmd.paused;
        return { ok: true };
      case 'sim.setSpeed':
        st.clock.speed = cmd.speed;
        return { ok: true };
      case 'sim.setWeather':
        if (cmd.weather === 'auto') st.weather.manual = false;
        else this.weather.setTarget(cmd.weather, true);
        return { ok: true };
      case 'sim.skip': {
        const ticks = Math.round(cmd.hours * 3600);
        this.run(ticks);
        return { ok: true, data: { ticks } };
      }
      case 'jarvis.command':
        return this.jarvisCommand(cmd.text, null, cmd.urgent ?? false);
      default:
        return { ok: false, error: `${cmd.type} must be handled by the host (persistence)` };
    }
  }

  /** Accept a command and plan it (template planner unless a plan is supplied by an LLM planner). */
  jarvisCommand(text: string, plan: ProjectPlan | null, urgent = false): CommandReply {
    const sim = this as CitySimulation;
    const p = plan ?? templatePlan(text);
    const err = validatePlan(p);
    const record = {
      id: sim.newId('cmd'),
      text,
      time: sim.time,
      status: err ? ('REJECTED' as const) : ('RUNNING' as const),
      projectId: null as string | null,
      planner: p.planner,
      message: err ? `Plan rejected: ${err}` : `Planned "${p.name}" with ${p.tasks.length} tasks${urgent ? ' (urgent: team called in now)' : ''}.`,
    };
    sim.state.commands.push(record);
    if (sim.state.commands.length > 50) sim.state.commands.shift();
    if (!err) {
      const hq = sim.world.hqId;
      const project = sim.workforce.createProject(p, 'jarvis', hq, null, record.id, urgent);
      record.projectId = project.id;
    }
    sim.bus.emit('jarvis.command', sim.time, { command: record });
    return err ? { ok: false, error: record.message, data: record } : { ok: true, data: record };
  }

  // ---------------------------------------------------------------- frames

  buildMotionFrame(): MotionFrame {
    const citizens: number[] = [];
    for (const c of this.state.citizens) {
      if (c.walker) citizens.push(c.profile.index, c.walker.route.id, Math.round(c.walker.s * 100) / 100);
    }
    const vehicles: number[] = [];
    for (const v of this.state.vehicles) {
      if (v.route && v.active) vehicles.push(v.info.index, v.route.id, Math.round(v.s * 100) / 100, Math.round(v.v * 100) / 100);
    }
    return { tick: this.state.clock.tick, time: this.time, citizens, vehicles, signals: this.traffic.signalPhases(this.time) };
  }

  stats(): CityStats {
    const counts = this.citizens.statusCounts();
    const pop = this.state.citizens.length;
    const asleep = counts.SLEEPING ?? 0;
    const moving = this.traffic.moving;
    const veh = this.state.vehicles.filter((v) => v.active).length;
    // a vehicle counts as congested when it has been held for longer than a full signal cycle
    let jammed = 0;
    for (const v of this.state.vehicles) {
      if (v.route && v.active && v.v < 0.3 && !(v.bus && v.bus.dwellUntil > this.time) && (this.time - v.waitingSince) / SIM_SECONDS_PER_MOTION_SECOND > SIGNAL_CYCLE) jammed++;
    }
    const congestion = moving ? jammed / moving : 0;
    const r = this.state.economy.summary.resources;
    let status: CityStats['status'] = 'NORMAL';
    if (this.state.weather.kind === 'storm') status = 'STORM ALERT';
    else if (r.powerSupply && r.powerDemand / r.powerSupply > 0.92) status = 'POWER STRAIN';
    else if (congestion > 0.3 && moving > 12) status = 'CONGESTED';
    else if (moving > 25 || (counts.WALKING ?? 0) > pop * 0.15) status = 'BUSY';
    return {
      population: pop,
      activeCitizens: pop - asleep,
      walking: counts.WALKING ?? 0,
      traveling: counts.TRAVELING ?? 0,
      working: (counts.WORKING ?? 0) + (counts.LEARNING ?? 0),
      sleeping: asleep,
      vehiclesMoving: moving,
      vehiclesTotal: veh,
      avgTrafficSpeed: Math.round(this.traffic.avgSpeed * 100) / 100,
      congestion: Math.round(congestion * 100) / 100,
      status,
      activeRoutes: this.citizens.walkingCount() + moving,
    };
  }

  buildStateFrame(full: boolean): StateFrame {
    const st = this.state;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.perf.lastWindow > 1000) {
      this.perf.tps = (this.perf.ticks * 1000) / Math.max(1, now - this.perf.lastWindow);
      this.perf.ticks = 0;
      this.perf.lastWindow = now;
    }
    for (const b of st.buildings) b.dyn.occupants = b.occupants.length;
    const frame: StateFrame = {
      clock: { ...st.clock },
      citizens: st.citizens.map((c) => c.dyn as CitizenDynamic),
      vehicles: st.vehicles.map((v) => v.dyn),
      occupancy: st.buildings.map((b) => b.occupants.length),
      stats: this.stats(),
      economy: st.economy.summary,
      weather: st.weather,
      perf: { tickMs: Math.round(this.perf.tickMs * 1000) / 1000, ticksPerSecond: Math.round(this.perf.tps) },
    };
    if (full) {
      frame.businesses = st.businesses;
      const buildings: Record<string, typeof st.buildings[number]['dyn']> = {};
      this.world.buildings.forEach((b, i) => (buildings[b.id] = st.buildings[i].dyn));
      frame.buildings = buildings;
    }
    return frame;
  }

  activeRoutes(): ActiveRoute[] {
    const out: ActiveRoute[] = [];
    for (const c of this.state.citizens) if (c.walker) out.push({ kind: 'citizen', index: c.profile.index, route: c.walker.route });
    for (const v of this.state.vehicles) if (v.route && v.active) out.push({ kind: 'vehicle', index: v.info.index, route: v.route });
    return out;
  }

  buildInit(mode: AuthorityMode, sessionId: string, persistence: PersistenceInfo, ai: AiProviderInfo): InitPayload {
    const st = this.state;
    return {
      mode,
      sessionId,
      world: this.world,
      citizens: st.citizens.map((c) => c.profile),
      vehicles: st.vehicles.map((v) => v.info),
      state: this.buildStateFrame(true),
      routes: this.activeRoutes(),
      projects: st.projects,
      tasks: st.tasks,
      news: st.news.slice(-60),
      activity: st.activity.slice(-80),
      cityEvents: st.cityEvents,
      commands: st.commands,
      persistence,
      ai,
    };
  }

  // ---------------------------------------------------------------- persistence

  serialize(name: string): SaveData {
    this.state.rng = this.rng.getState();
    for (const b of this.state.buildings) b.dyn.occupants = b.occupants.length;
    return {
      format: SAVE_FORMAT,
      version: 1,
      name,
      savedAt: new Date().toISOString(),
      config: this.world.config,
      worldHash: this.world.hash,
      state: JSON.parse(JSON.stringify(this.state)) as SimState,
    };
  }

  isBuildingOpen(b: BuildingDef): boolean {
    const meta = BUILDING_TYPES[b.type];
    return !meta.hours || (hourOf(this.time) >= meta.hours[0] && hourOf(this.time) < meta.hours[1]);
  }
}
