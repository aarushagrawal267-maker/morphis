import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CitySimulation } from '@morphis/sim';
import { dayOf } from '@morphis/shared';
import { AgentMemory, MEMORY_LIMITS, formatMemory } from '../src/ai/memory';

const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();

describe('agent long-term memory', () => {
  it('recalls the memories that match the situation, plus the latest reflection', () => {
    const m = new AgentMemory();
    m.add('a', { time: at(0), kind: 'work', day: 1, project: 'Energy Study', task: 'Collect energy data', summary: 'Peak demand at 19:00 near the market.' });
    for (let i = 1; i <= 8; i++) m.add('a', { time: at(i), kind: 'talk', day: 2, summary: `A visitor asked about the weather, chat ${i}.` });
    m.add('a', { time: at(20), kind: 'reflection', day: 2, summary: 'Helped at the bakery and met Juno.' });
    m.add('a', { time: at(21), kind: 'talk', day: 3, summary: 'A visitor asked where to eat.' });
    const got = m.recall('a', 'Energy demand forecast for the market', 3);
    expect(got.length).toBe(3);
    expect(got.some((x) => x.task === 'Collect energy data')).toBe(true);
    expect(got.some((x) => x.kind === 'reflection')).toBe(true);
    // oldest first, ready for a prompt
    expect(got.map((x) => x.time)).toEqual([...got.map((x) => x.time)].sort());
    expect(formatMemory(got[0])).toMatch(/^- \[work, day 1\] Energy Study: Collect energy data/);
  });

  it('forgets the oldest memory of a kind past its limit, keeping other kinds', () => {
    const m = new AgentMemory();
    m.add('a', { time: at(0), kind: 'work', summary: 'first work' });
    for (let i = 0; i < MEMORY_LIMITS.talk + 5; i++) m.add('a', { time: at(i + 1), kind: 'talk', summary: `talk ${i}` });
    const all = m.all('a');
    expect(all.filter((x) => x.kind === 'talk').length).toBe(MEMORY_LIMITS.talk);
    expect(all.find((x) => x.kind === 'talk')!.summary).toBe('talk 5');
    expect(all.some((x) => x.summary === 'first work')).toBe(true);
  });

  it('writes one reflection per agent from that day’s real deeds, once per day', () => {
    const sim = CitySimulation.create({ population: 160 });
    sim.run(2 * 86400);
    const m = new AgentMemory();
    const day = dayOf(sim.time) - 1;
    const n = m.reflect(sim, day);
    expect(n).toBeGreaterThan(0);
    expect(m.reflect(sim, day)).toBe(0);
    const withDeeds = new Set(sim.life.deeds.filter((d) => dayOf(d.time) === day && d.kind !== 'arrived').map((d) => d.citizenId));
    for (const id of withDeeds) {
      if (!sim.citizenById(id)?.profile.agent) continue;
      const r = m.all(id).find((x) => x.kind === 'reflection')!;
      expect(r.day).toBe(day);
      const own = sim.life.deeds.filter((d) => d.citizenId === id && dayOf(d.time) === day && d.kind !== 'arrived');
      expect(r.summary).toContain(own[own.length - 1].text);
    }
  });

  it('persists to the data folder and loads back', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'morphis-mem-'));
    const m = new AgentMemory(dir);
    m.add('x', { time: at(0), kind: 'talk', day: 4, summary: 'Said hello.' });
    await m.flush();
    expect(JSON.parse(readFileSync(path.join(dir, 'agent-memory.json'), 'utf8')).x[0].summary).toBe('Said hello.');
    const again = new AgentMemory(dir);
    await again.load();
    expect(again.all('x')[0].day).toBe(4);
  });
});
