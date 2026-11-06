/**
 * Real-time driver for a CitySimulation: converts wall-clock time into fixed
 * simulation ticks (speed-dependent) with a per-call CPU budget so a slow
 * machine degrades gracefully (the clock runs slower) instead of freezing.
 */
import { BASE_SIM_SECONDS_PER_REAL_SECOND } from '@morphis/shared';
import type { CitySimulation } from './engine';

export class SimulationRunner {
  private debt = 0;
  /** Ticks that could not be executed within budget (debug overlay). */
  dropped = 0;

  constructor(
    public sim: CitySimulation,
    private budgetMs = 30,
  ) {}

  /** Advance by `realSeconds` of wall-clock time. Returns ticks executed. */
  advance(realSeconds: number): number {
    const clock = this.sim.state.clock;
    if (clock.paused) {
      this.debt = 0;
      return 0;
    }
    this.debt += Math.min(realSeconds, 0.5) * BASE_SIM_SECONDS_PER_REAL_SECOND * clock.speed;
    const want = Math.floor(this.debt);
    const start = now();
    let done = 0;
    while (done < want) {
      this.sim.tick();
      done++;
      if ((done & 15) === 0 && now() - start > this.budgetMs) break;
    }
    this.debt -= done;
    if (this.debt > BASE_SIM_SECONDS_PER_REAL_SECOND * clock.speed) {
      this.dropped += Math.floor(this.debt);
      this.debt = 0;
    }
    return done;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
