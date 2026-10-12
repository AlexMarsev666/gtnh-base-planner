import { add } from '../geometry';
import type { Vec3 } from '../core/types';
import type { MultiblockDef, PlanLimits, Unit } from '../multiblock/types';
import { plainOf, sourceOf } from './cache';
import { candidates, decode, ordinal } from './candidates';
import {
  coord,
  extraModesFor,
  modeCaps,
  modesFor,
  neighbourCap,
  PATTERNS,
  rotationAt,
  variantAt,
} from './modes';
import type { WallshareMode } from '../plan/types';
import { inside, pairOk } from './shapes';
import type { Candidate, DefCache, Spacing, Variant } from './types';

/** Turning a ranked candidate into concrete units, checking every pair of neighbours. */

/**
 * Lattice offsets (one per unordered pair) that may interact. Along an axis, units `k` lattice steps apart
 * are at least (k / 2 rounded down) * (inner + outer) + (k odd ? inner : 0) blocks apart, and only pairs
 * within `size` of each other interact (the box grown by one, for the controller's front cell, must touch).
 */
function offsetsFor(spacing: [Spacing, Spacing, Spacing], size: Vec3, counts: Vec3): Vec3[] {
  const reach = [0, 1, 2].map((a) => {
    const sp = spacing[a];
    let k = 0;
    const gap = (steps: number) => Math.floor(steps / 2) * (sp.inner + sp.outer) + (steps % 2) * sp.inner;
    while (k < counts[a] - 1 && gap(k + 1) <= size[a]) k++;
    return k;
  });
  const out: Vec3[] = [];
  for (let ox = -reach[0]; ox <= reach[0]; ox++)
    for (let oy = -reach[1]; oy <= reach[1]; oy++)
      for (let oz = -reach[2]; oz <= reach[2]; oz++) {
        const first = ox !== 0 ? ox : oy !== 0 ? oy : oz;
        if (first > 0) out.push([ox, oy, oz]);
      }
  return out;
}

function unitOrigin(sp: [Spacing, Spacing, Spacing], p: Vec3): Vec3 {
  return [coord(sp[0], p[0]), coord(sp[1], p[1]), coord(sp[2], p[2])];
}

/** Validate a candidate; returns the units of the first rotation pattern that works, or null. */
export function realize(def: MultiblockDef, cache: DefCache, n: number, c: Candidate): Unit[] | null {
  const { parity, spacing, size, variants } = c.mode;
  let cells: Vec3[] | null = null;
  let origins: Vec3[] | null = null;
  let turned: Variant[] = [];
  let offsets: Vec3[] = [];
  for (const { flip, alt } of PATTERNS) {
    // Alternation along an axis with a single unit is the same as no alternation.
    if (alt !== -1 && c.used[alt] === 1) continue;
    let cheapOk = true;
    for (let a = 0; a < 3 && cheapOk; a++)
      if (
        c.used[a] >= 2 &&
        c.used[a] > neighbourCap(def, cache, parity, spacing[a], a, flip, alt, variants.base, variants.alt[a])
      )
        cheapOk = false;
    if (!cheapOk) continue;
    if (!cells || !origins) {
      cells = [];
      for (let i = 0; i < n; i++) cells.push(decode(i, c.counts, c.order));
      origins = cells.map((p) => unitOrigin(spacing, p));
      turned = cells.map((p) => variantAt(variants, p));
      // Orientations the machine forbids make the whole mode useless, whatever the rotations.
      if (variants.alt.some((v) => v !== 0) && turned.some((v) => !cache.allowed.includes(v))) return null;
      offsets = offsetsFor(spacing, size, c.counts);
    }
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const p = cells[i];
      const ra = rotationAt(parity, flip, alt, p);
      for (const o of offsets) {
        const q = add(p, o);
        if (!inside(c.counts, q)) continue;
        const j = ordinal(q, c.counts, c.order);
        if (j >= n) continue;
        const qo = origins[j];
        const d: Vec3 = [qo[0] - origins[i][0], qo[1] - origins[i][1], qo[2] - origins[i][2]];
        // Boxes grown by one (for the controller's front cell) must touch to interact.
        if (Math.abs(d[0]) > size[0] || Math.abs(d[1]) > size[1] || Math.abs(d[2]) > size[2]) continue;
        if (!pairOk(def, cache, ra, rotationAt(parity, flip, alt, q), d, turned[i], turned[j])) {
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
        ...(turned[id] ? { variant: turned[id] } : {}),
      }));
      sourceOf.set(units, c);
      return units;
    }
  }
  return null;
}

/** Minecraft's world height: no deep or turned layout may be taller (nor taller than the plain one). */
export const MAX_BUILD_HEIGHT = 256;

/**
 * Best layout of exactly `n` units within limits, or null when none of the lattice layouts fits. With a
 * `wallshare` preference only layouts of that kind are tried ('separate' needs gaps, so it searches the
 * spaced family). The plain layouts decide first; a deep or turned one (`extraModesFor`) replaces the plain
 * result only when its bounding volume is smaller and it is no taller (nor above `MAX_BUILD_HEIGHT`), so
 * machines that gain nothing keep their layout.
 */
export function tryPack(
  def: MultiblockDef,
  cache: DefCache,
  n: number,
  limits: PlanLimits,
  wallshare?: WallshareMode,
): Unit[] | null {
  if (n === 0) return [];
  const spaced = wallshare === 'separate';
  let best: Unit[] | null = null;
  let bound = Infinity;
  let height = MAX_BUILD_HEIGHT;
  for (const c of candidates(def, modesFor(def, cache), n, limits, spaced, wallshare)) {
    best = realize(def, cache, n, c);
    if (best) {
      bound = c.height * c.area;
      height = Math.min(height, c.height);
      break;
    }
  }
  if (n < 2) return best;
  const deeper = candidates(def, extraModesFor(def, cache), n, limits, spaced, wallshare, bound)
    .filter((c) => c.height <= height)
    .sort((a, b) => a.height * a.area - b.height * b.area || a.seq - b.seq);
  for (const c of deeper) {
    const units = realize(def, cache, n, c);
    if (units) {
      if (best) plainOf.set(units, best);
      return units;
    }
  }
  return best;
}

/** Upper bound on units that fit the limits (lattice cells allowed by caps), capped at `n`. */
export function fitBound(def: MultiblockDef, cache: DefCache, n: number, limits: PlanLimits): number {
  let best = 0;
  const modes = n >= 2 ? [...modesFor(def, cache), ...extraModesFor(def, cache)] : modesFor(def, cache);
  for (const mode of modes) {
    const caps = modeCaps(mode, limits, n);
    best = Math.max(best, Math.min(n, caps[0] * caps[1] * caps[2]));
  }
  return best;
}
