/**
 * Indexed binary min-heap of cells keyed by `key[cell]` (ties: lower cell first), with decrease-key, so
 * it never holds a cell twice.
 */
export class CellHeap {
  items: Int32Array;
  size = 0;

  constructor(
    private key: Float64Array | ((a: number, b: number) => boolean),
    /** Heap slot per cell, -1 when the cell is not queued. */
    private pos: Int32Array,
  ) {
    this.items = new Int32Array(1024);
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.pos[this.items[i]] = -1;
    this.size = 0;
  }

  private less(a: number, b: number): boolean {
    if (typeof this.key === 'function') return this.key(a, b);
    const ka = this.key[a];
    const kb = this.key[b];
    return ka < kb || (ka === kb && a < b);
  }

  /** Queue `cell`, or move it up after its key dropped. */
  update(cell: number): void {
    let i = this.pos[cell];
    if (i < 0) {
      if (this.size === this.items.length) {
        const items = new Int32Array(this.size * 2);
        items.set(this.items);
        this.items = items;
      }
      i = this.size++;
    }
    const { items, pos } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const up = items[p];
      if (!this.less(cell, up)) break;
      items[i] = up;
      pos[up] = i;
      i = p;
    }
    items[i] = cell;
    pos[cell] = i;
  }

  /** Removes and returns the cell with the smallest key. */
  pop(): number {
    const { items, pos } = this;
    const top = items[0];
    pos[top] = -1;
    const n = --this.size;
    if (n > 0) {
      const last = items[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.less(items[c + 1], items[c])) c++;
        if (!this.less(items[c], last)) break;
        items[i] = items[c];
        pos[items[c]] = i;
        i = c;
      }
      items[i] = last;
      pos[last] = i;
    }
    return top;
  }
}
