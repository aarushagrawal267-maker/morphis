/**
 * Talking to people: Wave, "What are you up to?" and "Where's good around
 * here?". Every answer is built from that person's real simulated day (what
 * they are doing, where they are going, their plan) and from the city around
 * them (what is open nearby right now).
 */
import { useState } from 'react';
import type { CitizenProfile } from '@morphis/shared';
import { BUILDING_TYPES, VENTURE_KINDS, displayName, firstName, isOpenAt, hourOf } from '@morphis/shared';
import { WAVE_RADIUS } from '../../scene/guest/actions';
import { citizenPosition } from '../../scene/positions';
import { simClient } from '../../sim/client';
import { guestPose, useGuest } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon } from '../ui/icons';

type Line = { who: 'you' | 'them'; text: string };

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

function streetNear(x: number, z: number): string | null {
  const w = useSim.getState().world;
  if (!w) return null;
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

/** "What are you up to?" from the citizen's live state and plan. */
export function upTo(p: CitizenProfile): string {
  const sim = useSim.getState();
  const d = sim.state?.citizens[p.index];
  if (!d) return "Just getting on with my day.";
  const life = sim.life.get(p.id);
  const dest = d.destinationId ? sim.buildingsById.get(d.destinationId) : null;
  const here = d.location.kind === 'building' ? sim.buildingsById.get(d.location.id) : null;
  const destName = dest ? displayName(sim.businessByBuilding.get(dest.id)?.name ?? dest.name) : null;
  const hereName = here ? displayName(sim.businessByBuilding.get(here.id)?.name ?? here.name) : null;
  let line: string;
  if (d.status === 'WALKING' || d.status === 'TRAVELING') {
    const how = d.travelMode === 'rail' ? 'Taking the Skyrail' : d.travelMode === 'bus' ? 'Catching the bus' : d.travelMode === 'taxi' ? 'In a taxi' : d.travelMode === 'car' ? 'Driving' : 'Walking';
    line = destName ? `${how} to ${destName}${dest?.id === p.homeId ? ', home' : ''}.` : `${how} across town.`;
  } else if (d.location.kind === 'stop') line = `Waiting for the bus${destName ? ` to ${destName}` : ''}.`;
  else if (d.location.kind === 'rail') line = `Waiting for the next Skyrail train${destName ? ` to ${destName}` : ''}.`;
  else line = `${DOING[d.activity] ?? 'Busy'}${hereName && here?.id !== p.homeId ? ` at ${hereName}` : ''}.`;
  if (d.currentTaskId) {
    const task = sim.tasks.get(d.currentTaskId);
    if (task) line += ` JARVIS has me on "${task.title}" (${Math.round(task.progress * 100)}% done).`;
  }
  if (life?.plan && life.plan !== 'Settling in.') line += ` ${life.plan}`;
  if (d.energy < 0.2) line += " I'm exhausted.";
  else if (d.satiety < 0.25) line += " And I'm starving.";
  return line;
}

/** "Where's good around here?": what is actually open near this person right now. */
export function recommend(p: CitizenProfile): string {
  const sim = useSim.getState();
  const world = sim.world;
  const pos = citizenPosition(p.index);
  if (!world || !pos) return "I'm not sure where we are, honestly.";
  const hour = hourOf(sim.state?.clock.time ?? 0);
  const ventures = new Map(sim.ventures.filter((v) => v.status === 'OPEN').map((v) => [v.buildingId, v]));
  const live = sim.cityEvents.find((e) => e.status === 'LIVE');
  if (live) {
    const b = sim.buildingsById.get(live.buildingId);
    if (b && Math.hypot(b.position.x - pos.x, b.position.z - pos.z) < 120) return `${live.name} is on right now at ${displayName(b.name)}. ${live.attendees} people are already there.`;
  }
  const cands = world.buildings
    .filter((b) => ['cafe', 'restaurant', 'shop', 'entertainment', 'park'].includes(b.type) && isOpenAt(b.type, hour))
    .filter((b) => (sim.buildingDyn[b.id]?.status ?? 'ACTIVE') === 'ACTIVE' || b.type === 'park')
    .map((b) => {
      const d = Math.hypot(b.position.x - pos.x, b.position.z - pos.z);
      const v = ventures.get(b.id);
      return { b, d, v, score: d - (v ? 40 : 0) - (b.named ? 10 : 0) };
    })
    .filter((x) => x.d < 110)
    .sort((a, b) => a.score - b.score);
  const top = cands[0];
  if (!top) return hour < 6 || hour >= 23 ? 'At this hour? Everything near here is closed. Try again in the morning.' : 'Nothing I would recommend close by. Take the Skyrail somewhere livelier.';
  const name = displayName(sim.businessByBuilding.get(top.b.id)?.name ?? top.b.name);
  const street = streetNear(top.b.entrance.x, top.b.entrance.z);
  const metres = Math.round(top.d * 2 / 10) * 10;
  if (top.v) {
    const founder = sim.citizensById.get(top.v.founderId);
    return `${name}${street ? ` on ${street}` : ''}, about ${metres} m from here. ${founder ? `${firstName(founder.name)} opened it` : 'An agent opened it'}${top.v.helpers.length ? ` with help from ${top.v.helpers.length} other agents` : ''}. Good ${VENTURE_KINDS[top.v.kind].label.toLowerCase()}.`;
  }
  const label = BUILDING_TYPES[top.b.type].label.toLowerCase();
  const kind = top.b.type === 'park' ? 'a nice park' : `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
  return `${name}${street ? ` on ${street}` : ''}, about ${metres} m from here. It's ${kind} and it's open now.`;
}

export function TalkBox({ p }: { p: CitizenProfile }) {
  const [lines, setLines] = useState<Line[]>([]);
  const walking = useGuest((s) => s.active);
  const say = (you: string, them: string) => setLines((l) => [...l.slice(-5), { who: 'you', text: you }, { who: 'them', text: them }]);
  const wave = () => {
    const pos = citizenPosition(p.index);
    const inside = useUI.getState().interior?.buildingId;
    const near = walking && pos && (inside || Math.hypot(pos.x - guestPose.x, pos.z - guestPose.z) < WAVE_RADIUS);
    if (!near) {
      say('(wave)', walking ? `${firstName(p.name)} is too far away to see you.` : 'Walk in and get closer to wave.');
      return;
    }
    guestPose.waveUntil = performance.now() + 2200;
    useJournal.getState().waved();
    void simClient
      .command({ type: 'guest.wave', x: inside ? pos.x : guestPose.x, z: inside ? pos.z : guestPose.z, citizens: [p.id], ...(inside ? { buildingId: inside } : {}) })
      .then((data) => {
        const waved = ((data as { waved?: string[] } | undefined)?.waved ?? []).includes(p.id);
        if (waved) useJournal.getState().meet([p.id], () => !!p.agent);
        say('(wave)', waved ? `Hi! I'm ${firstName(p.name)}. Nice to meet you.` : `${firstName(p.name)} didn't notice you.`);
      })
      .catch(() => say('(wave)', '…'));
  };
  return (
    <div className="talk" data-testid="talk">
      {lines.length > 0 && (
        <div className="talk__log">
          {lines.map((l, i) => (
            <p key={i} className={`talk__line talk__line--${l.who}`}>
              {l.text}
            </p>
          ))}
        </div>
      )}
      <div className="talk__actions">
        <button onClick={wave} data-testid="talk-wave">
          <Icon name="hand" size={13} /> Wave
        </button>
        <button onClick={() => say('What are you up to?', upTo(p))} data-testid="talk-upto">
          What are you up to?
        </button>
        <button onClick={() => say("Where's good around here?", recommend(p))} data-testid="talk-where">
          Where's good around here?
        </button>
      </div>
      <p className="note">Answers come from this person's simulated day and what is open around them right now.</p>
    </div>
  );
}
