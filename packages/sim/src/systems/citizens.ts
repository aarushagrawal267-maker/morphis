/**
 * Citizen system: schedule- and needs-driven decisions, trip planning
 * (walk / own car / taxi / bus), physical walking on the pedestrian network
 * (with signal-aware crosswalks), building occupancy and needs dynamics.
 *
 * Citizens never teleport: every change of building happens through a trip.
 */
import type { ActivityKind, BuildingDef, CitizenStatus, TravelMode } from '@morphis/shared';
import {
  BUILDING_TYPES,
  MOTION_SECONDS_PER_TICK,
  WALK_SPEED,
  hourOf,
  isOpenAt,
  isWeekend,
  minuteOfDay,
} from '@morphis/shared';
import { MinHeap } from '../core/heap';
import { buildWalk } from '../nav/routes';
import type { CitizenRT, TripStage, VehicleRT } from '../state';
import type { CitySimulation } from '../engine';

const DT = MOTION_SECONDS_PER_TICK;

const STATUS_FOR: Record<ActivityKind, CitizenStatus> = {
  sleep: 'SLEEPING',
  home: 'AT_HOME',
  work: 'WORKING',
  study: 'LEARNING',
  eat: 'EATING',
  shop: 'SHOPPING',
  leisure: 'SOCIALIZING',
  park: 'RESTING',
  event: 'SOCIALIZING',
  meeting: 'WORKING',
};

/** How long (sim seconds) an errand lasts before the citizen re-plans. */
const DURATION: Partial<Record<ActivityKind, number>> = {
  eat: 50 * 60,
  shop: 45 * 60,
  leisure: 100 * 60,
  park: 70 * 60,
  event: 120 * 60,
};

const PURPOSE: Record<ActivityKind, string> = {
  sleep: 'to sleep',
  home: 'home',
  work: 'to work',
  study: 'for classes',
  eat: 'for a meal',
  shop: 'to shop',
  leisure: 'to unwind',
  park: 'for a walk in the park',
  event: 'for an event',
  meeting: 'for a meeting',
};

export class CitizenSystem {
  private heap = new MinHeap<number>();
  private walkers = new Set<number>();
  private byId = new Map<string, CitizenRT>();

  constructor(private sim: CitySimulation) {
    this.reindex();
  }

  reindex(): void {
    this.heap.clear();
    this.walkers.clear();
    this.byId.clear();
    for (const c of this.sim.state.citizens) {
      this.byId.set(c.profile.id, c);
      if (c.walker) this.walkers.add(c.profile.index);
      this.heap.push(c.profile.index, this.key(c, c.nextDecision));
    }
  }

  /** Heap key with a deterministic tie-break on citizen index (stable across save/restore). */
  private key(c: CitizenRT, at: number): number {
    return at + c.profile.index * 1e-7;
  }

  get(id: string): CitizenRT | undefined {
    return this.byId.get(id);
  }

  schedule(c: CitizenRT, at: number): void {
    c.nextDecision = at;
    this.heap.push(c.profile.index, this.key(c, at));
  }

  walkingCount(): number {
    return this.walkers.size;
  }

  // ---------------------------------------------------------------- tick

  tick(): void {
    const time = this.sim.time;
    const cs = this.sim.state.citizens;
    while (this.heap.size && this.heap.peekKey() <= time) {
      const key = this.heap.peekKey();
      const idx = this.heap.pop()!;
      const c = cs[idx];
      if (this.key(c, c.nextDecision) !== key) continue; // stale entry
      this.decide(c);
    }
    for (const idx of this.walkers) this.stepWalker(cs[idx]);
  }

  /** Needs dynamics; called every few simulated minutes. */
  updateNeeds(minutes: number): void {
    const st = this.sim.state;
    const weatherPenalty = st.weather.kind === 'storm' ? 0.05 : st.weather.kind === 'rain' ? 0.02 : 0;
    for (const c of st.citizens) {
      const d = c.dyn;
      const s = d.status;
      const k = minutes;
      if (s === 'SLEEPING') {
        d.energy += 0.0021 * k;
        d.satiety -= 0.0004 * k;
      } else {
        d.energy -= (s === 'WORKING' || s === 'LEARNING' ? 0.0012 : s === 'WALKING' ? 0.0011 : 0.0008) * k;
        d.satiety -= 0.0011 * k;
      }
      if (s === 'SOCIALIZING' || s === 'EATING' || s === 'WORKING') d.social += 0.0018 * k;
      else d.social -= 0.0006 * k;
      if (s === 'SOCIALIZING' || s === 'RESTING' || s === 'SHOPPING') d.fun += 0.003 * k;
      else d.fun -= (s === 'WORKING' ? 0.0007 : 0.0004) * k;
      d.energy = clamp01(d.energy);
      d.satiety = clamp01(d.satiety);
      d.social = clamp01(d.social);
      d.fun = clamp01(d.fun);
      const moneyFactor = clamp01(d.money / Math.max(1500, c.profile.salary * 0.5));
      const target = 0.24 * d.energy + 0.24 * d.satiety + 0.18 * d.social + 0.2 * d.fun + 0.14 * moneyFactor - weatherPenalty;
      d.happiness = clamp01(d.happiness + (target - d.happiness) * Math.min(1, 0.02 * k));
    }
  }

  // ---------------------------------------------------------------- decisions

  private currentBlock(c: CitizenRT): { activity: ActivityKind; nextStart: number } {
    const time = this.sim.time;
    const sched = isWeekend(time) ? c.profile.weekendSchedule : c.profile.schedule;
    const m = minuteOfDay(time);
    let cur = sched[0];
    let next: number | null = null;
    for (let i = 0; i < sched.length; i++) {
      if (sched[i].start <= m) cur = sched[i];
      else {
        next = sched[i].start;
        break;
      }
    }
    const dayStart = time - (time % 86400);
    const nextStart = next !== null ? dayStart + next * 60 : dayStart + 86400 + 60;
    return { activity: cur.activity, nextStart };
  }

  private decide(c: CitizenRT): void {
    if (c.trip || c.walker) return;
    const sim = this.sim;
    const time = sim.time;
    const d = c.dyn;
    const block = this.currentBlock(c);
    let activity = block.activity;
    const h = hourOf(time);

    // needs override the schedule
    if (activity !== 'sleep' && d.energy < 0.12) activity = 'home';
    else if (d.satiety < 0.22 && activity !== 'sleep' && activity !== 'eat' && h > 6.5 && h < 23) activity = 'eat';
    if ((activity === 'work' || activity === 'study') && !c.profile.workplaceId) activity = h < 18 ? 'park' : 'home';

    // core citizens with a task in another building go there during work hours
    if (activity === 'work' && d.currentTaskId) {
      const task = sim.workforce.task(d.currentTaskId);
      if (task && task.buildingId !== c.profile.workplaceId && task.status === 'ACTIVE') activity = 'meeting';
    }

    const target = this.targetFor(c, activity);
    if (!target) {
      this.schedule(c, time + 20 * 60);
      return;
    }
    const until = Math.min(block.nextStart, DURATION[activity] ? time + DURATION[activity]! : block.nextStart);
    if (target.id === c.insideId) {
      this.setActivity(c, activity);
      this.schedule(c, Math.max(time + 300, until));
      return;
    }
    this.startTrip(c, target, activity);
  }

  private targetFor(c: CitizenRT, activity: ActivityKind): BuildingDef | null {
    const sim = this.sim;
    const p = c.profile;
    const hour = hourOf(sim.time);
    const here = c.insideId ? sim.building(c.insideId) : sim.building(p.homeId);
    const near = (types: string[], maxD = 90): BuildingDef | null => {
      const cands = sim.buildingsOfType(types).filter((b) => {
        if (b.construction) return false;
        const dyn = sim.state.buildings[b.index].dyn;
        if (dyn.status !== 'ACTIVE') return false;
        if (!isOpenAt(b.type, hour + 0.4)) return false;
        return Math.hypot(b.position.x - here.position.x, b.position.z - here.position.z) < maxD;
      });
      if (!cands.length) return null;
      return sim.rng.weighted(cands, (b) => {
        const dist = Math.hypot(b.position.x - here.position.x, b.position.z - here.position.z);
        const occ = sim.state.buildings[b.index].occupants.length;
        const crowd = occ >= b.capacity ? 0.05 : 1;
        return (b.named ? 2.2 : 1) * crowd / (1 + dist / 25);
      }) ?? null;
    };
    switch (activity) {
      case 'sleep':
      case 'home':
        return sim.building(p.homeId);
      case 'work':
      case 'study':
        return p.workplaceId ? sim.building(p.workplaceId) : null;
      case 'meeting': {
        const task = c.dyn.currentTaskId ? sim.workforce.task(c.dyn.currentTaskId) : null;
        return task ? sim.building(task.buildingId) : p.workplaceId ? sim.building(p.workplaceId) : null;
      }
      case 'eat':
        return near(['cafe', 'restaurant'], 70) ?? near(['cafe', 'restaurant'], 200) ?? sim.building(p.homeId);
      case 'shop':
        return near(['shop'], 90) ?? near(['shop'], 220);
      case 'park':
        return near(['park'], 140) ?? near(['park'], 300);
      case 'leisure':
      case 'event': {
        const ev = sim.cityEvents.attractiveEvent(here);
        if (ev && sim.rng.chance(0.55)) return sim.building(ev.buildingId);
        return near(['entertainment', 'cafe', 'restaurant', 'park', 'shop'], 110) ?? sim.building(p.homeId);
      }
    }
    return null;
  }

  setActivity(c: CitizenRT, activity: ActivityKind): void {
    const d = c.dyn;
    d.activity = activity;
    let status = STATUS_FOR[activity];
    if (activity === 'home' && hourOf(this.sim.time) >= 23) status = 'RESTING';
    if (c.insideId) {
      const b = this.sim.building(c.insideId);
      if (b.type === 'park' || b.type === 'plaza') status = activity === 'event' ? 'SOCIALIZING' : 'RESTING';
    }
    this.setStatus(c, status);
  }

  setStatus(c: CitizenRT, status: CitizenStatus): void {
    const prev = c.dyn.status;
    if (prev === status) return;
    c.dyn.status = status;
    this.sim.bus.emit('citizen.statusChanged', this.sim.time, { citizenId: c.profile.id, status, prev });
    this.sim.workforce.onCitizenStatus(c, prev);
  }

  // ---------------------------------------------------------------- trips

  private chooseMode(c: CitizenRT, from: BuildingDef, to: BuildingDef): { mode: TravelMode; bus?: { line: string; a: string; b: string } } {
    const sim = this.sim;
    const dist = Math.hypot(from.position.x - to.position.x, from.position.z - to.position.z);
    const wet = sim.state.weather.kind === 'rain' || sim.state.weather.kind === 'storm';
    if (c.carId && dist > 50) {
      const car = sim.traffic.byId(c.carId);
      if (car && car.dyn.status === 'PARKED' && car.dyn.parkedAt === from.id) return { mode: 'car' };
    }
    if (dist > 75) {
      const bus = sim.transitOption(from, to);
      const affordTaxi = c.dyn.money > 60;
      if (bus && (!affordTaxi || sim.rng.chance(wet ? 0.35 : 0.6))) return { mode: 'bus', bus };
      if (affordTaxi && (wet || dist > 115 || sim.rng.chance(0.35))) return { mode: 'taxi' };
      if (bus) return { mode: 'bus', bus };
    } else if (dist > 45 && wet && c.dyn.money > 80 && sim.rng.chance(0.3)) {
      return { mode: 'taxi' };
    }
    return { mode: 'walk' };
  }

  private startTrip(c: CitizenRT, dest: BuildingDef, activity: ActivityKind): void {
    const sim = this.sim;
    const from = c.insideId ? sim.building(c.insideId) : sim.building(c.profile.homeId);
    const choice = this.chooseMode(c, from, dest);
    c.trip = { mode: choice.mode, destId: dest.id, activity, startedAt: sim.time, stage: { kind: 'walk', toNode: dest.entranceNode, then: 'arrive' }, queue: [], cost: 0 };
    c.dyn.destinationId = dest.id;
    c.dyn.travelMode = choice.mode;
    sim.workforce.onTripStart(c, dest, activity, PURPOSE[activity]);

    if (choice.mode === 'car' && c.carId) {
      const car = sim.traffic.byId(c.carId)!;
      this.leaveBuilding(c);
      if (sim.traffic.startDrive(car, sim.traffic.accessPos(from), sim.traffic.accessPos(dest), dest.id, { type: 'commute', citizenId: c.profile.id, destId: dest.id })) {
        car.dyn.passengers = [c.profile.id];
        c.trip.stage = { kind: 'car', vehicleId: car.info.id };
        c.dyn.location = { kind: 'vehicle', id: car.info.id };
        sim.bus.emit('citizen.boardedVehicle', sim.time, { citizenId: c.profile.id, vehicleId: car.info.id });
        this.setStatus(c, 'TRAVELING');
        c.trip.cost = 4;
        return;
      }
      this.enterBuilding(c, from.id);
      c.trip.mode = 'walk';
    }
    if (choice.mode === 'taxi') {
      if (sim.traffic.requestTaxi(c.profile.id, from.id, dest.id)) {
        c.trip.stage = { kind: 'taxiWait', requestedAt: sim.time, vehicleId: null };
        c.dyn.travelMode = 'taxi';
        this.setStatus(c, 'IDLE');
        // safety net: if the taxi never arrives, walk instead
        this.schedule(c, sim.time + 2 * 3600);
        return;
      }
      c.trip.mode = 'walk';
      c.dyn.travelMode = 'walk';
    }
    if (choice.mode === 'bus' && choice.bus) {
      const stopA = sim.world.busStops.find((s) => s.id === choice.bus!.a)!;
      c.trip.mode = 'bus';
      c.trip.stage = { kind: 'walk', toNode: stopA.pedNode, then: 'stop' };
      c.trip.queue = [{ kind: 'busWait', stopId: choice.bus.a, lineId: choice.bus.line, alightStopId: choice.bus.b, since: 0 }];
      this.leaveBuilding(c);
      if (this.beginWalk(c, from.entranceNode, stopA.pedNode)) return;
      this.enterBuilding(c, from.id);
      c.trip.mode = 'walk';
      c.trip.queue = [];
      c.trip.stage = { kind: 'walk', toNode: dest.entranceNode, then: 'arrive' };
    }
    // walking
    this.leaveBuilding(c);
    if (!this.beginWalk(c, from.entranceNode, dest.entranceNode)) {
      // unreachable: stay put and retry later
      this.enterBuilding(c, from.id);
      c.trip = null;
      c.dyn.destinationId = null;
      this.schedule(c, sim.time + 30 * 60);
    }
  }

  private beginWalk(c: CitizenRT, fromNode: number, toNode: number): boolean {
    const sim = this.sim;
    const res = buildWalk(sim.pedNav, sim.world.ped.nodes, sim.world.ped.edges, fromNode, toNode, sim.newRouteId());
    if (!res) return false;
    const wet = sim.state.weather.kind === 'rain' || sim.state.weather.kind === 'storm';
    c.walker = { route: res.route, crossings: res.crossings, s: 0, speed: WALK_SPEED * c.speedFactor * (wet ? 1.12 : 1), waiting: false, onCrosswalk: -1 };
    c.dyn.location = { kind: 'street' };
    this.walkers.add(c.profile.index);
    sim.bus.emit('citizen.moved', sim.time, { citizenId: c.profile.id, route: res.route, mode: c.trip?.mode ?? 'walk', destinationId: c.trip?.destId ?? null });
    this.setStatus(c, 'WALKING');
    return true;
  }

  private stepWalker(c: CitizenRT): void {
    const w = c.walker!;
    const traffic = this.sim.traffic;
    // crosswalk handling
    let next = w.s + w.speed * DT;
    for (const cr of w.crossings) {
      if (w.s < cr.s0 - 0.001 && next >= cr.s0) {
        if (!traffic.pedCanCross(cr.node, cr.crosses, this.sim.time)) {
          next = cr.s0 - 0.001;
          w.waiting = true;
        }
        break;
      }
      if (w.s >= cr.s1) continue;
      break;
    }
    if (next > w.s) w.waiting = false;
    w.s = Math.min(next, w.route.length);
    // crosswalk occupancy bookkeeping (vehicles yield to it)
    let on = -1;
    for (const cr of w.crossings) {
      if (w.s >= cr.s0 && w.s < cr.s1) {
        on = cr.pedEdge;
        break;
      }
    }
    if (on !== w.onCrosswalk) {
      if (w.onCrosswalk >= 0) traffic.crosswalkOcc[w.onCrosswalk]--;
      if (on >= 0) traffic.crosswalkOcc[on]++;
      w.onCrosswalk = on;
    }
    if (w.s >= w.route.length) this.finishWalk(c);
  }

  private finishWalk(c: CitizenRT): void {
    const w = c.walker!;
    if (w.onCrosswalk >= 0) this.sim.traffic.crosswalkOcc[w.onCrosswalk]--;
    c.walker = null;
    this.walkers.delete(c.profile.index);
    const trip = c.trip;
    if (!trip) return;
    if (trip.stage.kind === 'walk' && trip.stage.then === 'stop') {
      const wait = trip.queue.shift() as Extract<TripStage, { kind: 'busWait' }>;
      wait.since = this.sim.time;
      trip.stage = wait;
      c.dyn.location = { kind: 'stop', id: wait.stopId };
      this.setStatus(c, 'IDLE');
      this.schedule(c, this.sim.time + 90 * 60); // give up waiting after 90 min
      return;
    }
    this.arrive(c, trip.destId);
  }

  private arrive(c: CitizenRT, buildingId: string): void {
    const trip = c.trip;
    c.trip = null;
    c.dyn.destinationId = null;
    c.dyn.travelMode = null;
    this.enterBuilding(c, buildingId);
    const activity = trip?.activity ?? 'home';
    if (trip?.cost) this.sim.economy.transport(c, trip.cost, trip.mode);
    this.sim.economy.onVisit(c, buildingId, activity);
    this.setActivity(c, activity);
    const block = this.currentBlock(c);
    const until = Math.min(block.nextStart, DURATION[activity] ? this.sim.time + DURATION[activity]! : block.nextStart);
    this.schedule(c, Math.max(this.sim.time + 300, until));
    this.sim.workforce.onArrive(c, buildingId, activity);
  }

  enterBuilding(c: CitizenRT, buildingId: string): void {
    const st = this.sim.state;
    const b = st.buildings[this.sim.bIndex(buildingId)];
    if (!b.occupants.includes(c.profile.id)) b.occupants.push(c.profile.id);
    c.insideId = buildingId;
    c.arrivedAt = this.sim.time;
    c.dyn.location = { kind: 'building', id: buildingId };
    this.sim.bus.emit('citizen.enteredBuilding', this.sim.time, { citizenId: c.profile.id, buildingId });
  }

  leaveBuilding(c: CitizenRT): void {
    if (!c.insideId) return;
    const b = this.sim.state.buildings[this.sim.bIndex(c.insideId)];
    const i = b.occupants.indexOf(c.profile.id);
    if (i >= 0) b.occupants.splice(i, 1);
    const id = c.insideId;
    c.insideId = null;
    this.sim.bus.emit('citizen.leftBuilding', this.sim.time, { citizenId: c.profile.id, buildingId: id });
  }

  // ---------------------------------------------------------------- vehicle callbacks

  onVehicleArrived(v: VehicleRT, citizenId: string, destId: string): void {
    const c = this.byId.get(citizenId);
    if (!c) return;
    v.dyn.passengers = v.dyn.passengers.filter((p) => p !== citizenId);
    this.sim.bus.emit('citizen.alighted', this.sim.time, { citizenId, vehicleId: v.info.id });
    if (c.trip && v.info.kind === 'taxi') {
      // simulated fare: flag fall + distance
      c.trip.cost = Math.round(6 + (v.route?.length ?? 40) * 0.14);
    }
    this.arrive(c, destId);
  }

  boardTaxi(c: CitizenRT, v: VehicleRT): void {
    this.leaveBuilding(c);
    c.trip!.stage = { kind: 'taxiRide', vehicleId: v.info.id };
    c.dyn.location = { kind: 'vehicle', id: v.info.id };
    v.dyn.passengers = [c.profile.id];
    this.sim.bus.emit('citizen.boardedVehicle', this.sim.time, { citizenId: c.profile.id, vehicleId: v.info.id });
    this.setStatus(c, 'TRAVELING');
    this.sim.state.economy.summary.taxiTripsToday++;
  }

  /** Bus reached a stop: alight riders for this stop, board waiting citizens. Returns people moved. */
  onBusAtStop(v: VehicleRT, stopId: string, lineId: string): number {
    const sim = this.sim;
    let moved = 0;
    const stop = sim.world.busStops.find((s) => s.id === stopId)!;
    for (const pid of [...v.dyn.passengers]) {
      const c = this.byId.get(pid);
      if (!c || !c.trip || c.trip.stage.kind !== 'busRide' || c.trip.stage.alightStopId !== stopId) continue;
      v.dyn.passengers = v.dyn.passengers.filter((p) => p !== pid);
      sim.bus.emit('citizen.alighted', sim.time, { citizenId: pid, vehicleId: v.info.id });
      c.trip.stage = { kind: 'walk', toNode: sim.building(c.trip.destId).entranceNode, then: 'arrive' };
      moved++;
      if (!this.beginWalk(c, stop.pedNode, sim.building(c.trip.destId).entranceNode)) this.arrive(c, c.trip.destId);
    }
    for (const c of sim.state.citizens) {
      if (v.dyn.passengers.length >= (v.bus?.capacity ?? 40)) break;
      const t = c.trip;
      if (!t || t.stage.kind !== 'busWait' || t.stage.stopId !== stopId || t.stage.lineId !== lineId) continue;
      const alight = t.stage.alightStopId;
      t.stage = { kind: 'busRide', vehicleId: v.info.id, alightStopId: alight };
      t.cost += 3;
      c.dyn.location = { kind: 'vehicle', id: v.info.id };
      v.dyn.passengers.push(c.profile.id);
      sim.bus.emit('citizen.boardedVehicle', sim.time, { citizenId: c.profile.id, vehicleId: v.info.id });
      this.setStatus(c, 'TRAVELING');
      sim.state.economy.summary.transitRidersToday++;
      moved++;
    }
    return moved;
  }

  /** Scheduled re-check for citizens stuck waiting (taxi never came, bus too late). */
  handleTimeouts(): void {
    const sim = this.sim;
    for (const c of sim.state.citizens) {
      const t = c.trip;
      if (!t) continue;
      if (t.stage.kind === 'taxiWait' && sim.time - t.stage.requestedAt > 2 * 3600) {
        const here = c.insideId ? sim.building(c.insideId) : null;
        if (!here) continue;
        // walk instead
        t.mode = 'walk';
        t.stage = { kind: 'walk', toNode: sim.building(t.destId).entranceNode, then: 'arrive' };
        this.leaveBuilding(c);
        if (!this.beginWalk(c, here.entranceNode, sim.building(t.destId).entranceNode)) {
          this.enterBuilding(c, here.id);
          c.trip = null;
        }
      } else if (t.stage.kind === 'busWait' && sim.time - t.stage.since > 90 * 60) {
        const stop = sim.world.busStops.find((s) => s.id === (t.stage as { stopId: string }).stopId)!;
        t.mode = 'walk';
        t.stage = { kind: 'walk', toNode: sim.building(t.destId).entranceNode, then: 'arrive' };
        t.queue = [];
        if (!this.beginWalk(c, stop.pedNode, sim.building(t.destId).entranceNode)) this.arrive(c, t.destId);
      }
    }
  }

  statusCounts(): Record<CitizenStatus, number> {
    const out = {} as Record<CitizenStatus, number>;
    for (const c of this.sim.state.citizens) out[c.dyn.status] = (out[c.dyn.status] ?? 0) + 1;
    return out;
  }

  isCategoryOpen(b: BuildingDef): boolean {
    return isOpenAt(b.type, hourOf(this.sim.time)) && BUILDING_TYPES[b.type].category !== 'residential';
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
