/**
 * Skyrail trains: maglev trains circling the elevated loop at constant speed,
 * stopping at every station to let riders off and waiting citizens on.
 */
import type { BuildingDef, RailLine, RailStation } from '@morphis/shared';
import { MOTION_SECONDS_PER_TICK, SIM_SECONDS_PER_MOTION_SECOND } from '@morphis/shared';
import type { TrainRT } from '../state';
import type { CitySimulation } from '../engine';

/** World units per motion second (about 50 km/h at 1 unit = 2 m). */
export const TRAIN_SPEED = 7;
/** Dwell at each station, in motion seconds. */
const DWELL = 6;
const CAPACITY = 60;

export class RailSystem {
  readonly line: RailLine | undefined;

  constructor(private sim: CitySimulation) {
    this.line = sim.world.rail;
  }

  get trains(): TrainRT[] {
    return this.sim.state.trains ?? [];
  }

  /** Create the trains (new cities and saves made before the skyrail existed). */
  ensureTrains(): void {
    const st = this.sim.state;
    if (st.trains || !this.line) return;
    const stations = this.line.stations;
    const count = this.line.length > 480 ? 3 : 2;
    st.trains = [];
    for (let k = 0; k < count; k++) {
      const si = Math.floor((k * stations.length) / count);
      st.trains.push({ s: stations[si].s, dwellUntil: this.sim.time + 1, next: si, passengers: [] });
    }
  }

  station(id: string): RailStation | undefined {
    return this.line?.stations.find((s) => s.id === id);
  }

  tick(): void {
    const line = this.line;
    if (!line) return;
    const time = this.sim.time;
    const L = line.length;
    const step = TRAIN_SPEED * MOTION_SECONDS_PER_TICK;
    for (let i = 0; i < this.trains.length; i++) {
      const t = this.trains[i];
      if (t.dwellUntil > time) continue;
      const st = line.stations[t.next];
      const ahead = (st.s - t.s + L) % L;
      if (ahead <= step) {
        t.s = st.s;
        t.dwellUntil = time + Math.round(DWELL * SIM_SECONDS_PER_MOTION_SECOND);
        this.atStation(i, t, st);
        t.next = (t.next + 1) % line.stations.length;
      } else {
        t.s = (t.s + step) % L;
      }
    }
  }

  private atStation(index: number, t: TrainRT, st: RailStation): void {
    const sim = this.sim;
    for (const pid of [...t.passengers]) {
      const c = sim.citizenById(pid);
      const stage = c?.trip?.stage;
      if (!c || !stage || stage.kind !== 'railRide' || stage.alightId !== st.id) continue;
      t.passengers = t.passengers.filter((p) => p !== pid);
      sim.citizens.alightRail(c, st);
    }
    for (const c of sim.state.citizens) {
      if (t.passengers.length >= CAPACITY) break;
      const stage = c.trip?.stage;
      if (!stage || stage.kind !== 'railWait' || stage.stationId !== st.id) continue;
      t.passengers.push(c.profile.id);
      sim.citizens.boardRail(c, index, stage.alightId);
    }
  }

  /** Stations serving a trip, when the skyrail beats walking by a clear margin. */
  option(from: BuildingDef, to: BuildingDef): { a: string; b: string } | null {
    const line = this.line;
    if (!line) return null;
    let a: RailStation | null = null;
    let ad = Infinity;
    let b: RailStation | null = null;
    let bd = Infinity;
    for (const s of line.stations) {
      const da = Math.hypot(s.access.x - from.position.x, s.access.z - from.position.z);
      const db = Math.hypot(s.access.x - to.position.x, s.access.z - to.position.z);
      if (da < ad) {
        ad = da;
        a = s;
      }
      if (db < bd) {
        bd = db;
        b = s;
      }
    }
    if (!a || !b || a.id === b.id) return null;
    const direct = Math.hypot(from.position.x - to.position.x, from.position.z - to.position.z);
    if (ad > 45 || bd > 45 || ad + bd > direct * 0.55) return null;
    return { a: a.id, b: b.id };
  }

  frame(): number[] {
    return this.trains.map((t) => Math.round(t.s * 100) / 100);
  }
}
