import { HISTORY_STEP, MAX_ROUNDS, MAX_STALLED_ROUNDS, PRESENT_GROWTH, PRESENT_START } from './constants';
import { POPCOUNT, routeKind } from './grow';
import type { KindState, Router, Tree } from './types';

/**
 * Negotiated routing of every kind (see `MAX_ROUNDS`). Each round routes the kinds whose network still
 * shares a cell, as if the others were not there but with their cells priced up (`present`), and makes
 * every contested cell dearer for good (`history`). Stops when no cell is shared, after `rounds` rounds,
 * or when the contested count stops falling. No round after the first starts once `maxPops` cells were
 * popped. If cells are still shared then, the kinds are repaired one by one around the others
 * (`repairRoutes`). Leaves each kind's network in its `tree`. Returns whether `maxPops` cut the rounds short.
 */
export function negotiateRoutes(
  r: Router,
  states: readonly KindState[],
  rounds = MAX_ROUNDS,
  maxPops = Infinity,
): boolean {
  let present = PRESENT_START;
  let legal = false;
  let fewest = Infinity;
  let stalled = 0;
  let round = 0;
  for (
    ;
    round < rounds && !legal && stalled < MAX_STALLED_ROUNDS && (round === 0 || r.heap.pops < maxPops);
    round++
  ) {
    for (const s of states) {
      if (round > 0 && !shared(r, s)) continue;
      setUsed(r, s, false);
      s.tree = routeKind(r, s.terms, s.at, s.via, s.k, present, false);
      setUsed(r, s, true);
    }
    let contested = 0;
    for (const s of states)
      for (const i of s.tree?.net ?? [])
        if (POPCOUNT[r.used[i]] > 1) {
          contested++;
          r.price[i] += HISTORY_STEP / POPCOUNT[r.used[i]];
        }
    if (contested === 0) legal = true;
    if (contested < fewest) {
      fewest = contested;
      stalled = 0;
    } else stalled++;
    present *= PRESENT_GROWTH;
  }
  const capped = !legal && round < rounds && stalled < MAX_STALLED_ROUNDS;
  if (!legal) repairRoutes(r, states);
  return capped;
}

/**
 * Out of rounds: repair the networks one by one. Each kind is routed again around every other kind's
 * cells, keeping its own uncontested cells for free, so it only detours around the contested ones (which
 * the kinds repaired later keep). Kinds with the fewest contested cells give theirs up first.
 */
function repairRoutes(r: Router, states: readonly KindState[]): void {
  const order = [...states].sort((a, b) => contestedCells(r, a) - contestedCells(r, b) || a.k - b.k);
  for (const s of order) {
    const own = s.tree?.net ?? [];
    for (const i of own) r.keep[i] = 1;
    setUsed(r, s, false);
    s.tree = routeKind(r, s.terms, s.at, s.via, s.k, 0, true);
    setUsed(r, s, true);
    for (const i of own) r.keep[i] = 0;
  }
}

/** Marks (or unmarks) a kind's network cells in `r.used`. */
function setUsed(r: Router, s: KindState, on: boolean): void {
  if (!s.tree) return;
  const bit = 1 << s.k;
  for (const i of s.tree.net) r.used[i] = on ? r.used[i] | bit : r.used[i] & ~bit;
}

/** Whether a kind's network shares a cell with another kind's. */
function shared(r: Router, s: KindState): boolean {
  const bit = 1 << s.k;
  return s.tree !== null && s.tree.net.some((i) => (r.used[i] & ~bit) !== 0);
}

/** Cells of a kind's network that another kind's network also uses. */
function contestedCells(r: Router, s: { k: number; tree: Tree | null }): number {
  const bit = 1 << s.k;
  let n = 0;
  for (const i of s.tree?.net ?? []) if ((r.used[i] & ~bit) !== 0) n++;
  return n;
}
