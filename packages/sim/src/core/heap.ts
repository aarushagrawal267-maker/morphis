/** Binary min-heap keyed by number, used by A* and the agent scheduler. */
export class MinHeap<T> {
  private keys: number[] = [];
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T, key: number): void {
    this.keys.push(key);
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  peekKey(): number {
    return this.keys.length ? this.keys[0] : Infinity;
  }

  pop(): T | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0];
    const lastItem = this.items.pop() as T;
    const lastKey = this.keys.pop() as number;
    if (n > 1) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      const len = n - 1;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < len && this.keys[l] < this.keys[m]) m = l;
        if (r < len && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  clear(): void {
    this.keys.length = 0;
    this.items.length = 0;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }
}
