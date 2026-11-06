/**
 * Vehicle & traffic system.
 *
 * - Vehicles follow lane-level routes produced by DriveRouter.
 * - Longitudinal control uses the Intelligent Driver Model (car following),
 *   with stop lines from traffic signals, unsignalised intersection
 *   reservations, "don't block the box" and pedestrian yielding.
 * - Fleets: private cars (citizen commutes), taxis (dispatch), buses (fixed
 *   loop lines with stops and dwell), delivery vans (business restocking) and
 *   external visitors entering through the expressway gates.
 * Congestion is emergent: density and signal capacity determine speed.
 */
import type { BuildingDef, RoadEdge, VehicleInfo, VehicleKind } from '@morphis/shared';
import {
  MOTION_SECONDS_PER_TICK,
  SIGNAL_ALL_RED,
  SIGNAL_CYCLE,
  SIGNAL_GREEN,
  SIGNAL_YELLOW,
  SIM_SECONDS_PER_MOTION_SECOND,
  hourOf,
  isWeekend,
} from '@morphis/shared';
import { hash2 } from '../core/rng';
import type { RoadPos } from '../nav/routes';
import { makeRoute } from '../nav/routes';
import type { DriveLeg, VehicleJob, VehicleRT } from '../state';
import type { CitySimulation } from '../engine';

const DT = MOTION_SECONDS_PER_TICK;
const MS = SIM_SECONDS_PER_MOTION_SECOND;

const KIND_SPEC: Record<VehicleKind, { length: number; maxSpeed: number; accel: number }> = {
  car: { length: 2.3, maxSpeed: 8, accel: 1.6 },
  taxi: { length: 2.3, maxSpeed: 8, accel: 1.7 },
  visitor: { length: 2.4, maxSpeed: 8.5, accel: 1.5 },
  bus: { length: 6.2, maxSpeed: 5.5, accel: 0.9 },
  delivery: { length: 3.4, maxSpeed: 6.5, accel: 1.1 },
};

const CAR_COLORS = ['#cbd5e1', '#1e293b', '#7f1d1d', '#1e3a8a', '#334155', '#e2e8f0', '#0f766e', '#6b21a8', '#9a3412', '#111827'];

interface Slot {
  v: VehicleRT;
  pos: number;
}

export class TrafficSystem {
  private laneMap = new Map<string, Slot[]>();
  private nodeOcc = new Map<number, VehicleRT[]>();
  /** Vehicles per road edge (for congestion-aware routing and news). */
  edgeCount: Int32Array;
  edgeStopped: Int32Array;
  /** Pedestrians currently on each crosswalk ped edge. */
  crosswalkOcc: Int32Array;
  private signalOffset: Float64Array;
  private vehById = new Map<string, VehicleRT>();
  /** Edges of the central circular avenue (ring traffic has priority, entries yield). */
  private ringEdges = new Set<number>();
  avgSpeed = 0;
  moving = 0;

  constructor(private sim: CitySimulation) {
    const w = sim.world;
    this.edgeCount = new Int32Array(w.roads.edges.length);
    this.edgeStopped = new Int32Array(w.roads.edges.length);
    this.crosswalkOcc = new Int32Array(w.ped.edges.length);
    this.signalOffset = new Float64Array(w.roads.nodes.length);
    for (const n of w.roads.nodes) this.signalOffset[n.id] = hash2(n.id, w.seed) * SIGNAL_CYCLE;
    for (const e of w.roads.edges) if (e.name === 'Command Circle') this.ringEdges.add(e.id);
    this.reindex();
  }

  reindex(): void {
    this.vehById.clear();
    for (const v of this.sim.state.vehicles) this.vehById.set(v.info.id, v);
    this.crosswalkOcc.fill(0);
    for (const c of this.sim.state.citizens) {
      if (c.walker && c.walker.onCrosswalk >= 0) this.crosswalkOcc[c.walker.onCrosswalk]++;
    }
  }

  byId(id: string): VehicleRT | undefined {
    return this.vehById.get(id);
  }

  // ---------------------------------------------------------------- fleet creation

  createVehicle(kind: VehicleKind, ownerId: string | null, label: string, parkedAt: string | null, lineId?: string): VehicleRT {
    const st = this.sim.state;
    const idx = st.vehicles.length;
    const spec = KIND_SPEC[kind];
    const color =
      kind === 'taxi' ? '#facc15' : kind === 'bus' ? '#0ea5e9' : kind === 'delivery' ? '#e5e7eb' : CAR_COLORS[this.sim.rng.int(0, CAR_COLORS.length - 1)];
    const info: VehicleInfo = { id: `vehicle_${String(idx).padStart(4, '0')}`, index: idx, kind, color, ownerId, label };
    if (lineId) info.lineId = lineId;
    const v: VehicleRT = {
      info,
      dyn: { status: parkedAt ? 'PARKED' : 'IDLE', speed: 0, passengers: [], destinationId: null, parkedAt, odometer: 0, trips: 0 },
      route: null,
      legs: [],
      s: 0,
      v: 0,
      legIdx: 0,
      job: null,
      waitingSince: 0,
      inNode: -1,
      bus: null,
      length: spec.length,
      maxSpeed: spec.maxSpeed * this.sim.rng.range(0.9, 1.05),
      active: kind !== 'visitor',
    };
    st.vehicles.push(v);
    this.vehById.set(info.id, v);
    return v;
  }

  // ---------------------------------------------------------------- signals

  /** Phase 0..5: 0 G0 green, 1 G0 yellow, 2 all red, 3 G1 green, 4 G1 yellow, 5 all red. */
  phaseAt(node: number, time: number): number {
    const t = (time / MS + this.signalOffset[node]) % SIGNAL_CYCLE;
    const half = SIGNAL_GREEN + SIGNAL_YELLOW + SIGNAL_ALL_RED;
    const base = t < half ? 0 : 3;
    const tt = t < half ? t : t - half;
    if (tt < SIGNAL_GREEN) return base;
    if (tt < SIGNAL_GREEN + SIGNAL_YELLOW) return base + 1;
    return base + 2;
  }

  /** Light shown to an approach (edge entering node). */
  lightFor(node: number, edge: RoadEdge, time: number): 'green' | 'yellow' | 'red' {
    const g = edge.a === node ? edge.groupA : edge.groupB;
    const ph = this.phaseAt(node, time);
    const greenPh = g === 0 ? 0 : 3;
    if (ph === greenPh) return 'green';
    if (ph === greenPh + 1) return 'yellow';
    return 'red';
  }

  /** Pedestrians may cross `edge` at `node` while the crossing traffic group is held at red. */
  pedCanCross(node: number, edgeId: number, time: number): boolean {
    const n = this.sim.world.roads.nodes[node];
    if (!n.signal) {
      return true;
    }
    const e = this.sim.world.roads.edges[edgeId];
    const g = e.a === node ? e.groupA : e.groupB;
    const ph = this.phaseAt(node, time);
    return ph === (g === 0 ? 3 : 0);
  }

  signalPhases(time: number): number[] {
    return this.sim.signalNodes.map((n) => this.phaseAt(n, time));
  }

  // ---------------------------------------------------------------- routing helpers

  accessPos(b: BuildingDef): RoadPos {
    return { edge: b.access.edge, s: b.access.s, side: b.access.side };
  }

  gatePos(gateNode: number, inbound: boolean): RoadPos {
    const w = this.sim.world;
    const n = w.roads.nodes[gateNode];
    const e = w.roads.edges[n.edges[0]];
    const gateIsA = e.a === gateNode;
    if (inbound) {
      // travel away from the gate
      return gateIsA ? { edge: e.id, s: 3, side: 1 } : { edge: e.id, s: e.length - 3, side: -1 };
    }
    return gateIsA ? { edge: e.id, s: 3, side: -1 } : { edge: e.id, s: e.length - 3, side: 1 };
  }

  congestionCost = (edge: number): number => this.sim.state.edgeLoad[edge] ?? 0;

  /** Plan and start a drive. Returns false when no route exists. */
  startDrive(v: VehicleRT, from: RoadPos, to: RoadPos, destId: string | null, job: VehicleJob): boolean {
    const plan = this.sim.router.plan(this.sim.newRouteId(), from, to, v.info.index, this.congestionCost);
    if (!plan) return false;
    v.route = plan.route;
    v.legs = plan.legs;
    v.s = 0;
    v.v = 0;
    v.legIdx = 0;
    v.job = job;
    v.inNode = -1;
    v.waitingSince = this.sim.time;
    v.dyn.status = 'DRIVING';
    v.dyn.parkedAt = null;
    v.dyn.destinationId = destId;
    v.dyn.trips++;
    v.active = true;
    this.sim.bus.emit('vehicle.moved', this.sim.time, { vehicleId: v.info.id, route: plan.route, destinationId: destId });
    return true;
  }

  park(v: VehicleRT, buildingId: string | null): void {
    v.route = null;
    v.legs = [];
    v.v = 0;
    v.s = 0;
    v.inNode = -1;
    v.dyn.status = 'PARKED';
    v.dyn.speed = 0;
    v.dyn.parkedAt = buildingId;
    v.dyn.destinationId = null;
    this.sim.bus.emit('vehicle.parked', this.sim.time, { vehicleId: v.info.id, buildingId });
  }

  // ---------------------------------------------------------------- per-tick update

  tick(): void {
    const st = this.sim.state;
    const time = this.sim.time;
    const edges = this.sim.world.roads.edges;
    const nodes = this.sim.world.roads.nodes;
    const weather = st.weather;
    const wetFactor = 1 - 0.18 * weather.wetness - (weather.kind === 'fog' ? 0.15 * weather.intensity : 0);

    // rebuild occupancy
    this.laneMap.clear();
    this.nodeOcc.clear();
    this.edgeCount.fill(0);
    const movers: VehicleRT[] = [];
    for (const v of st.vehicles) {
      if (!v.route || !v.active) continue;
      movers.push(v);
      while (v.legIdx < v.legs.length - 1 && v.s >= v.legs[v.legIdx].s1) v.legIdx++;
      const leg = v.legs[v.legIdx];
      if (!leg) continue;
      const pos = leg.t0 + (v.s - leg.s0);
      let list = this.laneMap.get(leg.key);
      if (!list) this.laneMap.set(leg.key, (list = []));
      list.push({ v, pos });
      if (leg.kind === 'turn') {
        let occ = this.nodeOcc.get(leg.node);
        if (!occ) this.nodeOcc.set(leg.node, (occ = []));
        occ.push(v);
      } else {
        this.edgeCount[leg.edge]++;
      }
    }
    for (const list of this.laneMap.values()) list.sort((a, b) => a.pos - b.pos);
    this.edgeStopped.fill(0);

    let speedSum = 0;
    let moving = 0;
    for (const v of movers) {
      this.step(v, time, wetFactor, edges, nodes);
      if (v.route) {
        speedSum += v.v;
        moving++;
        const leg = v.legs[v.legIdx];
        if (leg && leg.kind === 'lane' && v.v < 0.3) this.edgeStopped[leg.edge]++;
      }
    }
    this.moving = moving;
    this.avgSpeed = moving ? speedSum / moving : 0;
    if (this.sim.state.clock.tick % 60 === 0) {
      // persistable congestion snapshot for routing
      const load = this.sim.state.edgeLoad;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const cap = Math.max(1, (e.length / 5) * e.lanes);
        const l = this.edgeCount[i] / cap;
        load[i] = Math.round((l * l * 4 + this.edgeStopped[i] * 0.8) * 1000) / 1000;
      }
    }
  }

  private leaderGap(v: VehicleRT, leg: DriveLeg, pos: number): { gap: number; speed: number } {
    const list = this.laneMap.get(leg.key);
    let gap = Infinity;
    let speed = 0;
    if (list) {
      for (const sl of list) {
        if (sl.v === v) continue;
        // ignore vehicles we overlap with (kerb spawns); they separate as the leader moves on
        if (sl.pos > pos && sl.pos - pos - sl.v.length > -0.3) {
          gap = sl.pos - pos - sl.v.length;
          speed = sl.v.v;
          break;
        }
      }
    }
    if (gap === Infinity && v.legIdx < v.legs.length - 1) {
      // look into the next leg
      const next = v.legs[v.legIdx + 1];
      const nl = this.laneMap.get(next.key);
      if (nl && nl.length) {
        const remaining = leg.s1 - v.s;
        for (const sl of nl) {
          if (sl.v === v) continue;
          const g = remaining + (sl.pos - next.t0) - sl.v.length;
          if (g < -0.3) continue;
          gap = g;
          speed = sl.v.v;
          break;
        }
      }
    }
    return { gap, speed };
  }

  /** Must the vehicle stop at the end of its current lane leg? */
  private mustStop(
    v: VehicleRT,
    leg: DriveLeg,
    time: number,
    nodes: CitySimulation['world']['roads']['nodes'],
    edges: RoadEdge[],
    stuck = false,
  ): boolean {
    if (leg.kind !== 'lane' || v.legIdx >= v.legs.length - 1) return false;
    const node = nodes[leg.node];
    if (node.edges.length < 3) return false;
    const next = v.legs[v.legIdx + 1];
    if (next.kind === 'lane' && next.edge === leg.edge) return false; // not an intersection crossing
    const nextLane = next.kind === 'turn' ? v.legs[v.legIdx + 2] : next;
    const edge = edges[leg.edge];
    const dist = leg.s1 - v.s;
    if (node.signal) {
      const light = this.lightFor(node.id, edge, time);
      if (light === 'red') return true;
      if (light === 'yellow' && dist > v.v * 1.4 + 0.6) return true;
    } else if (!stuck) {
      const ringThrough = this.ringEdges.has(leg.edge) && !!nextLane && this.ringEdges.has(nextLane.edge);
      // vehicles continuing around the ring have priority; everyone else needs a free junction
      if (!ringThrough) {
        const occ = this.nodeOcc.get(node.id);
        const waited = (time - v.waitingSince) / MS;
        if (occ && occ.length && waited < 25) {
          if (occ.some((o) => o !== v && o.legs[o.legIdx - 1]?.edge !== leg.edge)) return true;
        }
      }
    }
    if (stuck) return false;
    // pedestrians on the crosswalk across this or the exit leg
    const cw1 = this.sim.crosswalkAt.get(`${node.id}:${leg.edge}`);
    if (cw1 !== undefined && this.crosswalkOcc[cw1] > 0) return true;
    if (nextLane) {
      const cw2 = this.sim.crosswalkAt.get(`${node.id}:${nextLane.edge}`);
      if (cw2 !== undefined && this.crosswalkOcc[cw2] > 0) return true;
      // don't block the box (only meaningful when the exit lane can hold a queue)
      const exit = edges[nextLane.edge];
      const laneLen = exit.length - exit.setbackA - exit.setbackB;
      const nl = this.laneMap.get(nextLane.key);
      const guardBox = laneLen > 2 * (v.length + 2) || this.ringEdges.has(nextLane.edge);
      if (guardBox && nl && nl.length && nl[0].v !== v && nl[0].v.v < 0.5 && nl[0].pos - nextLane.t0 < nl[0].v.length + v.length + 1) return true;
    }
    return false;
  }

  private step(v: VehicleRT, time: number, wetFactor: number, edges: RoadEdge[], nodes: CitySimulation['world']['roads']['nodes']): void {
    const route = v.route!;
    const leg = v.legs[v.legIdx];
    if (!leg) {
      this.arrive(v);
      return;
    }
    // bus dwelling at a stop
    if (v.bus && v.bus.dwellUntil > time) {
      v.v = 0;
      v.dyn.status = 'BOARDING';
      return;
    }
    const edge = edges[leg.edge];
    let v0 = Math.min(v.maxSpeed, edge.speedLimit) * wetFactor;
    if (leg.kind === 'turn') v0 *= 0.55;
    const pos = leg.t0 + (v.s - leg.s0);
    // Deadlock breaker: after a very long wait that is not a red light, the vehicle
    // squeezes past (rare cyclic gridlock in dense grids).
    const stuck = (time - v.waitingSince) / MS > 150;
    let { gap, speed: lv } = stuck ? { gap: Infinity, speed: 0 } : this.leaderGap(v, leg, pos);

    // stop line
    if (this.mustStop(v, leg, time, nodes, edges, stuck)) {
      const d = leg.s1 - v.s - 0.4;
      if (d < gap) {
        gap = Math.max(0, d);
        lv = 0;
      }
    }
    // route end / bus stop
    const toEnd = route.length - v.s;
    if (toEnd < gap) {
      gap = toEnd + 1.2;
      lv = 0;
    }
    if (v.bus) {
      const stopS = v.bus.stopS[v.bus.nextStop];
      if (stopS !== undefined && stopS >= v.s - 0.05) {
        const d = stopS - v.s + 1.2;
        if (d < gap) {
          gap = d;
          lv = 0;
        }
      }
    }

    // IDM
    const a = KIND_SPEC[v.info.kind].accel;
    const b = 2.2;
    const s0 = 1.2;
    const T = 1.1;
    const sStar = s0 + v.v * T + (v.v * (v.v - lv)) / (2 * Math.sqrt(a * b));
    const free = 1 - Math.pow(v.v / Math.max(0.1, v0), 4);
    const inter = gap === Infinity ? 0 : Math.pow(Math.max(0, sStar) / Math.max(0.05, gap), 2);
    const acc = Math.max(-8, a * (free - inter));
    let nv = Math.max(0, v.v + acc * DT);
    let ds = nv * DT;
    if (gap !== Infinity) {
      const maxMove = Math.max(0, gap - s0 * 0.5);
      if (ds > maxMove) {
        ds = maxMove;
        nv = Math.min(nv, maxMove / DT);
      }
    }
    v.v = nv;
    v.s += ds;
    v.dyn.speed = nv;
    v.dyn.odometer += ds;
    if (nv > 0.15) {
      v.waitingSince = time;
      v.dyn.status = 'DRIVING';
    } else {
      v.dyn.status = 'WAITING';
    }

    // bus stop arrival
    if (v.bus) {
      const stopS = v.bus.stopS[v.bus.nextStop];
      if (stopS !== undefined && v.s > stopS - 0.6 && v.v < 0.3) {
        this.busAtStop(v);
      }
    }
    if (v.s >= route.length - 0.08) this.arrive(v);
  }

  // ---------------------------------------------------------------- arrivals & jobs

  private arrive(v: VehicleRT): void {
    const job = v.job;
    const sim = this.sim;
    const destId = v.dyn.destinationId;
    sim.bus.emit('vehicle.arrived', sim.time, { vehicleId: v.info.id, buildingId: destId });
    if (!job) {
      this.park(v, destId);
      return;
    }
    switch (job.type) {
      case 'commute': {
        this.park(v, job.destId);
        sim.citizens.onVehicleArrived(v, job.citizenId, job.destId);
        break;
      }
      case 'taxiPickup': {
        const c = sim.citizenById(job.citizenId);
        if (!c || !c.trip || c.trip.stage.kind !== 'taxiWait') {
          this.returnTaxi(v);
          break;
        }
        sim.citizens.boardTaxi(c, v);
        const from = this.accessPos(sim.building(job.pickupId));
        const dest = sim.building(job.destId);
        if (!this.startDrive(v, from, this.accessPos(dest), dest.id, { type: 'taxiRide', citizenId: c.profile.id, destId: dest.id })) {
          sim.citizens.onVehicleArrived(v, c.profile.id, job.pickupId);
          this.returnTaxi(v);
        }
        break;
      }
      case 'taxiRide': {
        sim.citizens.onVehicleArrived(v, job.citizenId, job.destId);
        this.returnTaxi(v);
        break;
      }
      case 'taxiReturn':
        this.park(v, job.standId);
        break;
      case 'bus': {
        // loop: restart the same line route from the first stop
        if (v.bus && v.route) {
          v.s = 0;
          v.legIdx = 0;
          v.bus.nextStop = 0;
          this.busAtStop(v);
          this.sim.bus.emit('vehicle.moved', sim.time, { vehicleId: v.info.id, route: v.route, destinationId: null });
        }
        break;
      }
      case 'delivery': {
        if (job.phase === 'outbound') {
          sim.economy.deliver(job.businessId);
          const from = this.accessPos(sim.building(sim.businessById(job.businessId)!.buildingId));
          const depot = sim.building(job.depotId);
          if (!this.startDrive(v, from, this.accessPos(depot), depot.id, { ...job, phase: 'return' })) this.park(v, job.depotId);
        } else {
          this.park(v, job.depotId);
        }
        break;
      }
      case 'visitor': {
        if (job.phase === 'inbound' && job.destId) {
          this.park(v, job.destId);
        } else {
          // left the city
          this.park(v, null);
          v.active = false;
          v.job = null;
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- taxis

  requestTaxi(citizenId: string, pickupId: string, destId: string): boolean {
    const pickup = this.sim.building(pickupId);
    let best: VehicleRT | null = null;
    let bd = Infinity;
    for (const v of this.sim.state.vehicles) {
      if (v.info.kind !== 'taxi' || v.dyn.status !== 'PARKED' || !v.dyn.parkedAt) continue;
      const b = this.sim.building(v.dyn.parkedAt);
      const d = Math.hypot(b.position.x - pickup.position.x, b.position.z - pickup.position.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return false;
    const from = this.accessPos(this.sim.building(best.dyn.parkedAt!));
    return this.startDrive(best, from, this.accessPos(pickup), pickupId, { type: 'taxiPickup', citizenId, pickupId, destId });
  }

  private returnTaxi(v: VehicleRT): void {
    const here = v.dyn.destinationId ? this.sim.building(v.dyn.destinationId) : null;
    const stands = this.sim.taxiStands;
    let best = stands[0];
    let bd = Infinity;
    if (here) {
      for (const id of stands) {
        const b = this.sim.building(id);
        const d = Math.hypot(b.position.x - here.position.x, b.position.z - here.position.z);
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
    }
    if (!here || !this.startDrive(v, this.accessPos(here), this.accessPos(this.sim.building(best)), best, { type: 'taxiReturn', standId: best })) {
      this.park(v, best);
    }
  }

  // ---------------------------------------------------------------- buses

  /** Build the loop route of a bus line through all its stops. */
  setupBus(v: VehicleRT, lineId: string, startStop: number): boolean {
    const w = this.sim.world;
    const line = w.busLines.find((l) => l.id === lineId);
    if (!line) return false;
    const stops = line.stops.map((id) => w.busStops.find((s) => s.id === id)!);
    const order = [...stops.slice(startStop), ...stops.slice(0, startStop)];
    const pts: number[] = [];
    const legs: DriveLeg[] = [];
    const stopS: number[] = [];
    let offset = 0;
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      const b = order[(i + 1) % order.length];
      const plan = this.sim.router.plan(0, { edge: a.edge, s: a.s, side: a.side }, { edge: b.edge, s: b.s, side: b.side }, v.info.index);
      if (!plan) return false;
      stopS.push(offset);
      const p = plan.route.points;
      for (let k = pts.length ? 2 : 0; k < p.length; k++) pts.push(p[k]);
      for (const l of plan.legs) {
        const prev = legs[legs.length - 1];
        if (prev && prev.kind === 'lane' && l.kind === 'lane' && prev.key === l.key) {
          prev.s1 = l.s1 + offset; // same lane continues through the stop
          continue;
        }
        legs.push({ ...l, s0: l.s0 + offset, s1: l.s1 + offset });
      }
      offset += plan.route.length;
    }
    const route = makeRoute(this.sim.newRouteId(), pts);
    v.route = route;
    v.legs = legs;
    v.s = 0;
    v.legIdx = 0;
    v.job = { type: 'bus' };
    v.dyn.status = 'BOARDING';
    v.dyn.parkedAt = null;
    v.bus = { lineId, startStop, stopS, nextStop: 0, dwellUntil: this.sim.time + 10 * MS, capacity: 40 };
    v.active = true;
    this.sim.bus.emit('vehicle.moved', this.sim.time, { vehicleId: v.info.id, route, destinationId: null });
    return true;
  }

  private busAtStop(v: VehicleRT): void {
    const bus = v.bus!;
    const line = this.sim.world.busLines.find((l) => l.id === bus.lineId)!;
    if (bus.nextStop >= bus.stopS.length) return;
    const stopId = this.busStopIdAt(v, bus.nextStop);
    const moved = this.sim.citizens.onBusAtStop(v, stopId, line.id);
    bus.dwellUntil = this.sim.time + (8 + moved * 1.5) * MS;
    v.dyn.status = 'BOARDING';
    bus.nextStop++; // after the last stop the bus drives back to stopS[0] and loops
  }

  /** Stop id that a bus will reach at its stopS index. */
  busStopIdAt(v: VehicleRT, i: number): string {
    const line = this.sim.world.busLines.find((l) => l.id === v.bus!.lineId)!;
    return line.stops[(i + v.bus!.startStop) % line.stops.length];
  }

  // ---------------------------------------------------------------- deliveries

  requestDelivery(businessId: string): boolean {
    const biz = this.sim.businessById(businessId);
    if (!biz) return false;
    const target = this.sim.building(biz.buildingId);
    let best: VehicleRT | null = null;
    let bd = Infinity;
    for (const v of this.sim.state.vehicles) {
      if (v.info.kind !== 'delivery' || v.dyn.status !== 'PARKED' || !v.dyn.parkedAt) continue;
      const b = this.sim.building(v.dyn.parkedAt);
      const d = Math.hypot(b.position.x - target.position.x, b.position.z - target.position.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return false;
    const depot = best.dyn.parkedAt!;
    return this.startDrive(best, this.accessPos(this.sim.building(depot)), this.accessPos(target), target.id, {
      type: 'delivery',
      businessId,
      depotId: depot,
      phase: 'outbound',
    });
  }

  // ---------------------------------------------------------------- external traffic

  /** Called every 10 sim minutes: keep the external (visitor) fleet near its time-of-day target. */
  manageVisitors(): void {
    const sim = this.sim;
    const time = sim.time;
    const h = hourOf(time);
    const weekend = isWeekend(time);
    const density = sim.world.config.trafficDensity;
    const morning = Math.exp(-Math.pow((h - 8.2) / 1.2, 2));
    const evening = Math.exp(-Math.pow((h - 17.8) / 1.4, 2));
    const day = h > 7 && h < 21 ? 0.5 : 0.12;
    const target = Math.round(density * (weekend ? 10 * day + 4 : 22 * morning + 6 * day + 4));
    const visitors = sim.state.vehicles.filter((v) => v.info.kind === 'visitor');
    const active = visitors.filter((v) => v.active);
    const gates = sim.world.roads.nodes.filter((n) => n.gate).map((n) => n.id);
    if (!gates.length) return;

    // departures
    for (const v of active) {
      const job = v.job;
      if (!job || job.type !== 'visitor' || job.phase !== 'inbound' || v.dyn.status !== 'PARKED' || time < job.leaveAt) continue;
      if (evening < 0.2 && sim.rng.chance(0.6)) continue;
      const gate = sim.rng.pick(gates);
      const from = job.destId ? this.accessPos(sim.building(job.destId)) : this.gatePos(gate, true);
      this.startDrive(v, from, this.gatePos(gate, false), null, { type: 'visitor', destId: null, phase: 'outbound', leaveAt: 0 });
    }

    const drivingIn = active.filter((v) => v.route).length;
    let toSpawn = Math.min(4, target - drivingIn);
    while (toSpawn-- > 0) {
      let v = visitors.find((x) => !x.active);
      if (!v) {
        if (visitors.length >= 60 * density + 10) break;
        v = this.createVehicle('visitor', null, 'Visitor', null);
        visitors.push(v);
      }
      const gate = sim.rng.pick(gates);
      const through = sim.rng.chance(morning > 0.3 ? 0.15 : 0.4);
      if (through) {
        const out = sim.rng.pick(gates.filter((g) => g !== gate)) ?? gate;
        this.startDrive(v, this.gatePos(gate, true), this.gatePos(out, false), null, { type: 'visitor', destId: null, phase: 'through', leaveAt: 0 });
      } else {
        const dest = sim.randomBuilding(morning > 0.3 ? ['office', 'corporate_tower', 'bank', 'research_lab', 'factory', 'hospital'] : ['shop', 'restaurant', 'entertainment', 'cafe', 'hospital']);
        if (!dest) break;
        const stay = morning > 0.3 ? sim.rng.range(7.5, 9.5) * 3600 : sim.rng.range(1, 3) * 3600;
        this.startDrive(v, this.gatePos(gate, true), this.accessPos(dest), dest.id, { type: 'visitor', destId: dest.id, phase: 'inbound', leaveAt: time + stay });
      }
    }
  }

  /** Worst congested edge (vehicles stopped). */
  worstEdge(): { edge: number; stopped: number } {
    let best = -1;
    let bs = 0;
    for (let i = 0; i < this.edgeStopped.length; i++) {
      if (this.edgeStopped[i] > bs) {
        bs = this.edgeStopped[i];
        best = i;
      }
    }
    return { edge: best, stopped: bs };
  }
}
