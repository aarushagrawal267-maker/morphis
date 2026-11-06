/** Other visitors walking the town (server mode). Renderer-side only. */
import { create } from 'zustand';
import type { GuestPresence } from '@morphis/shared';

export interface Visitor extends GuestPresence {
  /** Smoothed render position. */
  rx: number;
  rz: number;
  ry: number;
  ryaw: number;
  seen: number;
}

export const visitors = new Map<string, Visitor>();
export const usePresence = create<{ count: number; names: string[] }>(() => ({ count: 0, names: [] }));

export function receivePresence(list: GuestPresence[], selfId: string | null): void {
  const now = performance.now();
  const ids = new Set<string>();
  for (const g of list) {
    if (g.id === selfId) continue;
    ids.add(g.id);
    const v = visitors.get(g.id);
    if (v) Object.assign(v, g, { seen: now });
    else visitors.set(g.id, { ...g, rx: g.x, rz: g.z, ry: g.y, ryaw: g.yaw, seen: now });
  }
  for (const id of [...visitors.keys()]) if (!ids.has(id)) visitors.delete(id);
  const names = [...visitors.values()].map((v) => v.name);
  const cur = usePresence.getState();
  if (cur.count !== names.length || cur.names.join() !== names.join()) usePresence.setState({ count: names.length, names });
}
