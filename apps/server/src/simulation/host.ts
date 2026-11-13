/**
 * Authoritative simulation host: owns the CitySimulation, advances it in real
 * time, broadcasts frames/state/events to every connected client and executes
 * validated commands (including persistence and JARVIS).
 */
import type { Server } from 'socket.io';
import type { InitPayload, SaveSummary, SimCommand } from '@morphis/shared';
import { PUBLIC_COMMANDS, SOCKET_EVENTS, dayOf } from '@morphis/shared';
import { timingSafeEqual } from 'node:crypto';
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
  private lastDay = -1;
  io: Server | null = null;
  presence: { count: number; stop(): void } | null = null;
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
    this.sim.life.mind = this.agents.lifeMind && this.agents.live ? this.agents.lifeMind : null;
    this.sim.life.talker = this.agents.conversations && this.agents.live ? this.agents.conversations : null;
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
    this.presence?.stop();
    if (this.timer) clearInterval(this.timer);
    if (this.autosave) clearInterval(this.autosave);
    this.timer = null;
  }

  private loop(): void {
    const now = performance.now();
    this.runner.advance((now - this.last) / 1000);
    this.last = now;
    this.loops++;
    this.endOfDay();
    this.broadcastPending();
    if (!this.io) return;
    this.io.volatile.emit(SOCKET_EVENTS.frame, this.sim.buildMotionFrame());
    if (this.loops % 10 === 0) this.io.emit(SOCKET_EVENTS.state, this.sim.buildStateFrame(this.loops % 100 === 0));
  }

  /** When a simulated day ends, each agent stores a reflection on it in long-term memory. */
  private endOfDay(): void {
    const day = dayOf(this.sim.time);
    if (this.lastDay >= 0 && day > this.lastDay) this.agents.memory.reflect(this.sim, day - 1);
    this.lastDay = day;
  }

  private broadcastPending(): void {
    const events = this.sim.bus.drain();
    if (events.length && this.io) this.io.emit(SOCKET_EVENTS.events, events);
  }

  initPayload(): InitPayload {
    return { ...this.sim.buildInit('server', this.sessionId, this.persistence.info, this.agents.info), approvals: this.agents.tools.recentApprovals() };
  }

  /** Continue the most recent save (after a restart or redeploy). Returns its name, or null. */
  async resumeLatest(): Promise<string | null> {
    const saves = await this.persistence.list();
    if (!saves.length) return null;
    const latest = [...saves].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
    this.replace(CitySimulation.fromSave(await this.persistence.load(latest.id)));
    return latest.name;
  }

  private replace(next: CitySimulation): void {
    this.sim = next;
    this.lastDay = -1;
    this.runner = new SimulationRunner(next, 35);
    this.attachExecutor();
    next.bus.drain();
    this.io?.emit(SOCKET_EVENTS.init, this.initPayload());
  }

  async save(name?: string): Promise<SaveSummary> {
    const data = this.sim.serialize(name ?? `Morphis day ${Math.floor(this.sim.time / 86400) + 1}`);
    return this.persistence.save(data, { population: this.sim.state.citizens.length, sim: this.sim } as { population: number });
  }

  /** Hosted towns: control commands need the admin key; visitors can walk, wave and talk. */
  canRun(cmd: SimCommand, token: string | undefined): boolean {
    const key = this.cfg.ADMIN_TOKEN;
    if (!key || PUBLIC_COMMANDS.includes(cmd.type)) return true;
    return this.isAdmin(token);
  }

  isAdmin(token: string | undefined): boolean {
    const key = this.cfg.ADMIN_TOKEN;
    if (!key) return true;
    if (!token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  get locked(): boolean {
    return !!this.cfg.ADMIN_TOKEN;
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
        case 'guest.talk': {
          if (this.agents.talker && this.agents.live) {
            const r = await this.agents.talker.reply(this.sim, cmd.citizenId, cmd.topic, cmd.text);
            return r ? { ok: true, data: r } : { ok: false, error: 'unknown citizen' };
          }
          return this.sim.command(cmd);
        }
        case 'guest.wave': {
          const r = this.sim.command(cmd);
          this.broadcastPending();
          return r;
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
