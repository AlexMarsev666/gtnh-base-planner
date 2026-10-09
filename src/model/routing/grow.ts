import { NO_DIR } from './constants';
import { ROUTED_MASK } from './kinds';
import type { Router, Terminal, Tree } from './types';

/** Connecting every terminal of one kind with a network grown over the cheapest cells. */

/** Set bits for every supported kind mask, including the ninth routing bit. */
export const POPCOUNT = Uint8Array.from({ length: ROUTED_MASK + 1 }, (_, m) => {
  let n = 0;
  for (; m !== 0; m &= m - 1) n++;
  return n;
});

/**
 * Grow one network of kind `k` from `seed` over the cheapest cells until every terminal it can reach is
 * connected: one Dijkstra search from the network, continued (not restarted) after each new branch, whose
 * cells join the network at cost 0. A step costs the cell's price plus `turnCost` for a bend. With `legal`,
 * cells of other kinds' networks are walls; otherwise they only cost more (`present`).
 */
function growTree(
  r: Router,
  terms: readonly Terminal[],
  at: ReadonlyMap<number, readonly number[]>,
  via: Int32Array,
  seed: number,
  k: number,
  present: number,
  legal: boolean,
): Tree {
  const { g, used, pass, price, keep, target, dist, parent, arrive, seen, inNet, heap, turnCost } = r;
  const { offsets } = g;
  const bit = 1 << k;
  const others = ~bit & ROUTED_MASK;
  const stamp = ++r.stamp;
  const ns = ++r.netStamp;
  heap.clear();
  via.fill(-1);
  let remaining = terms.length;
  let connected = 0;
  const net: number[] = [];
  const paths: number[][] = [];

  const reach = (cell: number): void => {
    for (const ti of at.get(cell) ?? []) {
      if (via[ti] !== -1) continue;
      via[ti] = cell;
      connected++;
      remaining--;
      for (const c of terms[ti].cells) target[c]--;
    }
  };
  const join = (cell: number): void => {
    if (inNet[cell] === ns) return;
    inNet[cell] = ns;
    net.push(cell);
    seen[cell] = stamp;
    dist[cell] = 0;
    parent[cell] = -1;
    arrive[cell] = NO_DIR;
    heap.update(cell);
    if (target[cell] !== 0) reach(cell);
  };

  join(seed);
  paths.push([seed]);
  while (remaining > 0 && heap.size > 0) {
    const cur = heap.pop();
    const d = dist[cur];

    if (target[cur] !== 0 && inNet[cur] !== ns) {
      // Cheapest unconnected terminal: its path back to the network becomes a branch.
      const path: number[] = [];
      let i = cur;
      for (; inNet[i] !== ns; i = parent[i]) path.push(i);
      path.push(i);
      path.reverse();
      for (let j = 1; j < path.length; j++) join(path[j]);
      paths.push(path);
      continue;
    }
    const a = arrive[cur];
    for (let dir = 0; dir < 6; dir++) {
      const n = cur + offsets[dir];
      if ((pass[n] & bit) === 0 || inNet[n] === ns) continue;
      const u = used[n] & others;
      if (u !== 0 && legal) continue;
      let cost = 0;
      if (keep[n] === 0) {
        cost = price[n];
        if (u !== 0) cost *= 1 + present * POPCOUNT[u];
        if (a !== NO_DIR && a !== dir) cost += turnCost;
      }
      const nd = d + cost;
      if (seen[n] === stamp && dist[n] <= nd) continue;
      seen[n] = stamp;
      dist[n] = nd;
      parent[n] = cur;
      arrive[n] = dir;
      heap.update(n);
    }
  }
  // Drop the seed's placeholder path when a branch starts at the seed anyway.
  if (paths.length > 1) paths.shift();
  return { net, paths, connected };
}

/**
 * Route kind `k`: grow from the first terminal with a free side; if that network turns out isolated while
 * others exist (e.g. it only opens into an enclosed pocket), retry from the next one. Leaves `via` holding
 * the attachment cell per terminal of the best try.
 */
export function routeKind(
  r: Router,
  terms: readonly Terminal[],
  at: ReadonlyMap<number, readonly number[]>,
  via: Int32Array,
  k: number,
  present: number,
  legal: boolean,
): Tree | null {
  const { target } = r;
  let best: Tree | null = null;
  let bestVia: Int32Array | null = null;
  for (const t of terms) {
    if (t.cells.length === 0) continue;
    for (const tt of terms) for (const c of tt.cells) target[c]++;
    const res = growTree(r, terms, at, via, t.cells[0], k, present, legal);
    // Clear what is left of the target counts.
    for (let ti = 0; ti < terms.length; ti++)
      if (via[ti] === -1) for (const c of terms[ti].cells) target[c]--;
    if (!best || res.connected > best.connected) {
      best = res;
      bestVia = via.slice();
    }
    if (res.connected > 1 || terms.length === 1) break;
  }
  if (bestVia) via.set(bestVia);
  return best;
}
