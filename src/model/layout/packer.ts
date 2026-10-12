import { key } from '../geometry';
import type { MultiblockDef, PlanLimits, Unit } from '../multiblock/types';
import type { WallshareMode } from '../plan/types';
import { cloneResult, defCache, RESULT_CACHE_SIZE, sourceOf } from './cache';
import { candidates } from './candidates';
import { modesFor, sanitizeLimits } from './modes';
import { fitBound, realize, tryPack } from './realize';
import type { Candidate, LayoutResult, WallshareFallback } from './types';

/**
 * UNIT 1 — Layout packing.
 *
 * Auto-place `count` units of `def` as compactly as possible.
 * - When `def.wallshare`, neighbours overlap by one block (pitch = size - 1) so they share walls;
 *   otherwise they are placed side by side without overlap.
 * - A controller cell must never lie on a shared (overlapping) face: pick rotations so controllers face outward.
 * - At most `limits` units along each world axis (x, y = layers, z; null = unlimited).
 * - Deterministic, pure, and fast (< 20 ms for 60 units).
 * Returns fewer units than requested with a `reason` when they do not fit.
 *
 * How it works: units sit on a lattice (counts nx × ny × nz). Along each axis the spacing is either uniform
 * (shared wall or touching) or "paired": two units back to back, then a one-block walkway that the controllers
 * of neighbouring pairs face. All units share one rotation parity so their rotated bounding boxes are equal;
 * within that parity a unit may be turned by 180° depending on its lattice index along one horizontal axis,
 * which puts rows back to back with controllers facing outward. Every lattice shape is scored analytically
 * (shared faces, height, area) and candidates are validated best-first against memoised pairwise cell
 * checks, so only a handful are ever fully checked.
 */

/**
 * Every valid layout of exactly `count` units within `limits`, best first: the compact layouts `packUnits`
 * chooses from, then looser ones (gaps between units, walkways) that leave more faces open for hatches.
 * Lazy, so callers can stop at the first layout that suits them. Identical layouts are yielded once.
 */
export function* layoutCandidates(
  def: MultiblockDef,
  count: number,
  limits: PlanLimits,
  wallshare?: WallshareMode,
): Generator<Unit[]> {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return;
  const lim = sanitizeLimits(limits);
  const cache = defCache(def);
  const seen = new Set<string>();
  // Round-robin over spacing families (gap / walkway / shared per axis) so that looser families are
  // reached after a few tries instead of after every compact lattice shape.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates(def, modesFor(def, cache), n, lim, true)) {
    const g = `${c.mode.parity}|${c.mode.spacing.map((s) => `${s.inner}/${s.outer}`).join(',')}|${c.mode.variants.alt.join('')}`;
    const list = groups.get(g);
    if (list) list.push(c);
    else groups.set(g, [c]);
  }
  const ordered: Candidate[] = [];
  const lists = [...groups.values()];
  const total = lists.reduce((s, l) => s + l.length, 0);
  for (let round = 0; ordered.length < total; round++)
    for (const l of lists) if (round < l.length) ordered.push(l[round]);
  // A wallshare preference only reorders: layouts of that kind come first, the rest follow in their usual
  // order so a caller that needs looser layouts (hatches that do not fit) still reaches them.
  const wanted = n >= 2 && wallshare && wallshare !== 'auto' ? wallshare : null;
  if (wanted)
    ordered.splice(
      0,
      ordered.length,
      ...ordered.filter((c) => c.kind === wanted),
      ...ordered.filter((c) => c.kind !== wanted),
    );
  for (const c of ordered) {
    const units = realize(def, cache, n, c);
    if (!units) continue;
    const k = units.map((u) => `${key(u.origin)}/${u.rotation}/${u.variant ?? 0}`).join(';');
    if (seen.has(k)) continue;
    seen.add(k);
    yield units;
  }
}

/** Which preference a layout from `packUnits` / `layoutCandidates` satisfies; null for foreign layouts. */
export function layoutWallshare(units: readonly Unit[]): WallshareMode | null {
  return sourceOf.get(units)?.kind ?? null;
}

/**
 * Pack `count` units; with a `wallshare` preference ('auto' or absent = the usual ranking) layouts of that
 * kind are tried first (see `classifyWallshare` for what each kind means). When none fits, the automatic
 * result is returned together with `fallback` saying what was used and why. A preference needs at least two
 * units to mean anything, so smaller counts never report a fallback.
 */
export function packUnits(
  def: MultiblockDef,
  count: number,
  limits: PlanLimits,
  wallshare?: WallshareMode,
): LayoutResult {
  const requested = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const lim = sanitizeLimits(limits);
  const cache = defCache(def);
  const wanted = requested >= 2 && wallshare && wallshare !== 'auto' ? wallshare : null;
  const cacheKey = `${requested}|${lim.x}|${lim.y}|${lim.z}${wanted ? `|${wanted}` : ''}`;
  const cached = cache.results.get(cacheKey);
  if (cached) {
    // Refresh recency (LRU).
    cache.results.delete(cacheKey);
    cache.results.set(cacheKey, cached);
    return cloneResult(cached);
  }

  // A preference that needs shared walls is hopeless for a multiblock that cannot share them.
  const hopeless = wanted !== null && wanted !== 'separate' && !def.wallshare;
  let units = wanted && !hopeless ? tryPack(def, cache, requested, lim, wanted) : null;
  const honoured = units !== null;
  units ??= tryPack(def, cache, requested, lim);
  if (!units) {
    // Dropping units from a layout keeps it valid, so feasible counts are (practically) a prefix of 0..n:
    // binary search the largest, then probe upwards in case the lattice family skipped a count.
    const bound = Math.min(requested - 1, fitBound(def, cache, requested, lim));
    let lo = 0;
    let hi = bound;
    let best: Unit[] = [];
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const u = tryPack(def, cache, mid, lim);
      if (u) {
        best = u;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let m = best.length + 1; m <= bound; m++) {
      const u = tryPack(def, cache, m, lim);
      if (!u) break;
      best = u;
    }
    units = best;
  }

  const result: LayoutResult = { units, requested, placed: units.length };
  if (wanted && !honoured) {
    const unlimited = { x: null, y: null, z: null };
    const limited = lim.x !== null || lim.y !== null || lim.z !== null;
    const fallback: WallshareFallback = {
      wanted,
      used: layoutWallshare(units) ?? 'auto',
      reason: hopeless
        ? 'no-wallshare'
        : limited && tryPack(def, cache, requested, unlimited, wanted)
          ? 'limits'
          : 'geometry',
    };
    result.fallback = fallback;
  }
  if (units.length < requested) {
    // Without limits a single row along a non-facing axis always fits, so a shortfall means the limits.
    const limited = lim.x !== null || lim.y !== null || lim.z !== null;
    result.reason = limited ? 'limits' : 'geometry';
  }
  if (cache.results.size >= RESULT_CACHE_SIZE) {
    const oldest = cache.results.keys().next().value;
    if (oldest !== undefined) cache.results.delete(oldest);
  }
  cache.results.set(cacheKey, result);
  return cloneResult(result);
}
