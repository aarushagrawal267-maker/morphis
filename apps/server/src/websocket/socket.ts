/** Socket.IO gateway: sends the init payload on connect and routes validated commands. */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SOCKET_EVENTS, commandSchema } from '@morphis/shared';
import type { SimulationHost } from '../simulation/host';

export const LOCKED = 'This town is run by its host: changing it needs the admin key (Settings → Admin key). You can still walk, wave and talk.';

export function attachSockets(http: HttpServer, host: SimulationHost, corsOrigin: string): Server {
  const io = new Server(http, {
    cors: { origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()) },
    perMessageDeflate: { threshold: 2048 },
    maxHttpBufferSize: 1e6,
  });
  io.on('connection', (socket) => {
    const token = typeof socket.handshake.auth?.token === 'string' ? (socket.handshake.auth.token as string) : undefined;
    socket.emit(SOCKET_EVENTS.init, host.initPayload());
    socket.emit(SOCKET_EVENTS.access, { locked: host.locked, admin: host.isAdmin(token) });
    socket.on(SOCKET_EVENTS.command, async (raw: unknown, ack?: (r: unknown) => void) => {
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) {
        ack?.({ ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') });
        return;
      }
      if (!host.canRun(parsed.data, token)) {
        ack?.({ ok: false, error: LOCKED });
        return;
      }
      const reply = await host.command(parsed.data);
      ack?.(reply);
    });
  });
  host.io = io;
  return io;
}
