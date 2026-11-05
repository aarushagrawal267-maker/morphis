/**
 * Deterministic, serialisable pseudo random generator (sfc32).
 * Every random decision in generation and simulation goes through an Rng so a
 * given seed (plus command history) always produces the same city.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | number[]) {
    if (Array.isArray(seed)) {
      [this.a, this.b, this.c, this.d] = seed as [number, number, number, number];
    } else {
      this.a = 0x9e3779b9;
      this.b = 0x243f6a88;
      this.c = 0xb7e15162;
      this.d = seed >>> 0;
      for (let i = 0; i < 15; i++) this.nextU32();
    }
  }

  static derive(seed: number, stream: string): Rng {
    let h = seed >>> 0;
    for (let i = 0; i < stream.length; i++) h = Math.imul(h ^ stream.charCodeAt(i), 0x01000193) >>> 0;
    return new Rng(h ^ 0x5bd1e995);
  }

  nextU32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return r >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.float() * (maxInclusive - min + 1));
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.float() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  /** Approximately normal (Irwin–Hall). */
  normal(mean = 0, sd = 1): number {
    return mean + sd * (this.float() + this.float() + this.float() + this.float() - 2) * 1.7320508;
  }
  getState(): number[] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

/** Stable hash (FNV-1a) used for world fingerprints and per-entity variation. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
