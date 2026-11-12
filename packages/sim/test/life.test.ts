import { describe, expect, it } from 'vitest';
import type { LifeDecision } from '@morphis/shared';
import { AGENCY_AGENTS, agencyAgent } from '@morphis/shared';
import { CitySimulation } from '../src/engine';

describe('agent lives', () => {
  it('creates 50 agents plus the resident Agency specialists, each with a persona and an arrival deed', () => {
    const sim = CitySimulation.create({});
    const agents = sim.life.agents();
    const residents = AGENCY_AGENTS.filter((a) => a.resident).length;
    expect(residents).toBeGreaterThan(60);
    expect(agents.length).toBe(50 + residents);
    expect(agents.filter((a) => a.profile.agent!.workforce).length).toBe(25);
    const specialists = agents.filter((a) => a.profile.agent!.agency);
    expect(specialists.length).toBe(residents);
    for (const s of specialists) {
      const meta = agencyAgent(s.profile.agent!.agency)!;
      expect(meta.resident).toBe(true);
      expect(s.profile.agent!.calling).toBe(meta.name);
      expect(s.profile.workplaceId).not.toBeNull();
    }
    const slugs = new Set(agents.map((a) => a.profile.agent!.slug));
    expect(slugs.size).toBe(agents.length);
    for (const a of agents) expect(a.profile.agent!.why.length).toBeGreaterThan(10);
    expect(sim.state.deeds!.filter((d) => d.kind === 'arrived').length).toBe(agents.length);
  });

  it('saves made before the specialists arrived get them once on load', () => {
    const a = CitySimulation.create({});
    const save = JSON.parse(JSON.stringify(a.serialize('pre-agency')));
    const gone = new Set<string>();
    for (const c of save.state.citizens) {
      if (c.profile.agent?.agency) {
        gone.add(c.profile.id);
        delete c.profile.agent;
      }
    }
    save.state.life = save.state.life.filter((l: { citizenId: string }) => !gone.has(l.citizenId));
    const b = CitySimulation.fromSave(save);
    expect(b.life.agents().filter((c) => c.profile.agent!.agency).length).toBe(AGENCY_AGENTS.filter((x) => x.resident).length);
    const again = CitySimulation.fromSave(JSON.parse(JSON.stringify(b.serialize('again'))));
    expect(again.life.agents().length).toBe(b.life.agents().length);
  });

  it('agents decide in the evening; ventures open only after real fit-out hours', () => {
    const sim = CitySimulation.create({});
    sim.run(3 * 86400);
    const deeds = sim.state.deeds!;
    expect(deeds.some((d) => d.kind === 'founded')).toBe(true);
    for (const life of sim.state.life!) expect(life.lastDecisionDay).toBeGreaterThanOrEqual(2);
    const v = sim.state.ventures![0];
    expect(v).toBeDefined();
    if (v.status === 'OPEN') {
      expect(v.progress).toBe(v.work);
      expect(deeds.some((d) => d.kind === 'opened' && d.text.includes(v.name))).toBe(true);
    } else {
      expect(v.progress).toBeLessThan(v.work);
    }
    // all simulated decisions are labelled as such
    expect(deeds.every((d) => d.by === 'sim')).toBe(true);
  });

  it('a life mind can make the decision; invalid choices fall back to the simulation', () => {
    const sim = CitySimulation.create({ population: 200 });
    const pending: LifeDecision[] = [];
    sim.life.mind = { request: (d) => (pending.push(d), true) };
    sim.run(13 * 3600 + 2 * 3600); // to ~21:40 on day 1
    expect(pending.length).toBeGreaterThan(5);
    const first = pending[0];
    const rest = first.options.find((o) => o.kind === 'rest')!;
    expect(sim.life.resolve(first.id, rest.id, 'I want a quiet day.', 'Coffee and a long walk.').ok).toBe(true);
    const life = sim.life.life(first.citizenId)!;
    expect(life.plan).toBe('Coffee and a long walk.');
    expect(life.planBy).toBe('ai');
    // unknown option -> simulation decides, decision consumed
    const second = pending[1];
    expect(sim.life.resolve(second.id, 'nope', null, null).ok).toBe(false);
    expect(sim.life.life(second.citizenId)!.pending).toBeNull();
    // unanswered decisions are decided by the simulation after the deadline
    sim.run(4 * 3600);
    expect(sim.state.decisions!.length).toBe(0);
  });

  it('save -> restore keeps agent lives and stays deterministic', () => {
    const a = CitySimulation.create({ population: 160 });
    a.run(86400 + 3600);
    const b = CitySimulation.fromSave(JSON.parse(JSON.stringify(a.serialize('t'))));
    a.run(20000);
    b.run(20000);
    expect(JSON.stringify(b.state.deeds)).toBe(JSON.stringify(a.state.deeds));
    expect(JSON.stringify(b.state.ventures)).toBe(JSON.stringify(a.state.ventures));
  });

  it('older saves without agent lives get agents on load', () => {
    const a = CitySimulation.create({ population: 160 });
    const save = JSON.parse(JSON.stringify(a.serialize('old')));
    delete save.state.life;
    delete save.state.deeds;
    delete save.state.ventures;
    delete save.state.decisions;
    delete save.state.trains;
    for (const c of save.state.citizens) delete c.profile.agent;
    const b = CitySimulation.fromSave(save);
    expect(b.life.agents().filter((c) => !c.profile.agent!.agency).length).toBe(Math.min(50, b.state.citizens.length));
    expect(b.life.agents().some((c) => c.profile.agent!.agency)).toBe(true);
    expect(b.state.trains!.length).toBeGreaterThan(0);
  });
});

describe('skyrail and waving', () => {
  it('trains circle the loop, stop at stations and carry riders', () => {
    const sim = CitySimulation.create({});
    const line = sim.world.rail!;
    expect(line.stations.length).toBeGreaterThanOrEqual(3);
    let riders = 0;
    const s0 = sim.state.trains![0].s;
    let moved = false;
    for (let h = 0; h < 12; h++) {
      sim.run(3600);
      riders += sim.state.trains!.reduce((a, t) => a + t.passengers.length, 0);
      if (sim.state.trains![0].s !== s0) moved = true;
    }
    expect(moved).toBe(true);
    expect(riders).toBeGreaterThan(0);
    expect(sim.state.economy.summary.transitRidersToday).toBeGreaterThan(0);
  });

  it('walkers near a guest stop and wave back; far ones do not', () => {
    const sim = CitySimulation.create({});
    sim.run(3600 * 1.5);
    const walker = sim.state.citizens.find((c) => c.walker && c.walker.onCrosswalk < 0 && c.walker.s > 1)!;
    expect(walker).toBeDefined();
    const w = walker.walker!;
    // position on its route
    let i = 0;
    while (i < w.route.cum.length - 2 && w.route.cum[i + 1] < w.s) i++;
    const x = w.route.points[i * 2];
    const z = w.route.points[i * 2 + 1];
    const far = sim.state.citizens.find((c) => c.walker && c !== walker && Math.hypot(c.walker.route.points[0] - x, c.walker.route.points[1] - z) > 200);
    const r = sim.command({ type: 'guest.wave', x, z, citizens: [walker.profile.id, ...(far ? [far.profile.id] : [])] });
    expect(r.ok).toBe(true);
    const waved = (r.data as { waved: string[] }).waved;
    expect(waved).toContain(walker.profile.id);
    if (far) expect(waved).not.toContain(far.profile.id);
    const s = w.s;
    sim.run(60);
    expect(walker.walker?.s ?? s).toBe(s); // paused while waving
    expect(sim.bus.drain().some((e) => e.type === 'citizen.waved')).toBe(true);
  });
});

describe('agent friendships', () => {
  it('agents who spend time together meet and become friends, saved with the city', () => {
    const sim = CitySimulation.create({});
    sim.run(4 * 86400);
    const deeds = sim.state.deeds!;
    const met = deeds.filter((d) => d.kind === 'met');
    const friends = deeds.filter((d) => d.kind === 'friends');
    expect(met.length).toBeGreaterThan(0);
    expect(friends.length).toBeGreaterThan(0);
    const f = friends[0];
    const other = f.others![0];
    expect(sim.life.friendsOf(f.citizenId)).toContain(other);
    expect(sim.life.friendsOf(other)).toContain(f.citizenId);
    const restored = CitySimulation.fromSave(JSON.parse(JSON.stringify(sim.serialize('f'))));
    expect(restored.life.friendsOf(f.citizenId)).toContain(other);
  });
});
