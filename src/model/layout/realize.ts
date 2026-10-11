import { add } from '../geometry';
import type { Vec3 } from '../core/types';
import type { MultiblockDef, PlanLimits, Unit } from '../multiblock/types';
import { sourceOf } from './cache';
import { candidates, decode, ordinal } from './candidates';
import { coord, modeCaps, modesFor, neighbourCap, PATTERNS, rotationAt } from './modes';
import type { WallshareMode } from '../plan/types';
import { inside, pairOk } from './shapes';
import type { Candidate, DefCache, Spacing } from './types';

/** Turning a ranked candidate into concrete units, checking every pair of neighbours. */

/**
 * Lattice offsets (one per unordered pair) that may interact. Spacing is at least max(1, size - 1), so
 * units three or more lattice steps apart are always more than `size` blocks apart and never interact.
 */
const OFFSETS: readonly Vec3[] = (() => {
  const out: Vec3[] = [];
  for (let ox = -2; ox <= 2; ox++)
    for (let oy = -2; oy <= 2; oy++)
      for (let oz = -2; oz <= 2; oz++) {
        const first = ox !== 0 ? ox : oy !== 0 ? oy : oz;
        if (first > 0) out.push([ox, oy, oz]);
      }
  return out;
})();

function unitOrigin(sp: [Spacing, Spacing, Spacing], p: Vec3): Vec3 {
  return [coord(sp[0], p[0]), coord(sp[1], p[1]), coord(sp[2], p[2])];
}

/** Validate a candidate; returns the units of the first rotation pattern that works, or null. */
export function realize(def: MultiblockDef, cache: DefCache, n: number, c: Candidate): Unit[] | null {
  const { parity, spacing, size } = c.mode;
  let cells: Vec3[] | null = null;
  let origins: Vec3[] | null = null;
  for (const { flip, alt } of PATTERNS) {
    // Alternation along an axis with a single unit is the same as no alternation.
    if (alt !== -1 && c.used[alt] === 1) continue;
    let cheapOk = true;
    for (let a = 0; a < 3 && cheapOk; a++)
      if (c.used[a] >= 2 && c.used[a] > neighbourCap(def, cache, parity, spacing[a], a, flip, alt))
        cheapOk = false;
    if (!cheapOk) continue;
    if (!cells || !origins) {
      cells = [];
      for (let i = 0; i < n; i++) cells.push(decode(i, c.counts, c.order));
      origins = cells.map((p) => unitOrigin(spacing, p));
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const p = cells[i];
      const ra = rotationAt(parity, flip, alt, p);
      for (const o of OFFSETS) {
        const q = add(p, o);
        if (!inside(c.counts, q)) continue;
        const j = ordinal(q, c.counts, c.order);
        if (j >= n) continue;
        const qo = origins[j];
        const d: Vec3 = [qo[0] - origins[i][0], qo[1] - origins[i][1], qo[2] - origins[i][2]];
        // Boxes grown by one (for the controller's front cell) must touch to interact.
        if (Math.abs(d[0]) > size[0] || Math.abs(d[1]) > size[1] || Math.abs(d[2]) > size[2]) continue;
        if (!pairOk(def, cache, ra, rotationAt(parity, flip, alt, q), d)) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      const found = origins;
      const units = cells.map((p, id) => ({
        id,
        origin: found[id],
        rotation: rotationAt(parity, flip, alt, p),
      }));
      sourceOf.set(units, c);
      return units;
    }
  }
  return null;
}

/**
 * Best layout of exactly `n` units within limits, or null when none of the lattice layouts fits. With a
 * `wallshare` preference only layouts of that kind are tried ('separate' needs gaps, so it searches the
 * spaced family).
 */
export function tryPack(
  def: MultiblockDef,
  cache: DefCache,
  n: number,
  limits: PlanLimits,
  wallshare?: WallshareMode,
): Unit[] | null {
  if (n === 0) return [];
  for (const c of candidates(def, modesFor(def, cache), n, limits, wallshare === 'separate', wallshare)) {
    const units = realize(def, cache, n, c);
    if (units) return units;
  }
  return null;
}

/** Upper bound on units that fit the limits (lattice cells allowed by caps), capped at `n`. */
export function fitBound(def: MultiblockDef, cache: DefCache, n: number, limits: PlanLimits): number {
  let best = 0;
  for (const mode of modesFor(def, cache)) {
    const caps = modeCaps(mode, limits, n);
    best = Math.max(best, Math.min(n, caps[0] * caps[1] * caps[2]));
  }
  return best;
}
