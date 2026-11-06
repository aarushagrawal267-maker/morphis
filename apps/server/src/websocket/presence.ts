/**
 * Visitor presence: each walking visitor sends their position a few times a
 * second; the server relays everyone's position to everyone at 5 Hz. Nothing
 * here touches the simulation.
 */
import type { Server, Socket } from 'socket.io';
import type { GuestPresence } from '@morphis/shared';
import { SOCKET_EVENTS, guestPoseSchema } from '@morphis/shared';

const STALE_MS = 6000;
const MAX_VISITORS = 200;

export class Presence {
  private guests = new Map<string, GuestPresence & { seen: number }>();
  private lastMsg = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private io: Server) {
    this.timer = setInterval(() => this.broadcast(), 200);
  }

  attach(socket: Socket): void {
    socket.on(SOCKET_EVENTS.guestPose, (raw: unknown) => {
      const now = Date.now();
      // at most ~12 updates a second per visitor
      if (now - (this.lastMsg.get(socket.id) ?? 0) < 80) return;
      this.lastMsg.set(socket.id, now);
      const p = guestPoseSchema.safeParse(raw);
      if (!p.success) return;
      if (!this.guests.has(socket.id) && this.guests.size >= MAX_VISITORS) return;
      this.guests.set(socket.id, { id: socket.id.slice(0, 12), ...p.data, seen: now });
    });
    const leave = () => {
      this.guests.delete(socket.id);
      this.lastMsg.delete(socket.id);
    };
    socket.on(SOCKET_EVENTS.guestLeave, leave);
    socket.on('disconnect', leave);
  }

  get count(): number {
    return this.guests.size;
  }

  private broadcast(): void {
    const now = Date.now();
    for (const [k, g] of this.guests) if (now - g.seen > STALE_MS) this.guests.delete(k);
    if (!this.guests.size) return;
    const list: GuestPresence[] = [...this.guests.values()].map(({ seen: _seen, ...g }) => g);
    this.io.volatile.emit(SOCKET_EVENTS.guests, list);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
