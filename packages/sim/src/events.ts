import type { SimEvent, SimEventMap, SimEventType } from '@morphis/shared';

type Listener = (e: SimEvent) => void;

/** Typed event bus: systems emit, transports and other systems subscribe. */
export class EventBus {
  private listeners = new Set<Listener>();
  private typed = new Map<SimEventType, Set<Listener>>();
  private buffer: SimEvent[] = [];
  /** Total events emitted since start (debug overlay). */
  count = 0;

  emit<K extends SimEventType>(type: K, time: number, payload: SimEventMap[K]): void {
    const ev = { type, time, payload } as SimEvent;
    this.count++;
    this.buffer.push(ev);
    for (const l of this.listeners) l(ev);
    const t = this.typed.get(type);
    if (t) for (const l of t) l(ev);
  }

  on<K extends SimEventType>(type: K, fn: (e: Extract<SimEvent, { type: K }>) => void): () => void {
    let set = this.typed.get(type);
    if (!set) this.typed.set(type, (set = new Set()));
    set.add(fn as Listener);
    return () => set!.delete(fn as Listener);
  }

  onAny(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Events emitted since the last drain (forwarded to clients in batches). */
  drain(): SimEvent[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}
