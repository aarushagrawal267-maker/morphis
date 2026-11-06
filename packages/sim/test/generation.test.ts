import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES, DISTRICT_TEMPLATES } from '@morphis/shared';
import { defaultConfig, generateWorld } from '../src/gen/world';
import { PedNav, RoadNav } from '../src/nav/graphs';

const gen = generateWorld(defaultConfig());
const w = gen.world;

describe('city generation', () => {
  it('is deterministic for a seed', () => {
    const again = generateWorld(defaultConfig());
    expect(again.world.hash).toBe(w.hash);
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(w));
  });

  it('changes with the seed', () => {
    const other = generateWorld(defaultConfig({ seed: 77 }));
    expect(other.world.hash).not.toBe(w.hash);
  });

  it('creates all 14 districts and the landmarks', () => {
    expect(w.districts).toHaveLength(DISTRICT_TEMPLATES.length);
    for (const key of ['hq', 'ai_lab', 'university', 'orbital', 'corporate', 'bank', 'hospital', 'studio']) {
      expect(gen.landmarks[key], key).toBeTruthy();
    }
    const hq = w.buildings.find((b) => b.id === w.hqId)!;
    expect(hq.type).toBe('hq');
    expect(hq.height).toBeGreaterThan(Math.max(...w.buildings.filter((b) => b.type !== 'hq').map((b) => b.height)));
  });

  it('places a dense set of varied buildings with stable ids', () => {
    expect(w.buildings.length).toBeGreaterThan(150);
    const types = new Set(w.buildings.map((b) => b.type));
    expect(types.size).toBeGreaterThan(15);
    w.buildings.forEach((b, i) => expect(b.id).toBe(`building_${String(i).padStart(5, '0')}`));
    const homes = w.buildings.filter((b) => BUILDING_TYPES[b.type].category === 'residential');
    expect(homes.reduce((a, b) => a + b.capacity, 0)).toBeGreaterThan(w.config.population);
  });

  it('has a connected road graph with signals and gates', () => {
    const nav = new RoadNav(w.roads.nodes, w.roads.edges);
    const start = w.roads.nodes[0].id;
    for (const n of w.roads.nodes) expect(nav.route(start, n.id), `node ${n.id}`).not.toBeNull();
    expect(w.roads.nodes.filter((n) => n.signal).length).toBeGreaterThan(20);
    expect(w.roads.nodes.filter((n) => n.gate)).toHaveLength(4);
  });

  it('connects every building entrance to the pedestrian network', () => {
    const nav = new PedNav(w.ped.nodes, w.ped.edges);
    const comp = nav.components();
    const hq = w.buildings.find((b) => b.id === w.hqId)!;
    for (const b of w.buildings) {
      expect(b.entranceNode, b.name).toBeGreaterThanOrEqual(0);
      expect(comp[b.entranceNode], b.name).toBe(comp[hq.entranceNode]);
    }
  });

  it('serves bus lines with stops on the pedestrian network', () => {
    expect(w.busLines.length).toBeGreaterThanOrEqual(2);
    for (const s of w.busStops) expect(s.pedNode).toBeGreaterThanOrEqual(0);
  });
});

describe('config', () => {
  it('ignores undefined overrides', () => {
    expect(defaultConfig({ population: undefined, seed: undefined }).population).toBe(400);
  });
});
