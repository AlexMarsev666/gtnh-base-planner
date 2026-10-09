import { NO_DIR } from './constants';
import { ROUTED_MASK } from './kinds';
import type { Router, Terminal, Tree } from './types';

/** Reworking a finished network branch by branch, keeping its terminals. */

/** Bends along `cells` (consecutive grid indices), counted where the step changes. */
function bendsAlong(cells: readonly number[]): number {
  let n = 0;
  for (let i = 2; i < cells.length; i++) if (cells[i] - cells[i - 1] !== cells[i - 1] - cells[i - 2]) n++;
  return n;
}

/**
 * Improve a finished network of kind `k` branch by branch. Each connected hatch that hangs on a leaf chain
 * (its attachment cell has one neighbour in the network, and the chain runs to a fork or another hatch's
 * cell) gets that chain taken out and is joined again to the rest of the network by the cheapest path, at
 * `base` per block plus `turnCost` per bend (no congestion history), with other kinds' cells as walls. The
 * new path replaces the chain when it is cheaper. The growth order of `growTree` can leave a branch that
 * a later branch made unnecessary or worse than a detour around it; this removes most of those.
 * Keeps `r.used` up to date, rewrites `tree.net` / `tree.paths` and the attachment cells in `via`.
 */
export function refineTree(
  r: Router,
  s: { k: number; terms: readonly Terminal[]; at: ReadonlyMap<number, readonly number[]>; via: Int32Array },
  tree: Tree,
  base: Float32Array,
): void {
  if (tree.connected < 2) return;
  const { g, used, pass, dist, parent, arrive, seen, inNet, heap, turnCost } = r;
  const { offsets } = g;
  const bit = 1 << s.k;
  const others = ~bit & ROUTED_MASK;
  const nbrs = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    if (a === b) return;
    const la = nbrs.get(a) ?? [];
    if (!la.includes(b)) la.push(b);
    nbrs.set(a, la);
    const lb = nbrs.get(b) ?? [];
    if (!lb.includes(a)) lb.push(a);
    nbrs.set(b, lb);
  };
  for (const c of tree.net) if (!nbrs.has(c)) nbrs.set(c, []);
  for (const p of tree.paths) for (let i = 1; i < p.length; i++) link(p[i - 1], p[i]);
  const unlink = (c: number): void => {
    for (const n of nbrs.get(c) ?? []) {
      const l = nbrs.get(n);
      if (l) l.splice(l.indexOf(c), 1);
    }
    nbrs.delete(c);
  };

  let changed = false;
  for (let pass2 = 0; pass2 < 2; pass2++) {
    let improved = false;
    const termCells = new Set<number>();
    for (let ti = 0; ti < s.terms.length; ti++) if (s.via[ti] !== -1) termCells.add(s.via[ti]);
    for (let ti = 0; ti < s.terms.length; ti++) {
      const c = s.via[ti];
      if (c === -1 || (nbrs.get(c)?.length ?? 0) !== 1 || (s.at.get(c)?.length ?? 0) !== 1) continue;
      // The leaf chain from the hatch's cell up to (not including) the fork or hatch cell it hangs on.
      const chain = [c];
      let prev = -1;
      let cur = c;
      let junction = -1;
      for (;;) {
        const next = nbrs.get(cur)!.find((n) => n !== prev);
        if (next === undefined) break;
        if (nbrs.get(next)!.length !== 2 || termCells.has(next)) {
          junction = next;
          break;
        }
        chain.push(next);
        prev = cur;
        cur = next;
      }
      if (junction < 0) continue;
      let oldCost = turnCost * bendsAlong([...chain, junction]);
      for (const i of chain) oldCost += base[i];

      // Cheapest path from the hatch's free sides to the rest of the network.
      const ns = ++r.netStamp;
      const inChain = new Set(chain);
      for (const i of nbrs.keys()) if (!inChain.has(i)) inNet[i] = ns;
      const stamp = ++r.stamp;
      heap.clear();
      let reached = -1;
      for (const src of s.terms[ti].cells) {
        if ((pass[src] & bit) === 0 || (used[src] & others) !== 0) continue;
        if (inNet[src] === ns) {
          reached = src;
          parent[src] = -1;
          break;
        }
        seen[src] = stamp;
        dist[src] = base[src];
        parent[src] = -1;
        arrive[src] = NO_DIR;
        heap.update(src);
      }
      let newCost = reached >= 0 ? 0 : Infinity;
      // Dijkstra until nothing queued can beat the best connection found (or the old chain).
      while (heap.size > 0) {
        const at = heap.pop();
        const d = dist[at];
        if (d >= newCost || d >= oldCost) break;
        const a = arrive[at];
        for (let dir = 0; dir < 6; dir++) {
          const n = at + offsets[dir];
          const turn = a !== NO_DIR && a !== dir ? turnCost : 0;
          if (inNet[n] === ns) {
            // Joining the network: the step onto it is free (its cell is already paid for).
            if (d + turn < newCost) {
              newCost = d + turn;
              reached = n;
              parent[n] = at;
            }
            continue;
          }
          if ((pass[n] & bit) === 0 || (used[n] & others) !== 0) continue;
          const nd = d + base[n] + turn;
          if (seen[n] === stamp && dist[n] <= nd) continue;
          seen[n] = stamp;
          dist[n] = nd;
          parent[n] = at;
          arrive[n] = dir;
          heap.update(n);
        }
      }
      if (reached < 0 || newCost >= oldCost - 1e-9) continue;

      // Replace the chain by the new path.
      for (const i of chain) {
        unlink(i);
        used[i] &= ~bit;
      }
      const path: number[] = [];
      for (let i = parent[reached]; i !== -1; i = parent[i]) path.push(i);
      // path runs from the cell beside the network back to the hatch's side cell.
      let last = reached;
      for (const i of path) {
        if (!nbrs.has(i)) nbrs.set(i, []);
        link(last, i);
        used[i] |= bit;
        last = i;
      }
      s.via[ti] = path.length > 0 ? path[path.length - 1] : reached;
      termCells.delete(c);
      termCells.add(s.via[ti]);
      improved = true;
      changed = true;
    }
    if (!improved) break;
  }
  if (!changed) return;

  // Rebuild the cell list and the polylines (chains between forks, ends and hatch cells).
  tree.net = [...nbrs.keys()];
  const stops = new Set<number>();
  for (const [c, l] of nbrs) if (l.length !== 2) stops.add(c);
  for (let ti = 0; ti < s.terms.length; ti++) if (s.via[ti] !== -1) stops.add(s.via[ti]);
  const done = new Set<string>();
  const paths: number[][] = [];
  for (const start of stops)
    for (const first of nbrs.get(start) ?? []) {
      if (done.has(`${start}|${first}`)) continue;
      const line = [start, first];
      done.add(`${start}|${first}`).add(`${first}|${start}`);
      let prev = start;
      let cur = first;
      while (!stops.has(cur)) {
        const next = nbrs.get(cur)!.find((n) => n !== prev)!;
        done.add(`${cur}|${next}`).add(`${next}|${cur}`);
        line.push(next);
        prev = cur;
        cur = next;
      }
      paths.push(line);
    }
  tree.paths = paths.length > 0 ? paths : [[tree.net[0]]];
}
