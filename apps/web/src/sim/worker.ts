/// <reference lib="webworker" />
/**
 * LOCAL MODE authority: runs the full CitySimulation inside a Web Worker and
 * speaks exactly the same protocol as the Node server. Persistence uses the
 * browser's IndexedDB (clearly reported as "browser" persistence).
 */
import type { AuthorityMessage, SaveSummary, SimCommand } from '@morphis/shared';
import { commandSchema } from '@morphis/shared';
import { CitySimulation, SimulationRunner, type SaveData } from '@morphis/sim';

declare const self: DedicatedWorkerGlobalScope;

let sim: CitySimulation | null = null;
let runner: SimulationRunner | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let last = performance.now();
let frameCounter = 0;
const sessionId = `local-${Math.random().toString(36).slice(2, 10)}`;

const post = (m: AuthorityMessage): void => self.postMessage(m);

const PERSISTENCE = { backend: 'browser' as const, detail: 'Saved in this browser (IndexedDB). Run the server for PostgreSQL persistence.' };
const AI = { connected: false, provider: null, detail: 'Local mode: simulated workforce only. AI agents run on the server.' };

function start(next: CitySimulation): void {
  sim = next;
  runner = new SimulationRunner(sim, 24);
  sim.bus.drain();
  post({ t: 'init', payload: sim.buildInit('local', sessionId, PERSISTENCE, AI) });
  last = performance.now();
  if (loop) clearInterval(loop);
  loop = setInterval(step, 50);
}

function step(): void {
  if (!sim || !runner) return;
  const now = performance.now();
  runner.advance((now - last) / 1000);
  last = now;
  frameCounter++;
  const events = sim.bus.drain();
  if (events.length) post({ t: 'events', events });
  post({ t: 'frame', frame: sim.buildMotionFrame() });
  if (frameCounter % 10 === 0) post({ t: 'state', state: sim.buildStateFrame(frameCounter % 100 === 0) });
}

// ------------------------------------------------------------------ IndexedDB saves

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('morphis', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('saves', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('saves', mode);
    const req = fn(t.objectStore('saves'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredSave {
  id: string;
  summary: SaveSummary;
  data: SaveData;
}

async function handle(cmd: SimCommand): Promise<unknown> {
  if (!sim) throw new Error('simulation not started');
  switch (cmd.type) {
    case 'city.save': {
      const name = cmd.name ?? `Morphis ${new Date().toLocaleString()}`;
      const data = sim.serialize(name);
      const id = `save_${Date.now().toString(36)}`;
      const summary: SaveSummary = { id, name, seed: sim.world.seed, simTime: sim.time, savedAt: data.savedAt, population: sim.state.citizens.length, backend: 'browser' };
      await tx('readwrite', (s) => s.put({ id, summary, data } satisfies StoredSave));
      return summary;
    }
    case 'city.list': {
      const all = (await tx('readonly', (s) => s.getAll())) as StoredSave[];
      return all.map((x) => x.summary).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    }
    case 'city.load': {
      const rec = (await tx('readonly', (s) => s.get(cmd.id))) as StoredSave | undefined;
      if (!rec) throw new Error('save not found');
      start(CitySimulation.fromSave(rec.data));
      return rec.summary;
    }
    case 'city.delete':
      await tx('readwrite', (s) => s.delete(cmd.id));
      return true;
    case 'city.new':
      start(CitySimulation.create({ seed: cmd.seed, population: cmd.population ?? sim.world.config.population }));
      return { seed: cmd.seed };
    default: {
      const r = sim.command(cmd);
      if (!r.ok) throw new Error(r.error ?? 'command failed');
      return r.data ?? true;
    }
  }
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { t: 'start'; seed?: number; population?: number; hour?: number } | { t: 'command'; id: number; cmd: unknown };
  if (msg.t === 'start') {
    const created = CitySimulation.create({ seed: msg.seed, population: msg.population });
    if (msg.hour !== undefined && msg.hour >= 0 && msg.hour < 24) {
      // fast-forward to the requested starting hour (the city lives through those hours)
      const now = (created.time % 86400) / 3600;
      const ahead = (msg.hour - now + 24) % 24;
      if (ahead > 0.05) created.command({ type: 'sim.skip', hours: ahead });
    }
    start(created);
    return;
  }
  if (msg.t === 'command') {
    const parsed = commandSchema.safeParse(msg.cmd);
    if (!parsed.success) {
      post({ t: 'reply', id: msg.id, ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    try {
      const data = await handle(parsed.data);
      post({ t: 'reply', id: msg.id, ok: true, data });
      if (sim) {
        const events = sim.bus.drain();
        if (events.length) post({ t: 'events', events });
        post({ t: 'state', state: sim.buildStateFrame(true) });
      }
    } catch (e) {
      post({ t: 'reply', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
};
