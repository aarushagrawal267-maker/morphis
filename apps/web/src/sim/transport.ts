/**
 * Transports to the simulation authority. Both deliver the same AuthorityMessage
 * stream and accept the same validated commands.
 */
import { io, type Socket } from 'socket.io-client';
import type { ApprovalRequest, AuthorityMessage, InitPayload, MotionFrame, SimCommand, SimEvent, StateFrame, AccessInfo } from '@morphis/shared';
import { SOCKET_EVENTS } from '@morphis/shared';

export interface Transport {
  readonly kind: 'local' | 'server';
  start(onMessage: (m: AuthorityMessage) => void, onStatus: (s: ConnectionStatus) => void): void;
  send(cmd: SimCommand): Promise<unknown>;
  close(): void;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export class WorkerTransport implements Transport {
  readonly kind = 'local' as const;
  private worker: Worker | null = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private opts: { seed?: number; population?: number; hour?: number } = {}) {}

  start(onMessage: (m: AuthorityMessage) => void, onStatus: (s: ConnectionStatus) => void): void {
    onStatus('connecting');
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<AuthorityMessage>) => {
      const m = ev.data;
      if (m.t === 'reply') {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          if (m.ok) p.resolve(m.data);
          else p.reject(new Error(m.error ?? 'command failed'));
        }
        return;
      }
      if (m.t === 'init') onStatus('connected');
      onMessage(m);
    };
    this.worker.onerror = (e) => {
      console.error('simulation worker error', e);
      onStatus('error');
    };
    this.worker.postMessage({ t: 'start', ...this.opts });
  }

  send(cmd: SimCommand): Promise<unknown> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ t: 'command', id, cmd });
    });
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export class SocketTransport implements Transport {
  readonly kind = 'server' as const;
  private socket: Socket | null = null;

  constructor(private url: string) {}

  start(onMessage: (m: AuthorityMessage) => void, onStatus: (s: ConnectionStatus) => void): void {
    onStatus('connecting');
    let token: string | undefined;
    try {
      token = localStorage.getItem('morphis.adminKey') ?? undefined;
    } catch {
      token = undefined;
    }
    const s = io(this.url, { transports: ['websocket'], reconnection: true, auth: token ? { token } : {} });
    this.socket = s;
    s.on('connect', () => onStatus('connected'));
    s.on('disconnect', () => onStatus('disconnected'));
    s.on('connect_error', () => onStatus('error'));
    s.on(SOCKET_EVENTS.init, (payload: InitPayload) => onMessage({ t: 'init', payload }));
    s.on(SOCKET_EVENTS.frame, (frame: MotionFrame) => onMessage({ t: 'frame', frame }));
    s.on(SOCKET_EVENTS.state, (state: StateFrame) => onMessage({ t: 'state', state }));
    s.on(SOCKET_EVENTS.events, (events: SimEvent[]) => onMessage({ t: 'events', events }));
    s.on(SOCKET_EVENTS.approvals, (approvals: ApprovalRequest[]) => onMessage({ t: 'approvals', approvals }));
    s.on(SOCKET_EVENTS.access, (access: AccessInfo) => onMessage({ t: 'access', access }));
  }

  send(cmd: SimCommand): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('not connected'));
      this.socket.timeout(120_000).emit(SOCKET_EVENTS.command, cmd, (err: Error | null, reply: { ok: boolean; data?: unknown; error?: string }) => {
        if (err) return reject(err);
        if (reply.ok) resolve(reply.data);
        else reject(new Error(reply.error ?? 'command failed'));
      });
    });
  }

  close(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

/** Candidate server URLs: ?server=…, VITE_SERVER_URL, same origin (dev proxy), then same host on port 8787. */
export function serverCandidates(): string[] {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return [q];
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return [env];
  return [location.origin, `${location.protocol}//${location.hostname}:8787`];
}

async function healthy(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json()) as { mode?: string };
    return body.mode === 'server';
  } catch {
    return false;
  }
}

/** Decide which authority to use. `?mode=local|server` forces a mode. */
export async function chooseTransport(): Promise<Transport> {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const population = Number(params.get('population')) || undefined;
  const seed = params.get('seed') ? Number(params.get('seed')) : undefined;
  const hour = params.get('hour') ? Number(params.get('hour')) : undefined;
  // Static builds (VITE_LOCAL_ONLY=1) have no server to talk to, so skip probing.
  if (mode === 'local' || import.meta.env.VITE_LOCAL_ONLY === '1') return new WorkerTransport({ population, seed, hour });
  const candidates = serverCandidates();
  for (const url of candidates) {
    if (await healthy(url)) return new SocketTransport(url);
  }
  if (mode === 'server') return new SocketTransport(candidates[0]);
  return new WorkerTransport({ population, seed, hour });
}
