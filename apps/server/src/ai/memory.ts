/**
 * Agent memory: what each agent has done, who they talked to and a short
 * reflection on each day. Relevant memories are recalled into prompts (work,
 * life decisions, conversations) so agents build on their own past.
 * Persisted to DATA_DIR/agent-memory.json so it survives restarts.
 *
 * Every memory is written from something that really happened in the town
 * (a finished task, a conversation, the day's deeds); none are invented.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CitySimulation } from '@morphis/sim';
import { agencyTerms, dayOf } from '@morphis/shared';

export type MemoryKind = 'work' | 'talk' | 'reflection';

export interface MemoryItem {
  /** Real time it was stored (ISO). */
  time: string;
  /** Older files have no kind: those are work memories. */
  kind?: MemoryKind;
  /** Simulated day it is about. */
  day?: number;
  project?: string;
  task?: string;
  summary: string;
}

/** How many memories of each kind an agent keeps (oldest are forgotten first). */
export const MEMORY_LIMITS: Record<MemoryKind, number> = { work: 25, talk: 15, reflection: 20 };

const kindOf = (m: MemoryItem): MemoryKind => m.kind ?? 'work';

/** One line for a prompt. */
export function formatMemory(m: MemoryItem): string {
  const day = m.day !== undefined ? `day ${m.day}` : '';
  switch (kindOf(m)) {
    case 'work':
      return `- [work${day ? `, ${day}` : ''}] ${m.project ? `${m.project}: ` : ''}${m.task ? `${m.task} — ` : ''}${m.summary}`;
    case 'talk':
      return `- [conversation${day ? `, ${day}` : ''}] ${m.summary}`;
    case 'reflection':
      return `- [${day || 'a past day'}] ${m.summary}`;
  }
}

export class AgentMemory {
  private items = new Map<string, MemoryItem[]>();
  private file: string | null;
  private saving: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReflectedDay = -1;

  constructor(dataDir?: string) {
    this.file = dataDir ? path.resolve(dataDir, 'agent-memory.json') : null;
  }

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, MemoryItem[]>;
      for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) this.items.set(k, v);
    } catch {
      /* first run */
    }
  }

  add(citizenId: string, item: MemoryItem): void {
    const list = this.items.get(citizenId) ?? [];
    list.push({ ...item, summary: item.summary.slice(0, 400) });
    // forget the oldest memory of a kind once over its limit
    const kind = kindOf(item);
    const same = list.filter((m) => kindOf(m) === kind);
    if (same.length > MEMORY_LIMITS[kind]) list.splice(list.indexOf(same[0]), 1);
    this.items.set(citizenId, list);
    this.persist();
  }

  recent(citizenId: string, n = 3): MemoryItem[] {
    return (this.items.get(citizenId) ?? []).slice(-n);
  }

  all(citizenId: string): MemoryItem[] {
    return this.items.get(citizenId) ?? [];
  }

  /**
   * The memories most relevant to a situation: word overlap with the query,
   * a preference for recent ones, and always the latest reflection.
   * Returned oldest first, ready for a prompt.
   */
  recall(citizenId: string, query: string, n = 5): MemoryItem[] {
    const list = this.items.get(citizenId) ?? [];
    if (list.length <= n) return [...list];
    const terms = new Set(agencyTerms(query));
    const scored = list.map((m, i) => {
      const words = new Set(agencyTerms(`${m.project ?? ''} ${m.task ?? ''} ${m.summary}`));
      let overlap = 0;
      for (const t of terms) if (words.has(t)) overlap++;
      return { m, i, score: overlap * 2 + (1.5 * (i + 1)) / list.length };
    });
    const latestReflection = [...list].reverse().find((m) => kindOf(m) === 'reflection');
    const picked = new Set<MemoryItem>(latestReflection ? [latestReflection] : []);
    for (const s of scored.sort((a, b) => b.score - a.score)) {
      if (picked.size >= n) break;
      picked.add(s.m);
    }
    return list.filter((m) => picked.has(m));
  }

  /**
   * End of a simulated day: each agent keeps a reflection made of what they
   * actually did that day (their deeds). Runs once per day.
   */
  reflect(sim: CitySimulation, day: number): number {
    if (day <= this.lastReflectedDay) return 0;
    this.lastReflectedDay = day;
    const byAgent = new Map<string, string[]>();
    for (const d of sim.life.deeds) {
      if (dayOf(d.time) !== day || d.kind === 'arrived') continue;
      const list = byAgent.get(d.citizenId) ?? [];
      list.push(d.text);
      byAgent.set(d.citizenId, list);
    }
    let n = 0;
    for (const [citizenId, texts] of byAgent) {
      const c = sim.citizenById(citizenId);
      if (!c?.profile.agent) continue;
      const life = sim.life.life(citizenId);
      const plan = life?.plan && life.plan !== 'Settling in.' ? ` Plan for tomorrow: ${life.plan}` : '';
      this.add(citizenId, { time: new Date().toISOString(), kind: 'reflection', day, summary: `${texts.slice(-6).join(' ')}${plan}` });
      n++;
    }
    return n;
  }

  private persist(): void {
    if (!this.file || this.timer) return;
    // batch writes: many memories can arrive at once (end-of-day reflections)
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, 1500);
    this.timer.unref?.();
  }

  private write(): void {
    const file = this.file;
    if (!file) return;
    const snapshot = JSON.stringify(Object.fromEntries(this.items));
    this.saving = this.saving
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, snapshot);
      })
      .catch(() => undefined);
  }

  /** Write pending memories now (used on shutdown and in tests). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.write();
    }
    return this.saving;
  }
}
