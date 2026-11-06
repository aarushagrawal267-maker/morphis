/**
 * Conversations with citizens. `talkFacts` gathers what a person actually
 * knows right now (what they are doing, where they are going, their plan,
 * their recent deeds, what is open around them). `simulatedReply` turns those
 * facts into an answer without any AI. When a model is connected, the server
 * gives it the same facts so it can answer in the person's own voice.
 */
import type { BuildingDef } from '@morphis/shared';
import { AMBITION_LABEL, BUILDING_TYPES, VENTURE_KINDS, displayName, firstName, formatClock, hourOf, isOpenAt } from '@morphis/shared';
import type { CitizenRT } from '../state';
import type { CitySimulation } from '../engine';

export type TalkTopic = 'upto' | 'where' | 'chat';

export interface PlaceFact {
  name: string;
  kind: string;
  street: string | null;
  metres: number;
  /** Opened by an agent (with how many helpers). */
  venture?: { founder: string; helpers: number; kind: string };
}

export interface TalkFacts {
  name: string;
  firstName: string;
  age: number;
  occupation: string;
  calling: string | null;
  ambition: string | null;
  why: string | null;
  workforce: boolean;
  time: string;
  weather: string;
  doing: string;
  plan: string | null;
  task: string | null;
  mood: string;
  home: string;
  work: string | null;
  recentDeeds: string[];
  friends: string[];
  nearby: PlaceFact[];
  event: string | null;
}

const DOING: Record<string, string> = {
  work: 'Working',
  study: 'In class',
  eat: 'Having something to eat',
  shop: 'Doing some shopping',
  leisure: 'Out for the evening',
  park: 'Taking a walk in the park',
  event: 'At a city event',
  meeting: 'In a meeting',
  build: 'Helping with a fit-out',
  home: 'At home',
  sleep: 'Trying to sleep',
};

function nameOf(sim: CitySimulation, b: BuildingDef): string {
  return displayName(sim.economy.byBuilding(b.id)?.name ?? b.name);
}

/** Where a citizen is right now (street position for walkers). */
export function citizenXZ(sim: CitySimulation, c: CitizenRT): { x: number; z: number } {
  if (c.walker) {
    const { points, cum } = c.walker.route;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < c.walker.s) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (c.walker.s - cum[i]) / seg));
    return { x: points[i * 2] + (points[i * 2 + 2] - points[i * 2]) * t, z: points[i * 2 + 1] + (points[i * 2 + 3] - points[i * 2 + 1]) * t };
  }
  const loc = c.dyn.location;
  if (loc.kind === 'building') return sim.building(loc.id).position;
  if (loc.kind === 'stop') return sim.world.busStops.find((s) => s.id === loc.id)?.position ?? sim.building(c.profile.homeId).position;
  if (loc.kind === 'rail') {
    const st = sim.world.rail?.stations.find((s) => s.id === loc.id);
    if (st) return st.access;
  }
  const dest = c.dyn.destinationId ? sim.building(c.dyn.destinationId) : sim.building(c.profile.homeId);
  return dest.position;
}

function streetNear(sim: CitySimulation, x: number, z: number): string | null {
  const w = sim.world;
  let best: string | null = null;
  let bd = 14;
  for (const e of w.roads.edges) {
    const a = w.roads.nodes[e.a];
    const b = w.roads.nodes[e.b];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
    const d = Math.hypot(x - a.x - abx * t, z - a.z - abz * t);
    if (d < bd) {
      bd = d;
      best = e.name;
    }
  }
  return best;
}

export function talkFacts(sim: CitySimulation, c: CitizenRT): TalkFacts {
  const p = c.profile;
  const d = c.dyn;
  const life = sim.life.life(p.id);
  const dest = d.destinationId ? sim.building(d.destinationId) : null;
  const here = d.location.kind === 'building' ? sim.building(d.location.id) : null;
  let doing: string;
  if (d.status === 'WALKING' || d.status === 'TRAVELING') {
    const how = d.travelMode === 'rail' ? 'Taking the Skyrail' : d.travelMode === 'bus' ? 'Catching the bus' : d.travelMode === 'taxi' ? 'In a taxi' : d.travelMode === 'car' ? 'Driving' : 'Walking';
    doing = dest ? `${how} to ${nameOf(sim, dest)}${dest.id === p.homeId ? ' (home)' : ''}` : `${how} across town`;
  } else if (d.location.kind === 'stop') doing = `Waiting for the bus${dest ? ` to ${nameOf(sim, dest)}` : ''}`;
  else if (d.location.kind === 'rail') doing = `Waiting for the Skyrail${dest ? ` to ${nameOf(sim, dest)}` : ''}`;
  else {
    const base = DOING[d.activity] ?? 'Busy';
    const where = here && here.id !== p.homeId ? ` at ${nameOf(sim, here)}` : here && !/home|sleep/i.test(base) ? ' at home' : '';
    doing = `${base}${where}`;
  }
  const task = d.currentTaskId ? sim.workforce.task(d.currentTaskId) : undefined;
  const mood = d.energy < 0.2 ? 'exhausted' : d.satiety < 0.25 ? 'hungry' : d.happiness > 0.75 ? 'cheerful' : d.happiness < 0.4 ? 'a bit down' : 'calm';

  // what is open around them
  const pos = citizenXZ(sim, c);
  const hour = hourOf(sim.time);
  const ventures = new Map(sim.life.ventures.filter((v) => v.status === 'OPEN').map((v) => [v.buildingId, v]));
  const nearby: PlaceFact[] = sim.world.buildings
    .filter((b) => ['cafe', 'restaurant', 'shop', 'entertainment', 'park'].includes(b.type) && isOpenAt(b.type, hour))
    .filter((b) => b.type === 'park' || sim.state.buildings[b.index].dyn.status === 'ACTIVE')
    .map((b) => {
      const dist = Math.hypot(b.position.x - pos.x, b.position.z - pos.z);
      const v = ventures.get(b.id);
      // agents' ventures and named places are worth a slightly longer walk
      return { b, dist, v, score: dist - (v ? 40 : 0) - (b.named ? 10 : 0) };
    })
    .filter((x) => x.dist < 110)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map(({ b, dist, v }) => {
      const founder = v ? sim.citizenById(v.founderId) : undefined;
      return {
        name: nameOf(sim, b),
        kind: b.type === 'park' ? 'park' : BUILDING_TYPES[b.type].label.toLowerCase(),
        street: streetNear(sim, b.entrance.x, b.entrance.z),
        metres: Math.round((dist * 2) / 10) * 10,
        ...(v ? { venture: { founder: founder?.profile.name ?? 'an agent', helpers: v.helpers.length, kind: VENTURE_KINDS[v.kind].label.toLowerCase() } } : {}),
      };
    });
  const live = sim.state.cityEvents.find((e) => e.status === 'LIVE');
  const liveB = live ? sim.building(live.buildingId) : null;
  return {
    name: p.name,
    firstName: firstName(p.name),
    age: p.age,
    occupation: p.occupation,
    calling: p.agent?.calling ?? null,
    ambition: p.agent ? AMBITION_LABEL[p.agent.ambition] : null,
    why: p.agent?.why ?? null,
    workforce: !!p.agent?.workforce,
    time: formatClock(sim.time),
    weather: sim.state.weather.kind,
    doing,
    plan: life?.plan && life.plan !== 'Settling in.' ? life.plan : null,
    task: task ? `${task.title} (${Math.round(task.progress * 100)}% done)` : null,
    mood,
    home: nameOf(sim, sim.building(p.homeId)),
    work: p.workplaceId ? nameOf(sim, sim.building(p.workplaceId)) : null,
    recentDeeds: sim.life.deedsOf(p.id, 5).map((x) => x.text),
    friends: sim.life.friendsOf(p.id).map((id) => sim.citizenById(id)?.profile.name ?? '').filter(Boolean),
    nearby,
    event: live && liveB && Math.hypot(liveB.position.x - pos.x, liveB.position.z - pos.z) < 120 ? `${live.name} is on now at ${displayName(liveB.name)} (${live.attendees} people there)` : null,
  };
}

/** An answer built only from the facts (used when no AI model is connected). */
export function simulatedReply(f: TalkFacts, topic: TalkTopic): string {
  if (topic === 'upto') {
    let line = `${f.doing}.`;
    if (f.task) line += ` JARVIS has me on ${f.task}.`;
    if (f.plan) line += ` ${f.plan}`;
    if (f.mood === 'exhausted') line += " I'm exhausted.";
    else if (f.mood === 'hungry') line += " And I'm starving.";
    return line;
  }
  if (topic === 'where') {
    if (f.event) return `${f.event}.`;
    const top = f.nearby[0];
    if (!top) return 'Nothing I would recommend close by right now. Take the Skyrail somewhere livelier.';
    const at = `${top.name}${top.street ? ` on ${top.street}` : ''}, about ${top.metres} m from here.`;
    if (top.venture) return `${at} ${top.venture.founder.split(' ')[0]} opened it${top.venture.helpers ? ` with help from ${top.venture.helpers} other agents` : ''}. Good ${top.venture.kind}.`;
    const kind = top.kind === 'park' ? 'a nice park' : `${/^[aeiou]/.test(top.kind) ? 'an' : 'a'} ${top.kind}`;
    return `${at} It's ${kind} and it's open now.`;
  }
  return `I'm ${f.firstName}. ${f.doing}. Ask me what I'm up to, or where's good around here. (No AI model is connected, so that's all I can answer.)`;
}

/** Simulation-side handling of `guest.talk`. */
export function talk(sim: CitySimulation, citizenId: string, topic: TalkTopic): { reply: string; by: 'sim'; facts: TalkFacts } | null {
  const c = sim.citizenById(citizenId);
  if (!c) return null;
  const facts = talkFacts(sim, c);
  return { reply: simulatedReply(facts, topic), by: 'sim', facts };
}
