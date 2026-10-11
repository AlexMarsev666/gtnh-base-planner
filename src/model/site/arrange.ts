import type { Rotation } from '../core/types';
import { AbortedError, throttledProgress, throwIfAborted } from './progress';
import type { SiteGroup, SiteState } from './types';

export { AbortedError };

/**
 * Auto-arrange: place groups on the site in flow order, west to east.
 *
 * 1. Group graph from the links (group → group). Back edges of cycles (recycling loops) are ignored.
 * 2. Layers by longest path: a group sits one column east of everything that feeds it.
 * 3. Within a column, groups are ordered by the barycenter of their neighbours (a few sweeps both ways),
 *    which keeps crossings down.
 * 4. Columns are stacked north to south with `corridor` free blocks between groups and around the
 *    edges; the west and east edges keep one more block for the boundary ports. A column that is too deep
 *    for the site is split into several columns. Groups of a column share their west edge and all columns
 *    share their north edge (the chain as a whole is centred), so the result reads as straight rows and
 *    columns; the pipes may be longer than they could be (Optimize shortens them).
 *
 * 5. With `floors`, a chain that is wider than the site does not widen it: the columns that no longer fit
 *    start a new floor, raised above the one below by its tallest group and a clearance for pipes. Floors
 *    run back and forth (the second one west, the third east again, ...), so the end of one floor lies next
 *    to the start of the next.
 *
 * `sizeOf` gives a group's local footprint [x, z] (before rotation). Pure and deterministic, and idempotent:
 * arranging an arranged site gives the same site (rotations are chosen from the footprints alone).
 */

export interface ArrangeResult {
  groups: SiteGroup[];
  /** Whether every group fits on the site. */
  fits: boolean;
  /** Smallest [width, depth] this arrangement needs. */
  needed: [number, number];
  /** Floors used (1 unless `floors` was asked for and the chain was too wide). */
  floors: number;
}

export interface ArrangeOptions {
  /** Build on several floors instead of widening the site; gives each group's height (blocks). */
  floors?: { heightOf: (id: string) => number };
  /** Called with (steps done, steps in all) as the arrangement proceeds (at most ~20 times a second). */
  onProgress?: (done: number, total: number) => void;
  /** Aborting throws `AbortedError`. */
  signal?: AbortSignal;
  /** Clock for the progress throttle. Default `performance.now`. */
  now?: () => number;
}

/** Stages reported by `arrangeSite`: cycles, layers, four sweeps, placement. */
const STEPS = 7;

/** Free blocks between one floor's tallest group and the next floor, for pipes to pass. */
export const FLOOR_CLEARANCE = 3;

export function arrangeSite(
  site: SiteState,
  sizeOf: (id: string) => [number, number] | undefined,
  opts: ArrangeOptions = {},
): ArrangeResult {
  const report = throttledProgress(opts.onProgress, opts.now ?? (() => performance.now()));
  let steps = 0;
  const step = () => {
    throwIfAborted(opts.signal);
    report?.(++steps, STEPS);
  };
  throwIfAborted(opts.signal);
  const ids = site.groups.map((g) => g.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const succ = ids.map(() => new Set<number>());
  for (const l of site.links) {
    if (!('group' in l.from) || !('group' in l.to)) continue;
    const a = index.get(l.from.group);
    const b = index.get(l.to.group);
    if (a !== undefined && b !== undefined && a !== b) succ[a].add(b);
  }

  // Break cycles (recycling loops) with the greedy ordering of Eades, Lin and Smyth: peel off sinks to the
  // right and sources to the left; when neither is left, move the most source-like group left. Links from
  // boundary ports count towards "source", links to them towards "sink", so a loop is cut where it returns
  // to the start of the chain, not at its start. Edges pointing backwards in that order are dropped.
  const portBias = ids.map(() => 0);
  for (const l of site.links) {
    const to = 'group' in l.to ? index.get(l.to.group) : undefined;
    const from = 'group' in l.from ? index.get(l.from.group) : undefined;
    if ('port' in l.from && to !== undefined) portBias[to]++;
    if ('port' in l.to && from !== undefined) portBias[from]--;
  }
  const pre = ids.map(() => new Set<number>());
  succ.forEach((ws, v) => ws.forEach((w) => pre[w].add(v)));
  const alive = new Set(ids.keys());
  const left: number[] = [];
  const right: number[] = [];
  const degree = (v: number, set: Set<number>[]) => [...set[v]].filter((w) => alive.has(w)).length;
  while (alive.size > 0) {
    for (let found = true; found;) {
      found = false;
      for (const v of [...alive].sort((a, b) => b - a))
        if (degree(v, succ) === 0) {
          right.unshift(v);
          alive.delete(v);
          found = true;
        }
    }
    for (let found = true; found;) {
      found = false;
      for (const v of [...alive].sort((a, b) => a - b))
        if (degree(v, pre) === 0) {
          left.push(v);
          alive.delete(v);
          found = true;
        }
    }
    if (alive.size === 0) break;
    let best = -1;
    let bestScore = -Infinity;
    for (const v of [...alive].sort((a, b) => a - b)) {
      const sc = degree(v, succ) - degree(v, pre) + portBias[v];
      if (sc > bestScore) {
        best = v;
        bestScore = sc;
      }
    }
    left.push(best);
    alive.delete(best);
  }
  step();
  const rank = new Map([...left, ...right].map((v, i) => [v, i]));
  const dag = ids.map((_, v) =>
    [...succ[v]].filter((w) => rank.get(w)! > rank.get(v)!).sort((a, b) => a - b),
  );
  const pred = ids.map(() => [] as number[]);
  dag.forEach((ws, v) => ws.forEach((w) => pred[w].push(v)));

  // Longest-path layers (topological order by repeated relaxation; the graph is small).
  const layer = new Array<number>(ids.length).fill(0);
  for (let changed = true, guard = 0; changed && guard <= ids.length; guard++) {
    changed = false;
    for (let v = 0; v < ids.length; v++)
      for (const w of dag[v])
        if (layer[w] < layer[v] + 1) {
          layer[w] = layer[v] + 1;
          changed = true;
        }
  }
  step();
  const columns: number[][] = [];
  layer.forEach((l, v) => (columns[l] ??= []).push(v));
  const cols = columns.filter((c) => c && c.length > 0);

  // Barycenter ordering.
  const position = new Map<number, number>();
  const place = () => cols.forEach((c) => c.forEach((v, i) => position.set(v, i)));
  place();
  const bary = (v: number, nbrs: number[]) =>
    nbrs.length ? nbrs.reduce((s, n) => s + (position.get(n) ?? 0), 0) / nbrs.length : (position.get(v) ?? 0);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down
      ? cols.map((_, i) => i).slice(1)
      : cols
          .map((_, i) => i)
          .reverse()
          .slice(1);
    for (const ci of order) {
      const c = cols[ci];
      const key = new Map(c.map((v) => [v, bary(v, down ? pred[v] : dag[v])]));
      c.sort((a, b) => key.get(a)! - key.get(b)! || a - b);
      c.forEach((v, i) => position.set(v, i));
    }
    step();
  }

  const [w, d] = site.size;
  const gap = site.corridor;
  // One block for the boundary ports, then the corridor.
  const edge = 1 + Math.max(1, gap);
  const depth = Math.max(1, d - 2 * Math.max(1, gap));
  const foot = (v: number, r: Rotation): [number, number] => {
    const s = sizeOf(ids[v]) ?? [3, 3];
    return r % 2 === 0 ? s : [s[1], s[0]];
  };

  /**
   * Rotations for a column: all narrow (min x), or all short (min z); the first that fits. Square footprints
   * stay unrotated. The groups' current rotations play no part, which keeps the arrangement idempotent.
   */
  const chooseRotations = (c: number[]): Rotation[] => {
    const options: Rotation[][] = [
      c.map((v) => (foot(v, 0)[0] <= foot(v, 1)[0] ? 0 : 1) as Rotation),
      c.map((v) => (foot(v, 0)[1] <= foot(v, 1)[1] ? 0 : 1) as Rotation),
    ];
    const total = (rs: Rotation[]) => c.reduce((s, v, i) => s + foot(v, rs[i])[1], 0) + gap * (c.length - 1);
    return options.find((rs) => total(rs) <= depth) ?? options[1];
  };

  const out = site.groups.map((g) => {
    const copy = { ...g };
    // A new arrangement starts on the ground.
    delete copy.elevation;
    return copy;
  });
  let x = edge;
  /** Where each group stands on its floor, for the floors' mirroring and heights. */
  const onFloor = new Map<number, { floor: number; x: number; fx: number }>();
  /** Offset of each group below the top of its column. */
  const below = new Map<number, number>();
  let floor = 0;
  let tallest = 0;
  for (const c of cols) {
    const rots = chooseRotations(c);
    // Split into sub-columns that fit the depth.
    const subs: { v: number; r: Rotation }[][] = [[]];
    let used = 0;
    c.forEach((v, i) => {
      const fz = foot(v, rots[i])[1];
      const cur = subs[subs.length - 1];
      if (cur.length > 0 && used + gap + fz > depth) {
        subs.push([]);
        used = 0;
      }
      subs[subs.length - 1].push({ v, r: rots[i] });
      used += (subs[subs.length - 1].length > 1 ? gap : 0) + fz;
    });
    for (const sub of subs) {
      const width = Math.max(...sub.map((e) => foot(e.v, e.r)[0]));
      const height = sub.reduce((s, e) => s + foot(e.v, e.r)[1], 0) + gap * (sub.length - 1);
      // Too wide for what is left of this floor: the next floor starts over from the west edge.
      if (opts.floors && x > edge && x + width + edge > w) {
        floor++;
        x = edge;
      }
      tallest = Math.max(tallest, height);
      let dz = 0;
      for (const e of sub) {
        const [fx, fz] = foot(e.v, e.r);
        out[e.v].rotation = e.r;
        // Groups of a column share their west edge.
        out[e.v].origin = [x, 0];
        onFloor.set(e.v, { floor, x, fx });
        below.set(e.v, dz);
        dz += fz + gap;
      }
      x += width + gap;
    }
  }
  step();
  // All columns share their north edge: centred in the depth when the tallest fits, else at the corridor.
  const side = Math.max(1, gap);
  const top = Math.max(side, Math.floor((d - tallest) / 2));
  for (const [v, dz] of below) out[v].origin = [out[v].origin[0], top + dz];
  let reach = 0;
  for (const p of onFloor.values()) reach = Math.max(reach, p.x + p.fx);
  const neededW = cols.length ? (opts.floors && floor > 0 ? reach + edge : x - gap + edge) : 0;
  const neededD = cols.length ? tallest + 2 * side : 0;
  if (opts.floors && floor > 0) {
    const { heightOf } = opts.floors;
    // Every second floor runs the other way: its x mirrored within the width of the widest floor.
    const span = reach - edge;
    const tops = new Map<number, number>();
    for (const [v, p] of onFloor) {
      tops.set(p.floor, Math.max(tops.get(p.floor) ?? 0, heightOf(ids[v])));
      if (p.floor % 2 === 1) out[v].origin = [2 * edge + span - p.x - p.fx, out[v].origin[1]];
    }
    const base: number[] = [0];
    for (let f = 1; f <= floor; f++) base[f] = base[f - 1] + (tops.get(f - 1) ?? 0) + FLOOR_CLEARANCE;
    for (const [v, p] of onFloor) if (base[p.floor] > 0) out[v].elevation = base[p.floor];
  }
  // Centre the chain along X when there is room, so the pipes to both edges' ports stay short.
  const shift = Math.max(0, Math.floor((w - neededW) / 2));
  if (shift > 0) for (const g of out) g.origin = [g.origin[0] + shift, g.origin[1]];
  return { groups: out, fits: neededW <= w && neededD <= d, needed: [neededW, neededD], floors: floor + 1 };
}

/**
 * The site size to grow to when the groups do not fit: at least the current size, at most `max` per side,
 * as square as possible (a deeper site splits the columns, which makes it narrower), then the smallest.
 * The depth also leaves room for the boundary ports along the west and east edges (one free block between
 * neighbours). When nothing fits, the result is the one that leaves the least outside.
 */
export function grownSize(
  site: SiteState,
  sizeOf: (id: string) => [number, number] | undefined,
  max: number,
): [number, number] {
  const [w0, d0] = site.size;
  const perEdge = (dir: 'in' | 'out') => site.ports.filter((p) => p.dir === dir && !p.pos).length;
  const portDepth = Math.min(max, 2 * Math.max(perEdge('in'), perEdge('out')) + 1);
  let best: [number, number] = [Math.max(w0, max), Math.max(d0, max)];
  let bestScore = [Infinity, Infinity, Infinity];
  for (let d = Math.max(d0, portDepth); d <= Math.max(d0, max); d++) {
    const { needed } = arrangeSite({ ...site, size: [max, d] }, sizeOf);
    const size: [number, number] = [Math.max(w0, needed[0]), Math.max(d, needed[1])];
    const over = Math.max(0, size[0] - max) + Math.max(0, size[1] - max);
    const score = [over, Math.max(size[0], size[1]), size[0] * size[1]];
    const better = score.findIndex((v, i) => v !== bestScore[i]);
    if (better >= 0 && score[better] < bestScore[better]) {
      best = [Math.min(max, size[0]), Math.min(max, size[1])];
      bestScore = score;
    }
  }
  return best;
}
