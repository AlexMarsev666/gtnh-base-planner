import type { Entry } from './types';

/** Ranking candidate hatch cells and faces. */

/** How good one open face of a candidate cell is for the kind being placed (see `Entry`). */
export type FaceScore = Pick<Entry, 'face' | 'walled' | 'open' | 'crowded' | 'aligned' | 'reach' | 'far'>;

/**
 * Negative when face `a` is the better one: one whose pipe keeps a way out (and leaves one to its
 * neighbours), then one facing open space, then the one with the fewest hatches of other kinds around,
 * then one in line with hatches of this kind already placed (one straight pipe serves them), then the one
 * more units could line up with, then the one nearest where the pipes go. Ties keep the earlier face.
 */
export function compareFaces(a: FaceScore, b: FaceScore): number {
  return (
    a.walled - b.walled ||
    a.open - b.open ||
    a.crowded - b.crowded ||
    b.aligned - a.aligned ||
    b.reach - a.reach ||
    a.far - b.far
  );
}

/** Negative when `a` is the better pick: higher score, then less waste, then a better face, then lower cell. */
export function compareEntries(a: Entry, b: Entry): number {
  return (
    (b.fixed ?? 0) - (a.fixed ?? 0) ||
    b.score - a.score ||
    a.waste - b.waste ||
    a.wanted - b.wanted ||
    a.walled - b.walled ||
    a.open - b.open ||
    a.crowded - b.crowded ||
    b.aligned - a.aligned ||
    b.reach - a.reach ||
    a.far - b.far ||
    a.faceRank - b.faceRank ||
    a.i - b.i
  );
}

/** Binary heap with the best entry (by `compareEntries`) on top. */
export class EntryHeap {
  private items: Entry[] = [];

  push(e: Entry): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareEntries(a[i], a[parent]) >= 0) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop(): Entry | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && compareEntries(a[l], a[m]) < 0) m = l;
        if (r < a.length && compareEntries(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
