/**
 * Authoritative simulation host: owns the CitySimulation, advances it in real
 * time, broadcasts frames/state/events to every connected client and executes
 * validated commands (including persistence and JARVIS).
 */
import type { Server } from 'socket.io';
import type { InitPayload, SaveSummary, SimCommand } from '@morphis/shared';
import { SOCKET_EVENTS } from '@morphis/shared';
import { CitySimulation, SimulationRunner, SimulatedExecutor } from '@morphis/sim';
import type { AgentController } from '../ai/agents';
import type { ServerConfig } from '../config';
import type { PersistenceAdapter } from '../persistence';

export interface CommandReply {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export class SimulationHost {
  sim: CitySimulation;
  private runner: SimulationRunner;
  private timer: ReturnType<typeof setInterval> | null = null;
  private autosave: ReturnType<typeof setInterval> | null = null;
  private last = performance.now();
  private loops = 0;
  io: Server | null = null;
  readonly sessionId = `server-${Date.now().toString(36)}`;

  constructor(
    private cfg: ServerConfig,
    readonly persistence: PersistenceAdapter,
    readonly agents: AgentController,
    sim?: CitySimulation,
  ) {
    this.sim = sim ?? CitySimulation.create({ seed: cfg.CITY_SEED, population: cfg.CITY_POPULATION });
    this.runner = new SimulationRunner(this.sim, 35);
    this.agents.bindSimulation(() => this.sim);
    this.agents.onApprovals = (list) => this.io?.emit(SOCKET_EVENTS.approvals, list);
    this.attachExecutor();
  }

  private attachExecutor(): void {
    this.sim.workforce.executor = this.agents.executor && this.agents.live ? this.agents.executor : new SimulatedExecutor();
  }

  /** Re-evaluate live vs simulated execution (e.g. after the provider check). */
  refreshExecutor(): void {
    this.attachExecutor();
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => this.loop(), 50);
    if (this.cfg.AUTOSAVE_MINUTES > 0) {
      this.autosave = setInterval(() => void this.save(`Autosave ${new Date().toISOString()}`).catch(() => undefined), this.cfg.AUTOSAVE_MINUTES * 60_000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.autosave) clearInterval(this.autosave);
    this.timer = null;
  }

  private loop(): void {
    const now = performance.now();
    this.runner.advance((now - this.last) / 1000);
    this.last = now;
    this.loops++;
    this.broadcastPending();
    if (!this.io) return;
    this.io.volatile.emit(SOCKET_EVENTS.frame, this.sim.buildMotionFrame());
    if (this.loops % 10 === 0) this.io.emit(SOCKET_EVENTS.state, this.sim.buildStateFrame(this.loops % 100 === 0));
  }

  private broadcastPending(): void {
    const events = this.sim.bus.drain();
    if (events.length && this.io) this.io.emit(SOCKET_EVENTS.events, events);
  }

  initPayload(): InitPayload {
    return { ...this.sim.buildInit('server', this.sessionId, this.persistence.info, this.agents.info), approvals: this.agents.tools.recentApprovals() };
  }

  private replace(next: CitySimulation): void {
    this.sim = next;
    this.runner = new SimulationRunner(next, 35);
    this.attachExecutor();
    next.bus.drain();
    this.io?.emit(SOCKET_EVENTS.init, this.initPayload());
  }

  async save(name?: string): Promise<SaveSummary> {
    const data = this.sim.serialize(name ?? `Morphis day ${Math.floor(this.sim.time / 86400) + 1}`);
    return this.persistence.save(data, { population: this.sim.state.citizens.length, sim: this.sim } as { population: number });
  }

  async command(cmd: SimCommand): Promise<CommandReply> {
    try {
      switch (cmd.type) {
        case 'city.save':
          return { ok: true, data: await this.save(cmd.name) };
        case 'city.list':
          return { ok: true, data: await this.persistence.list() };
        case 'city.load': {
          const data = await this.persistence.load(cmd.id);
          this.replace(CitySimulation.fromSave(data));
          return { ok: true, data: { id: cmd.id } };
        }
        case 'city.delete':
          await this.persistence.delete(cmd.id);
          return { ok: true };
        case 'city.new':
          this.replace(CitySimulation.create({ seed: cmd.seed, population: cmd.population ?? this.sim.world.config.population }));
          return { ok: true, data: { seed: cmd.seed } };
        case 'jarvis.approve': {
          const ok = this.agents.tools.decide(cmd.id, cmd.approve);
          return ok ? { ok: true } : { ok: false, error: 'no pending approval with that id' };
        }
        case 'jarvis.command': {
          const { plan, note } = await this.agents.planCommand(cmd.text);
          const reply = this.sim.jarvisCommand(cmd.text, plan, cmd.urgent ?? false);
          this.broadcastPending();
          return reply.ok ? { ok: true, data: { ...(reply.data as object), note } } : { ok: false, error: reply.error };
        }
        default: {
          const r = this.sim.command(cmd);
          this.broadcastPending();
          this.io?.emit(SOCKET_EVENTS.state, this.sim.buildStateFrame(true));
          return r;
        }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
