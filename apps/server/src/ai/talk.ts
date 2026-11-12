/**
 * Conversations voiced by the AI model. The simulation supplies the facts
 * (what the person is doing, their plan, recent deeds, what is open nearby);
 * the model answers in that person's voice, using only those facts. When the
 * model is unavailable, busy or over budget, the simulated answer is used and
 * marked as such.
 */
import type { CitySimulation, TalkFacts, TalkTopic } from '@morphis/sim';
import { simulatedReply, talkFacts } from '@morphis/sim';
import type { AiProvider, RateLimiter } from './provider';
import { stripReasoning } from './provider';
import { dayOf } from '@morphis/shared';
import { formatMemory, type AgentMemory } from './memory';

export interface TalkReply {
  reply: string;
  by: 'ai' | 'sim';
  note?: string;
}

export interface TalkStats {
  ai: number;
  simulated: number;
  failed: number;
  lastError: string | null;
}

const QUESTION: Record<Exclude<TalkTopic, 'chat'>, string> = {
  upto: 'What are you up to?',
  where: "Where's good around here?",
};

function system(f: TalkFacts): string {
  const who = [
    `You are ${f.name}, ${f.age}, a ${f.calling ?? f.occupation} living in Morphis, a small lantern-lit town on a floating island in the year 2126.`,
    f.why ? `Why you came to Morphis: "${f.why}"` : '',
    f.ambition ? `Your ambition: ${f.ambition}.` : '',
    f.workforce ? 'You are part of the JARVIS workforce that takes on projects for the town.' : '',
    f.specialty ? `You are one of The Agency's specialists, and JARVIS hires you for projects. Your expertise: ${f.specialty}` : '',
  ].filter(Boolean);
  return [
    ...who,
    'A visitor has walked up to you in town and is talking to you.',
    'Rules: answer as yourself in the first person, in one to three short sentences, casual and warm.',
    'For anything about the town, places, times, distances and your own day, use only the facts you are given. Never invent places, people, events or numbers. If you do not know, say so naturally.',
    'Money is simulated credits (§).',
    'If asked whether you are real or an AI, say you are a resident of the simulated town of Morphis, voiced by an AI model.',
    'No emojis, no stage directions, no quotation marks around your answer.',
  ].join('\n');
}

export class LlmTalker {
  private windowStart = Date.now();
  private usedThisMinute = 0;
  private memory = new Map<string, { visitor: string; me: string }[]>();
  readonly stats: TalkStats = { ai: 0, simulated: 0, failed: 0, lastError: null };

  constructor(
    private provider: AiProvider,
    private limiter: RateLimiter,
    private opts: { perMinute: number; dailyCap: number },
    private agentMemory: AgentMemory | null = null,
  ) {}

  /** Agents remember their conversations with visitors (long-term memory). */
  private remember(sim: CitySimulation, citizenId: string, said: string, reply: string): void {
    if (!this.agentMemory || !sim.citizenById(citizenId)?.profile.agent) return;
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    this.agentMemory.add(citizenId, { time: new Date().toISOString(), kind: 'talk', day: dayOf(sim.time), summary: `A visitor said "${clip(said, 120)}" and I answered "${clip(reply, 160)}"` });
  }

  private budget(): boolean {
    const now = Date.now();
    if (now - this.windowStart > 60_000) {
      this.windowStart = now;
      this.usedThisMinute = 0;
    }
    if (this.usedThisMinute >= this.opts.perMinute) return false;
    if (this.limiter.used >= this.opts.dailyCap * 0.9) return false;
    this.usedThisMinute++;
    return true;
  }

  async reply(sim: CitySimulation, citizenId: string, topic: TalkTopic, text?: string): Promise<TalkReply | null> {
    const c = sim.citizenById(citizenId);
    if (!c) return null;
    const facts = talkFacts(sim, c);
    const said = topic === 'chat' ? (text ?? '').trim() || 'Hello!' : QUESTION[topic];
    const fallback = (note: string): TalkReply => {
      this.stats.simulated++;
      const reply = simulatedReply(facts, topic);
      this.remember(sim, citizenId, said, reply);
      return { reply, by: 'sim', note };
    };
    if (!this.budget()) return fallback('The AI is busy right now, so this answer comes from the simulation.');
    const history = this.memory.get(citizenId) ?? [];
    const remembered = this.agentMemory?.recall(citizenId, said, 4) ?? [];
    const user = [
      `Facts about you and the town right now (JSON):\n${JSON.stringify(facts)}`,
      remembered.length ? `Things you remember (your own past days, work and conversations):\n${remembered.map(formatMemory).join('\n')}` : '',
      history.length ? `Earlier today visitors talked with you:\n${history.map((h) => `Visitor: ${h.visitor}\nYou: ${h.me}`).join('\n')}` : '',
      `The visitor says: "${said}"`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const res = await Promise.race([
        this.provider.complete(
          [
            { role: 'system', content: system(facts) },
            { role: 'user', content: user },
          ],
          { maxTokens: 220, temperature: 0.8 },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 25_000)),
      ]);
      let out = stripReasoning(res.text).replace(/^\s*["“]|["”]\s*$/g, '').replace(/\s+/g, ' ').trim();
      if (!out) throw new Error('empty reply');
      if (out.length > 420) out = `${out.slice(0, 417).trimEnd()}…`;
      history.push({ visitor: said, me: out });
      if (history.length > 6) history.shift();
      this.memory.set(citizenId, history);
      this.remember(sim, citizenId, said, out);
      this.stats.ai++;
      return { reply: out, by: 'ai' };
    } catch (e) {
      this.stats.failed++;
      this.stats.lastError = e instanceof Error ? e.message.slice(0, 160) : String(e);
      return fallback('The AI did not answer, so this answer comes from the simulation.');
    }
  }
}
