/**
 * SimClient: the browser-side mirror of the authority.
 *
 * - Static world and profiles arrive once (init).
 * - Motion frames (~20 Hz) are buffered and interpolated with a small render
 *   delay, so movement is smooth regardless of simulation tick rate.
 * - Positions are reconstructed from (route, distance s) pairs: entities follow
 *   their exact sidewalk / lane polyline, never cutting corners.
 * - Low-frequency state and discrete events feed the React UI store.
 */
import type { AuthorityMessage, InitPayload, MotionFrame, RouteData, SimCommand, SimEvent } from '@morphis/shared';
import { samplePolyline } from '@morphis/sim';
import { useSim } from '../state/simStore';
import type { ConnectionStatus, Transport } from './transport';

const RENDER_DELAY = 110; // ms

interface BufferedFrame {
  at: number;
  frame: MotionFrame;
  cRoute: Int32Array;
  cS: Float32Array;
  vRoute: Int32Array;
  vS: Float32Array;
  vSpeed: Float32Array;
}

export interface MotionSample {
  time: number;
  cVisible: Uint8Array;
  cX: Float32Array;
  cZ: Float32Array;
  cDX: Float32Array;
  cDZ: Float32Array;
  vVisible: Uint8Array;
  vX: Float32Array;
  vZ: Float32Array;
  vDX: Float32Array;
  vDZ: Float32Array;
  vSpeed: Float32Array;
  signals: number[];
}

export class SimClient {
  transport: Transport | null = null;
  init: InitPayload | null = null;
  routes = new Map<number, RouteData>();
  private frames: BufferedFrame[] = [];
  private sample: MotionSample | null = null;
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private eventListeners = new Set<(events: SimEvent[]) => void>();
  lastStateAt = 0;
  eventsReceived = 0;

  connect(t: Transport): void {
    this.transport?.close();
    this.transport = t;
    useSim.getState().setConnection(t.kind, 'connecting');
    t.start(
      (m) => this.onMessage(m),
      (s: ConnectionStatus) => useSim.getState().setConnection(t.kind, s),
    );
  }

  command(cmd: SimCommand): Promise<unknown> {
    if (!this.transport) return Promise.reject(new Error('not connected'));
    return this.transport.send(cmd);
  }

  onEvents(fn: (events: SimEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private onMessage(m: AuthorityMessage): void {
    switch (m.t) {
      case 'init':
        this.applyInit(m.payload);
        break;
      case 'frame':
        this.pushFrame(m.frame);
        break;
      case 'state':
        this.lastStateAt = performance.now();
        useSim.getState().applyState(m.state);
        break;
      case 'events':
        this.applyEvents(m.events);
        break;
      case 'approvals':
        useSim.setState({ approvals: m.approvals });
        break;
    }
  }

  private applyInit(p: InitPayload): void {
    this.init = p;
    this.routes.clear();
    this.frames = [];
    for (const r of p.routes) this.routes.set(r.route.id, r.route);
    const nc = p.citizens.length;
    const nv = Math.max(p.vehicles.length, 256);
    this.sample = {
      time: p.state.clock.time,
      cVisible: new Uint8Array(nc),
      cX: new Float32Array(nc),
      cZ: new Float32Array(nc),
      cDX: new Float32Array(nc),
      cDZ: new Float32Array(nc),
      vVisible: new Uint8Array(nv),
      vX: new Float32Array(nv),
      vZ: new Float32Array(nv),
      vDX: new Float32Array(nv),
      vDZ: new Float32Array(nv),
      vSpeed: new Float32Array(nv),
      signals: [],
    };
    useSim.getState().applyInit(p);
  }

  private applyEvents(events: SimEvent[]): void {
    this.eventsReceived += events.length;
    for (const e of events) {
      if (e.type === 'citizen.moved') this.routes.set(e.payload.route.id, e.payload.route);
      else if (e.type === 'vehicle.moved') this.routes.set(e.payload.route.id, e.payload.route);
      else if (e.type === 'citizen.created' || e.type === 'building.created') {
        /* handled through state */
      }
    }
    useSim.getState().applyEvents(events);
    for (const l of this.eventListeners) l(events);
  }

  private pushFrame(frame: MotionFrame): void {
    const init = this.init;
    if (!init) return;
    const nc = init.citizens.length;
    const nv = this.sample!.vVisible.length;
    const bf: BufferedFrame = {
      at: performance.now(),
      frame,
      cRoute: new Int32Array(nc).fill(-1),
      cS: new Float32Array(nc),
      vRoute: new Int32Array(nv).fill(-1),
      vS: new Float32Array(nv),
      vSpeed: new Float32Array(nv),
    };
    const c = frame.citizens;
    for (let i = 0; i < c.length; i += 3) {
      bf.cRoute[c[i]] = c[i + 1];
      bf.cS[c[i]] = c[i + 2];
    }
    const v = frame.vehicles;
    for (let i = 0; i < v.length; i += 4) {
      if (v[i] >= nv) continue;
      bf.vRoute[v[i]] = v[i + 1];
      bf.vS[v[i]] = v[i + 2];
      bf.vSpeed[v[i]] = v[i + 3];
    }
    this.frames.push(bf);
    if (this.frames.length > 6) this.frames.shift();
    // forget routes nobody uses any more
    if (frame.tick % 200 === 0) {
      const used = new Set<number>();
      for (const f of this.frames) {
        for (const r of f.cRoute) if (r >= 0) used.add(r);
        for (const r of f.vRoute) if (r >= 0) used.add(r);
      }
      for (const id of this.routes.keys()) if (!used.has(id)) this.routes.delete(id);
    }
  }

  /** Interpolated positions of all moving entities for the current render time. */
  sampleMotion(now = performance.now()): MotionSample | null {
    const s = this.sample;
    if (!s || this.frames.length === 0) return s;
    const rt = now - RENDER_DELAY;
    let f0 = this.frames[0];
    let f1 = this.frames[this.frames.length - 1];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].at <= rt) {
        f0 = this.frames[i];
        f1 = this.frames[Math.min(i + 1, this.frames.length - 1)];
        break;
      }
    }
    const span = f1.at - f0.at;
    const t = span > 0 ? Math.min(1, Math.max(0, (rt - f0.at) / span)) : 1;
    s.time = f0.frame.time + (f1.frame.time - f0.frame.time) * t;
    s.signals = f1.frame.signals;
    const tmp = this.tmp;

    s.cVisible.fill(0);
    for (let i = 0; i < f1.cRoute.length; i++) {
      const r1 = f1.cRoute[i];
      if (r1 < 0) continue;
      const route = this.routes.get(r1);
      if (!route) continue;
      let sv = f1.cS[i];
      if (f0.cRoute[i] === r1) sv = f0.cS[i] + (f1.cS[i] - f0.cS[i]) * t;
      samplePolyline(route.points, route.cum, sv, tmp);
      s.cVisible[i] = 1;
      s.cX[i] = tmp.x;
      s.cZ[i] = tmp.z;
      s.cDX[i] = tmp.dx;
      s.cDZ[i] = tmp.dz;
    }

    s.vVisible.fill(0);
    for (let i = 0; i < f1.vRoute.length; i++) {
      const r1 = f1.vRoute[i];
      if (r1 < 0) continue;
      const route = this.routes.get(r1);
      if (!route) continue;
      let sv = f1.vS[i];
      // bus loops restart at s=0: only interpolate forward motion on the same route
      if (f0.vRoute[i] === r1 && f1.vS[i] >= f0.vS[i]) sv = f0.vS[i] + (f1.vS[i] - f0.vS[i]) * t;
      samplePolyline(route.points, route.cum, sv, tmp);
      s.vVisible[i] = 1;
      s.vX[i] = tmp.x;
      s.vZ[i] = tmp.z;
      s.vDX[i] = tmp.dx;
      s.vDZ[i] = tmp.dz;
      s.vSpeed[i] = f1.vSpeed[i];
    }
    return s;
  }

  /** Interpolated simulation time (seconds) for the renderer. */
  renderTime(): number {
    return this.sample?.time ?? useSim.getState().state?.clock.time ?? 0;
  }
}

export const simClient = new SimClient();
