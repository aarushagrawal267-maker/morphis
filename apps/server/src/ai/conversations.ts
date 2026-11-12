/**
 * Conversations between agents, voiced by a real AI model.
 *
 * The simulation notices when two agents who know each other spend time in the
 * same place and offers the encounter. The model writes a short exchange in
 * both voices from facts about each of them (their day, work, ventures,
 * studies, memories). The conversation is logged as a deed and stored in both
 * agents' memories. Over budget or on error, the simulation writes it instead.
 */
import type { AgentEncounter } from '@morphis/shared';
import { dayOf, displayName, firstName, formatSimDateTime } from '@morphis/shared';
import type { CitySimulation, ConversationMind } from '@morphis/sim';
import { talkFacts } from '@morphis/sim';
import { extractJson } from './agents';
import { formatMemory, type AgentMemory } from './memory';
import type { AiProvider, RateLimiter } from './provider';

export interface ConversationStats {
  ai: number;
  simulated: number;
  failed: number;
  lastError: string | null;
  recent: { time: string; summary: string }[];
}

const SYSTEM = [
  'You write a short, natural conversation between two residents of Morphis, a small simulated town on a floating island in the year 2126.',
  'Both are AI agents living there; each has a calling, a day and a history. Let each speak in character.',
  'Use only the facts you are given about them and the town. Do not invent people, places, events, numbers or plans they do not have. Money is simulated credits (§).',
  'Write 2 to 6 lines, alternating speakers, starting with A. Keep each line under 160 characters. No stage directions, no emojis.',
  'Reply with JSON only: {"lines":[{"speaker":"A"|"B","text":"..."}],"summary":"<one sentence in the third person naming both, what they talked about, max 140 characters>","closer":true|false}',
  '"closer" is true when the conversation brought them closer (warm, helpful, shared plans).',
].join('\n');

export class LlmConversations implements ConversationMind {
  private hourStart = Date.now();
  private usedThisHour = 0;
  private inFlight = 0;
  readonly stats: ConversationStats = { ai: 0, simulated: 0, failed: 0, lastError: null, recent: [] };

  constructor(
    private provider: AiProvider,
    private limiter: RateLimiter,
    private getSim: () => CitySimulation | null,
    private memory: AgentMemory,
    private opts: { perHour: number; dailyCap: number },
  ) {}

  request(enc: AgentEncounter): boolean {
    const now = Date.now();
    if (now - this.hourStart > 3_600_000) {
      this.hourStart = now;
      this.usedThisHour = 0;
    }
    if (this.usedThisHour >= this.opts.perHour || this.inFlight >= 2 || this.limiter.used >= this.opts.dailyCap * 0.6) {
      this.stats.simulated++;
      return false;
    }
    const sim = this.getSim();
    if (!sim) return false;
    this.usedThisHour++;
    this.inFlight++;
    void this.run(sim, enc).finally(() => {
      this.inFlight--;
    });
    return true;
  }

  prompt(sim: CitySimulation, enc: AgentEncounter): string {
    const a = sim.citizenById(enc.aId)!;
    const b = sim.citizenById(enc.bId)!;
    const place = displayName(sim.economy.byBuilding(enc.buildingId)?.name ?? sim.building(enc.buildingId).name);
    const person = (label: string, c: typeof a, other: typeof b) => {
      const f = talkFacts(sim, c);
      const mem = this.memory.recall(c.profile.id, `${other.profile.name} ${firstName(other.profile.name)}`, 3);
      return [
        `${label}: ${c.profile.name}, ${c.profile.age}, ${f.calling ?? f.occupation}.`,
        f.specialty ? `Expertise: ${f.specialty}` : '',
        f.why ? `Why they live in Morphis: "${f.why}"` : '',
        `Right now: ${f.doing}. Mood: ${f.mood}.`,
        ...sim.life.conversationTopics(c).map((t) => `- ${firstName(c.profile.name)} ${t}`),
        f.recentDeeds.length ? `Recent deeds: ${f.recentDeeds.slice(-3).join(' ')}` : '',
        mem.length ? `What ${firstName(c.profile.name)} remembers:\n${mem.map(formatMemory).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    };
    return [
      `Where: ${place} (${enc.activity}). When: ${formatSimDateTime(enc.time)}. Weather: ${sim.state.weather.kind}.`,
      'They already know each other.',
      '',
      person('A', a, b),
      '',
      person('B', b, a),
    ].join('\n');
  }

  private async run(sim: CitySimulation, enc: AgentEncounter): Promise<void> {
    const a = sim.citizenById(enc.aId);
    const b = sim.citizenById(enc.bId);
    if (!a || !b) return;
    try {
      const res = await Promise.race([
        this.provider.complete(
          [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: this.prompt(sim, enc) },
          ],
          { maxTokens: 500, temperature: 0.85 },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 60_000)),
      ]);
      if (this.getSim() !== sim) return;
      const j = extractJson(res.text) as { lines?: { speaker?: string; text?: string }[]; summary?: string; closer?: boolean };
      const lines = (j.lines ?? [])
        .filter((l) => typeof l.text === 'string' && (l.speaker === 'A' || l.speaker === 'B'))
        .map((l) => ({ citizenId: l.speaker === 'A' ? enc.aId : enc.bId, text: l.text!.replace(/\s+/g, ' ').trim() }));
      if (lines.length < 2 || typeof j.summary !== 'string') throw new Error('conversation without lines or summary');
      const deed = sim.life.recordConversation(enc, lines, j.summary, 'ai', j.closer !== false);
      if (!deed) return;
      this.remember(sim, enc, deed.text);
      this.stats.ai++;
      this.stats.recent.push({ time: new Date().toISOString(), summary: deed.text });
      if (this.stats.recent.length > 20) this.stats.recent.shift();
    } catch (e) {
      this.stats.failed++;
      this.stats.lastError = e instanceof Error ? e.message.slice(0, 160) : String(e);
      if (this.getSim() !== sim) return;
      // the encounter still happened: the simulation writes the conversation
      const t = sim.life.simulatedConversation(enc);
      sim.life.recordConversation(enc, t.lines, t.summary, 'sim', true);
    }
  }

  private remember(sim: CitySimulation, enc: AgentEncounter, summary: string): void {
    const day = dayOf(sim.time);
    for (const [me, other] of [
      [enc.aId, enc.bId],
      [enc.bId, enc.aId],
    ]) {
      const o = sim.citizenById(other);
      this.memory.add(me, { time: new Date().toISOString(), kind: 'talk', day, summary: `Talked with ${o?.profile.name ?? 'a friend'}: ${summary}` });
    }
  }
}
