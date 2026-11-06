/** Guest actions shared by the HUD buttons and keyboard shortcuts. */
import { create } from 'zustand';
import { simClient } from '../../sim/client';
import { useGuest, guestPose } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { enterBuilding } from '../../components/panels/actions';
import { citizenPosition } from '../positions';

export const WAVE_RADIUS = 14;

/** Wave at everyone nearby. The simulation decides who actually waves back. */
export function guestWave(): void {
  const now = performance.now();
  if (guestPose.waveUntil > now) return;
  guestPose.waveUntil = now + 2200;
  const sim = useSim.getState();
  const inside = useUI.getState().interior?.buildingId;
  if (inside) {
    // inside a building: everyone in it can see you
    const b = sim.buildingsById.get(inside);
    const ids = sim.citizens.filter((p, i) => { const loc = sim.state?.citizens[i]?.location; return loc?.kind === 'building' && loc.id === inside; }).map((p) => p.id);
    useJournal.getState().waved();
    if (!b || !ids.length) return;
    void simClient
      .command({ type: 'guest.wave', x: b.entrance.x, z: b.entrance.z, citizens: ids.slice(0, 30), buildingId: inside })
      .then((data) => reportWaves((data as { waved?: string[] } | undefined)?.waved ?? []))
      .catch(() => undefined);
    return;
  }
  const sample = simClient.sampleMotion();
  const near: { id: string; d: number }[] = [];
  const n = sim.citizens.length;
  for (let i = 0; i < n; i++) {
    let x: number;
    let z: number;
    let y = 0;
    if (sample?.cVisible[i]) {
      x = sample.cX[i];
      z = sample.cZ[i];
    } else {
      const loc = sim.state?.citizens[i]?.location;
      if (!loc || loc.kind === 'vehicle' || loc.kind === 'street') continue;
      if (loc.kind === 'rail' && loc.id.startsWith('train_')) continue;
      if (loc.kind === 'building') {
        const b = sim.buildingsById.get(loc.id);
        if (!b || (b.type !== 'park' && b.type !== 'plaza')) continue;
      }
      const p = citizenPosition(i);
      if (!p) continue;
      x = p.x;
      z = p.z;
      y = p.y;
    }
    if (Math.abs(y - guestPose.y) > 4) continue;
    const d = Math.hypot(x - guestPose.x, z - guestPose.z);
    if (d < WAVE_RADIUS) near.push({ id: sim.citizens[i].id, d });
  }
  near.sort((a, b) => a.d - b.d);
  useJournal.getState().waved();
  if (!near.length) return;
  void simClient
    .command({ type: 'guest.wave', x: Math.round(guestPose.x * 100) / 100, z: Math.round(guestPose.z * 100) / 100, citizens: near.slice(0, 30).map((x) => x.id) })
    .then((data) => reportWaves((data as { waved?: string[] } | undefined)?.waved ?? []))
    .catch(() => undefined);
}

function reportWaves(waved: string[]): void {
  if (!waved.length) return;
  const s = useSim.getState();
  useJournal.getState().meet(waved, (id) => !!s.citizensById.get(id)?.agent);
  const agents = waved.map((id) => s.citizensById.get(id)).filter((p) => p?.agent);
  useUI.getState().notify(agents.length ? `${agents.map((p) => p!.name.split(' ')[0]).slice(0, 3).join(', ')}${agents.length > 3 ? ` and ${agents.length - 3} more` : ''} waved back` : `${waved.length} ${waved.length === 1 ? 'person' : 'people'} waved back`);
}

/** Request a postcard of the current view (PostcardCapture mounts for one frame). */
export const usePostcard = create<{ pending: boolean }>(() => ({ pending: false }));

export function takePostcard(): void {
  usePostcard.setState({ pending: true });
}

export function enterDoor(): void {
  const door = useGuest.getState().door;
  if (!door) return;
  useJournal.getState().enter(door.id);
  enterBuilding(door.id);
}
