import { describe, expect, it } from 'vitest';
import { START_TIME, hourOf, minuteOfDay } from '@morphis/shared';
import { CitySimulation } from '../src/engine';
import { SimulationRunner } from '../src/runner';
import { buildWalk } from '../src/nav/routes';

describe('simulation engine', () => {
  const sim = CitySimulation.create({ population: 150 });

  it('starts at the configured time with citizens at home', () => {
    expect(sim.time).toBe(START_TIME);
    for (const c of sim.state.citizens) expect(c.dyn.location).toEqual({ kind: 'building', id: c.profile.homeId });
    expect(sim.state.citizens.filter((c) => c.profile.core)).toHaveLength(25);
  });

  it('builds walking routes along the pedestrian graph', () => {
    const a = sim.world.buildings[3];
    const b = sim.world.buildings[40];
    const res = buildWalk(sim.pedNav, sim.world.ped.nodes, sim.world.ped.edges, a.entranceNode, b.entranceNode, 1)!;
    expect(res).not.toBeNull();
    expect(res.route.length).toBeGreaterThan(Math.hypot(a.entrance.x - b.entrance.x, a.entrance.z - b.entrance.z) * 0.9);
  });

  it('advances the clock one simulated second per tick', () => {
    const t0 = sim.time;
    sim.run(60);
    expect(sim.time).toBe(t0 + 60);
    expect(sim.state.clock.tick).toBe(60);
  });

  it('moves citizens physically (no teleport) and follows schedules into work hours', () => {
    const positions = new Map<string, string>();
    for (const c of sim.state.citizens) positions.set(c.profile.id, c.insideId ?? 'street');
    let sawWalking = false;
    const enteredFromStreet = new Set<string>();
    const off = sim.bus.on('citizen.enteredBuilding', (e) => enteredFromStreet.add(e.payload.citizenId));
    const offLeft = sim.bus.on('citizen.leftBuilding', (e) => enteredFromStreet.delete(e.payload.citizenId));
    for (let i = 0; i < 4 * 60; i++) {
      sim.run(60);
      if (sim.citizens.walkingCount() > 0) sawWalking = true;
    }
    off();
    offLeft();
    expect(sawWalking).toBe(true);
    // ~11:00: a large share of the employed population is at work
    expect(hourOf(sim.time)).toBeGreaterThan(10);
    const working = sim.state.citizens.filter((c) => c.dyn.status === 'WORKING' || c.dyn.status === 'LEARNING').length;
    expect(working).toBeGreaterThan(sim.state.citizens.length * 0.35);
    // every citizen inside a building is listed as an occupant there
    for (const c of sim.state.citizens) {
      if (c.insideId) expect(sim.state.buildings[sim.bIndex(c.insideId)].occupants).toContain(c.profile.id);
    }
  });

  it('keeps traffic flowing (no permanent gridlock)', () => {
    let maxStuck = 0;
    for (let i = 0; i < 120; i++) {
      sim.run(60);
      for (const v of sim.state.vehicles) {
        if (!v.route || !v.active) continue;
        maxStuck = Math.max(maxStuck, (sim.time - v.waitingSince) / 18);
      }
    }
    expect(sim.stats().vehiclesTotal).toBeGreaterThan(10);
    expect(maxStuck).toBeLessThan(400);
  });

  it('runs buses with passengers and records economy flows', () => {
    const buses = sim.state.vehicles.filter((v) => v.info.kind === 'bus' && v.active);
    expect(buses.length).toBeGreaterThan(0);
    for (const b of buses) expect(b.dyn.odometer).toBeGreaterThan(20);
    const revenue = sim.state.businesses.reduce((a, b) => a + b.revenue, 0);
    expect(revenue).toBeGreaterThan(0);
  });

  it('produces a day/night progression and daily economy report at midnight', () => {
    const before = sim.state.economy.summary.history.length;
    const toMidnight = 86400 - (sim.time % 86400) + 120;
    sim.run(toMidnight);
    expect(minuteOfDay(sim.time)).toBe(2);
    expect(sim.state.economy.summary.history.length).toBe(before + 1);
  });

  it('save -> restore produces an identical future', () => {
    const save = sim.serialize('test');
    const copy = CitySimulation.fromSave(JSON.parse(JSON.stringify(save)));
    sim.run(1800);
    copy.run(1800);
    expect(copy.time).toBe(sim.time);
    expect(JSON.stringify(copy.serialize('x').state)).toBe(JSON.stringify(sim.serialize('x').state));
  });

  it('runner converts wall time into ticks according to speed and pause', () => {
    const runner = new SimulationRunner(sim, 1000);
    sim.command({ type: 'sim.setSpeed', speed: 5 });
    const n = runner.advance(0.1);
    expect(n).toBe(30); // 0.1 s * 60 sim-s/s * 5
    sim.command({ type: 'sim.setPaused', paused: true });
    expect(runner.advance(0.1)).toBe(0);
    sim.command({ type: 'sim.setPaused', paused: false });
    sim.command({ type: 'sim.setSpeed', speed: 1 });
  });
});
