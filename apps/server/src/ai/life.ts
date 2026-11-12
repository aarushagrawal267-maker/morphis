/**
 * LLM life mind: lets a real AI model make the agents' daily life decisions.
 *
 * The simulation offers each agent a short list of options it can actually
 * carry out (open a venture, invest, help build, study, change job, rest). The
 * model picks one and explains why in the agent's own voice. The simulation
 * re-validates the choice before acting, and records the decision as made by
 * the AI. If the model is busy, over budget or too slow, the simulation decides
 * and says so.
 */
import type { CitySimulation, LifeMind } from '@morphis/sim';
import type { LifeDecision } from '@morphis/shared';
import { AMBITION_LABEL, dayOf, formatCredits, formatSimDateTime } from '@morphis/shared';
import type { AiProvider, RateLimiter } from './provider';
import { extractJson } from './agents';
import { formatMemory, type AgentMemory } from './memory';

export interface LifeMindOptions {
  /** Max evening life decisions sent to the model per real hour. */
  perHour: number;
  /** Max day turns (lunch and evening plans) sent to the model per real hour (0 = always simulated). */
  turnsPerHour?: number;
  /** Max decisions in flight at once (the rest are decided by the simulation). */
  maxInFlight: number;
  /** Leave this share of the daily request cap for JARVIS work. */
  reserveShare: number;
  dailyCap: number;
}

export interface LifeMindStats {
  requested: number;
  decided: number;
  failed: number;
  skipped: number;
  lastError: string | null;
  recent: { time: string; agent: string; choice: string; plan: string }[];
}

const SYSTEM = [
  'You are the inner voice of one agent living in Morphis, a simulated lantern-lit town on a floating island in the year 2126.',
  'Three times a day the agent decides something: in the morning what to do at lunch, around midday what to do this evening, and in the evening what to do with tomorrow. You choose exactly one of the offered options.',
  'Stay in character: the agent has a calling, an ambition, interests and a history of deeds.',
  'Only use facts given to you. Money is simulated credits (§). Do not invent people, places or numbers.',
  'Reply with JSON only: {"choice":"<option id>","reason":"<one or two sentences, first person, why>","plan":"<a short line the agent might say out loud about it, max 70 characters>"}',
].join('\n');

export class LlmLifeMind implements LifeMind {
  private inFlight = 0;
  private hourStart = Date.now();
  private usedThisHour = 0;
  private turnsThisHour = 0;
  readonly stats: LifeMindStats = { requested: 0, decided: 0, failed: 0, skipped: 0, lastError: null, recent: [] };

  constructor(
    private provider: AiProvider,
    private limiter: RateLimiter,
    private getSim: () => CitySimulation | null,
    private memory: AgentMemory | null,
    private opts: LifeMindOptions,
    /** Cheaper model for day turns (falls back to the main provider). */
    private turnProvider: AiProvider | null = null,
  ) {}

  request(decision: LifeDecision): boolean {
    const now = Date.now();
    if (now - this.hourStart > 3_600_000) {
      this.hourStart = now;
      this.usedThisHour = 0;
      this.turnsThisHour = 0;
    }
    const isTurn = decision.phase === 'morning' || decision.phase === 'midday';
    const budgetLeft = this.limiter.used < this.opts.dailyCap * (1 - this.opts.reserveShare);
    const hourly = isTurn ? this.turnsThisHour < (this.opts.turnsPerHour ?? 0) : this.usedThisHour < this.opts.perHour;
    if (this.inFlight >= this.opts.maxInFlight || !hourly || !budgetLeft) {
      this.stats.skipped++;
      return false;
    }
    const sim = this.getSim();
    if (!sim) return false;
    if (isTurn) this.turnsThisHour++;
    else this.usedThisHour++;
    this.inFlight++;
    this.stats.requested++;
    void this.run(sim, decision).finally(() => {
      this.inFlight--;
    });
    return true;
  }

  private prompt(sim: CitySimulation, d: LifeDecision): string {
    const c = sim.citizenById(d.citizenId)!;
    const p = c.profile;
    const a = p.agent!;
    const life = sim.life.life(p.id)!;
    const deeds = sim.life.deedsOf(p.id, 8).reverse();
    const own = sim.life.venture(life.ventureId);
    const helping = sim.life.venture(life.helpingId);
    const work = p.workplaceId ? sim.building(p.workplaceId).name : 'no job';
    const lines = [
      `Agent: ${p.name}, ${p.age}, ${a.calling}${a.workforce ? ' (member of the JARVIS workforce)' : a.agency ? " (a specialist from The Agency; keeps their craft and is hired for JARVIS projects)" : ''}.`,
      `Ambition: ${AMBITION_LABEL[a.ambition]}. Interests: ${a.interests.join(', ')}.`,
      `Why they came to Morphis: "${a.why}"`,
      `Now: ${formatSimDateTime(sim.time)}, day ${dayOf(sim.time)}. Works at: ${work}. Credits available: ${formatCredits(sim.life.funds(c))}. Happiness ${Math.round(c.dyn.happiness * 100)}%.`,
      own ? `Owns: ${own.name} (${own.status === 'OPEN' ? 'open' : `being fitted out, ${Math.round((own.progress / own.work) * 100)}% done`}).` : '',
      helping ? `Currently helping to build: ${helping.name}.` : '',
      life.study ? `Studying ${life.study.field}: ${Math.round((life.study.minutes / life.study.required) * 100)}% of classes done.` : '',
      life.graduated.length ? `Graduated in: ${life.graduated.join(', ')}.` : '',
      life.friends?.length ? `Friends: ${life.friends.map((id) => sim.citizenById(id)?.profile.name).filter(Boolean).join(', ')}.` : '',
      life.stakes.length ? `Investments: ${life.stakes.map((s) => `${formatCredits(s.amount)} in ${sim.life.venture(s.ventureId)?.name ?? '?'}`).join('; ')}.` : '',
      deeds.length ? `Recent deeds:\n${deeds.map((x) => `- ${formatSimDateTime(x.time)}: ${x.text}`).join('\n')}` : '',
      ...(() => {
        const mem = this.memory?.recall(p.id, d.options.map((o) => o.label).join(' '), 4) ?? [];
        return mem.length ? [`What they remember:\n${mem.map(formatMemory).join('\n')}`] : [];
      })(),
      '',
      d.phase === 'morning' ? 'Options for lunch today:' : d.phase === 'midday' ? 'Options for this evening:' : 'Options for tomorrow:',
      ...d.options.map((o) => `- id "${o.id}": ${o.label}. ${o.detail}`),
    ];
    return lines.filter((l) => l !== '').join('\n');
  }

  private async run(sim: CitySimulation, d: LifeDecision): Promise<void> {
    const c = sim.citizenById(d.citizenId);
    if (!c) return;
    try {
      const turn = d.phase === 'morning' || d.phase === 'midday';
      const res = await (turn && this.turnProvider ? this.turnProvider : this.provider).complete(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: this.prompt(sim, d) },
        ],
        { maxTokens: 400, temperature: 0.8 },
      );
      if (this.getSim() !== sim) return; // a different city was loaded meanwhile
      const parsed = (extractJson(res.text) ?? {}) as { choice?: unknown; reason?: unknown; plan?: unknown };
      const choice = typeof parsed.choice === 'string' ? parsed.choice.trim() : '';
      const reason = typeof parsed.reason === 'string' ? parsed.reason : null;
      const plan = typeof parsed.plan === 'string' ? parsed.plan : null;
      const r = sim.life.resolve(d.id, choice, reason, plan);
      if (r.ok) {
        this.stats.decided++;
        const opt = d.options.find((o) => o.id === choice);
        this.stats.recent.push({ time: new Date().toISOString(), agent: c.profile.name, choice: opt?.label ?? choice, plan: plan ?? '' });
        if (this.stats.recent.length > 20) this.stats.recent.shift();
      } else {
        this.stats.failed++;
        this.stats.lastError = r.error ?? 'rejected';
      }
    } catch (e) {
      this.stats.failed++;
      this.stats.lastError = e instanceof Error ? e.message.slice(0, 200) : String(e);
      // leave the decision pending: the simulation decides when the deadline passes
    }
  }
}
