/**
 * Walk-in interface: the guest bar (rise, wave, postcard, journal, chatter,
 * look), the "where am I" line, door and Skyrail prompts, a touch stick, and
 * chatter bubbles over the people nearby.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { displayName, formatClock } from '@morphis/shared';
import { cameraBridge } from '../../scene/cameraBridge';
import { sound } from '../../audio/engine';
import { collidersFor } from '../../scene/guest/collision';
import { enterDoor, guestWave, takePostcard } from '../../scene/guest/actions';
import { leaveInterior } from '../../scene/guest/InteriorGuest';
import { citizenPosition } from '../../scene/positions';
import { simClient } from '../../sim/client';
import { arrival, guestInput, guestPose, useGuest } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon } from '../ui/icons';
import { chatterFor } from './chatter';

/** Leave the overview and walk in at a sidewalk spot (default: outside JARVIS HQ). */
export function startWalk(at?: { x: number; z: number; yaw?: number }): void {
  const sim = useSim.getState();
  const world = sim.world;
  if (!world) return;
  let x = at?.x;
  let z = at?.z;
  let yaw = at?.yaw ?? 0;
  if (x === undefined || z === undefined) {
    const hq = sim.buildingsById.get(world.hqId)!;
    x = (hq.entrance.x + hq.access.point.x) / 2;
    z = (hq.entrance.z + hq.access.point.z) / 2;
    // stand on the plaza facing along the street, so the camera behind looks down the road, not into the HQ
    const out = Math.atan2(hq.access.point.x - hq.entrance.x, hq.access.point.z - hq.entrance.z);
    yaw = out + Math.PI / 2;
  }
  const ui = useUI.getState();
  ui.select(null);
  ui.setFollow(null);
  if (ui.interior) ui.exitInterior();
  useJournal.getState().startDay(world.landmarks.map((id) => ({ id, name: displayNameOf(id) })));
  useGuest.getState().enter(x, z, yaw);
}

/**
 * Drop in at a clicked spot of the island: the character appears there (nudged
 * out of any building), facing away from the camera, and the camera flies down.
 */
export function dropIn(x: number, z: number): boolean {
  const world = useSim.getState().world;
  if (!world || useGuest.getState().active || useUI.getState().interior) return false;
  const col = collidersFor(world);
  if (!col.onIsland(x, z)) return false;
  const p = { x, z };
  col.resolve(p, 0.6);
  const cam = cameraBridge.camera;
  const yaw = cam ? Math.atan2(p.x - cam.position.x, p.z - cam.position.z) : 0;
  startWalk({ x: p.x, z: p.z, yaw });
  arrival.at = performance.now();
  sound.whoosh();
  return true;
}

function displayNameOf(id: string): string {
  const b = useSim.getState().buildingsById.get(id);
  return b ? displayName(b.name) : id;
}

export function rise(): void {
  useGuest.getState().exit();
  useUI.getState().requestCamera({ kind: 'overview' }, 'overview');
}

/** In the island view: tell visitors they can drop in anywhere. */
export function DropHint() {
  const active = useGuest((s) => s.active);
  const interior = useUI((s) => s.interior);
  const selection = useUI((s) => s.selection);
  const panel = useUI((s) => s.panel);
  if (active || interior || selection || panel) return null;
  return (
    <div className="drop-hint glass" data-testid="drop-hint">
      <Icon name="walk" /> Click anywhere on the island to walk in there
    </div>
  );
}

export function GuestHud() {
  const active = useGuest((s) => s.active);
  const interior = useUI((s) => s.interior);
  if (!active) return null;
  if (interior) return <InsideBar buildingId={interior.buildingId} />;
  return (
    <>
      <GuestBar />
      <GuestPrompt />
      <TouchStick />
      <Chatter />
    </>
  );
}

/** While walking inside a building: where you are, who is here, and the way out. */
function InsideBar({ buildingId }: { buildingId: string }) {
  const b = useSim((s) => s.buildingsById.get(buildingId));
  const biz = useSim((s) => s.businessByBuilding.get(buildingId));
  const here = useSim((s) => (b ? (s.state?.occupancy[b.index] ?? 0) : 0));
  if (!b) return null;
  return (
    <>
      <section className="guest-bar glass" data-testid="inside-bar">
        <div className="guest-bar__top">
          <button className="chip" onClick={leaveInterior} data-testid="btn-out" title="Walk back out to the street (Esc)">
            <Icon name="exit" /> OUT
          </button>
          <div className="guest-bar__where">
            <strong>{displayName(biz?.name ?? b.name)}</strong>
            <small>
              {here} {here === 1 ? 'person' : 'people'} here · walk to the door to leave
            </small>
          </div>
        </div>
        <div className="guest-bar__actions">
          <button className="icon-btn" title="Wave (Q)" onClick={guestWave}>
            <Icon name="hand" />
          </button>
          <button className="icon-btn" title="Take a postcard (P)" onClick={takePostcard}>
            <Icon name="camera" />
          </button>
        </div>
      </section>
      <TouchStick />
    </>
  );
}

function GuestBar() {
  const place = useGuest((s) => s.place);
  const chatter = useGuest((s) => s.chatter);
  const panel = useUI((s) => s.panel);
  const goals = useJournal((s) => s.goals);
  const time = useSim((s) => s.state?.clock.time ?? 0);
  const done = goals.filter((g) => g.progress >= g.target).length;
  const ui = useUI.getState();
  const nextChatter = chatter === 'off' ? 'mini' : chatter === 'mini' ? 'full' : 'off';
  return (
    <section className="guest-bar glass" data-testid="guest-bar">
      <div className="guest-bar__top">
        <button className="chip" onClick={rise} data-testid="btn-rise" title="Leave the street and return to the overview">
          <Icon name="rise" /> RISE
        </button>
        <div className="guest-bar__where">
          <strong data-testid="guest-street">{place?.street ?? '…'}</strong>
          {place?.landmark && (
            <small>
              {place.landmarkDist} m to {place.landmark}
            </small>
          )}
        </div>
        <span className="guest-bar__clock">{formatClock(time)}</span>
      </div>
      <div className="guest-bar__actions">
        <button className="icon-btn" title="Wave (Q)" onClick={guestWave} data-testid="btn-wave">
          <Icon name="hand" />
        </button>
        <button className="icon-btn" title="Take a postcard (P)" onClick={takePostcard} data-testid="btn-postcard">
          <Icon name="camera" />
        </button>
        <button className={`chip ${panel === 'journal' ? 'on' : ''}`} title="Journal: today's goals, places, badges, postcards" onClick={() => ui.togglePanel('journal')} data-testid="btn-journal">
          <Icon name="book" /> {done}/{goals.length || 3}
        </button>
        <button className="chip" title="People's chatter bubbles" onClick={() => useGuest.getState().setChatter(nextChatter)} data-testid="btn-chatter">
          <Icon name="chat" /> {chatter.toUpperCase()}
        </button>
        <button className={`icon-btn ${panel === 'look' ? 'on' : ''}`} title="Your look" onClick={() => ui.togglePanel('look')} data-testid="btn-look">
          <Icon name="shirt" />
        </button>
      </div>
    </section>
  );
}

function GuestPrompt() {
  const door = useGuest((s) => s.door);
  const station = useGuest((s) => s.station);
  const ride = useGuest((s) => s.ride);
  const rail = useSim((s) => s.world?.rail);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);
  if (ride && rail) {
    const to = rail.stations.find((s) => s.id === ride.toId);
    return (
      <div className="guest-prompt glass" data-testid="ride-status">
        <Icon name="train" /> {ride.phase === 'waiting' ? `Waiting on the platform for the next Skyrail train to ${to?.name}` : `Riding the Skyrail to ${to?.name}`}
        {ride.phase === 'waiting' && <small>Walk away to leave the platform</small>}
      </div>
    );
  }
  if (station && rail) {
    const here = rail.stations.find((s) => s.id === station)!;
    return (
      <div className="guest-prompt glass" data-testid="station-prompt">
        <div>
          <Icon name="train" /> <b>{here.name}</b> · take the Skyrail to
        </div>
        <div className="guest-prompt__stops">
          {rail.stations
            .filter((s) => s.id !== station)
            .map((s) => (
              <button key={s.id} className="chip" onClick={() => useGuest.getState().setRide({ phase: 'waiting', fromId: station, toId: s.id, train: -1 })}>
                {s.name}
              </button>
            ))}
        </div>
      </div>
    );
  }
  if (door) {
    return (
      <button className="guest-prompt glass" onClick={enterDoor} data-testid="door-prompt">
        <Icon name="door" /> <kbd>E</kbd> Enter {door.name}
      </button>
    );
  }
  if (!hint) return null;
  if (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
    return <div className="guest-prompt guest-prompt--hint glass">Stick to walk · drag to look · tap the street to walk there</div>;
  }
  return (
    <div className="guest-prompt guest-prompt--hint glass">
      <kbd>W</kbd>
      <kbd>A</kbd>
      <kbd>S</kbd>
      <kbd>D</kbd> or click to walk · drag to look · <kbd>Shift</kbd> run · <kbd>Q</kbd> wave · <kbd>P</kbd> postcard · <kbd>E</kbd> enter
    </div>
  );
}

function TouchStick() {
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  const knob = useRef<HTMLDivElement>(null);
  if (!coarse) return null;
  const R = 46;
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    guestInput.stickX = dx / R;
    guestInput.stickY = -dy / R;
    guestPose.path = [];
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const reset = () => {
    guestInput.stickX = 0;
    guestInput.stickY = 0;
    if (knob.current) knob.current.style.transform = '';
  };
  return (
    <div
      className="touch-stick"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => e.buttons && set(e)}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div ref={knob} className="touch-stick__knob" />
    </div>
  );
}

/** Speech bubbles over the nearest people, positioned every frame. */
function Chatter() {
  const mode = useGuest((s) => s.chatter);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === 'off') return;
    const MAX = 7;
    const els: HTMLDivElement[] = [];
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'chatter';
      layer.current?.appendChild(el);
      els.push(el);
    }
    const v = new THREE.Vector3();
    let raf = 0;
    let lastPick = 0;
    let chosen: number[] = [];
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = cameraBridge.camera;
      const sim = useSim.getState();
      if (!cam || !sim.state) return;
      const now = performance.now();
      const sample = simClient.sampleMotion();
      if (now - lastPick > 700) {
        lastPick = now;
        const cand: { i: number; d: number }[] = [];
        for (let i = 0; i < sim.citizens.length; i++) {
          const visible = sample?.cVisible[i] || isOutdoorsStill(sim.state.citizens[i]?.location, sim);
          if (!visible) continue;
          const p = citizenPosition(i);
          if (!p) continue;
          const d = Math.hypot(p.x - guestPose.x, p.z - guestPose.z);
          if (d < 24 && Math.abs(p.y - guestPose.y) < 5) cand.push({ i, d });
        }
        cand.sort((a, b) => a.d - b.d);
        chosen = cand.slice(0, MAX).map((c) => c.i);
      }
      const ctx = {
        time: sim.state.clock.time,
        weather: sim.state.weather.kind,
        events: sim.cityEvents,
        ventures: sim.ventures,
        busyProjects: sim.projects.filter((p) => p.status === 'ACTIVE').length,
      };
      els.forEach((el, k) => {
        const i = chosen[k];
        const p = i !== undefined ? citizenPosition(i) : null;
        if (i === undefined || !p) {
          el.style.display = 'none';
          return;
        }
        v.set(p.x, p.y + 2.1, p.z).project(cam);
        if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) {
          el.style.display = 'none';
          return;
        }
        const prof = sim.citizens[i];
        const full = chatterFor(prof, sim.state!.citizens[i], sim.life.get(prof.id), ctx);
        const text = mode === 'mini' && full.length > 20 ? `${full.slice(0, 18).trimEnd()}…` : full;
        if (el.textContent !== text) el.textContent = text;
        el.classList.toggle('chatter--agent', !!prof.agent);
        el.title = `${prof.name}: ${full}`;
        el.style.display = 'block';
        el.style.transform = `translate(-50%, -100%) translate(${(((v.x + 1) / 2) * cameraBridge.width).toFixed(1)}px, ${(((1 - v.y) / 2) * cameraBridge.height).toFixed(1)}px)`;
      });
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((e) => e.remove());
    };
  }, [mode]);
  return <div ref={layer} className="chatter-layer" data-testid="chatter-layer" />;
}

function isOutdoorsStill(loc: { kind: string; id?: string } | undefined, sim: ReturnType<typeof useSim.getState>): boolean {
  if (!loc) return false;
  if (loc.kind === 'stop') return true;
  if (loc.kind === 'rail') return !!loc.id?.startsWith('rail_st');
  if (loc.kind === 'building') {
    const b = sim.buildingsById.get(loc.id!);
    return !!b && (b.type === 'park' || b.type === 'plaza');
  }
  return false;
}
