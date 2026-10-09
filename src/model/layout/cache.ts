import type { Vec3 } from '../core/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import type { PackResult } from '../plan/types';
import { buildShapes } from './shapes';
import type { Candidate, DefCache } from './types';

/**
 * Per-definition caches of the layout packer, keyed by the definition object (WeakMap: a new or resized
 * definition gets a fresh cache). Results are cloned on the way out, so callers may mutate what they get.
 */

export const RESULT_CACHE_SIZE = 64;

/** The candidate each layout array handed out came from, so it can be loosened later (see `loosenings`). */
export const sourceOf = new WeakMap<readonly Unit[], Candidate>();

const caches = new WeakMap<MultiblockDef, DefCache>();

export function defCache(def: MultiblockDef): DefCache {
  let c = caches.get(def);
  if (!c) {
    c = { shapes: buildShapes(def), pairs: new Map(), modes: null, results: new Map() };
    caches.set(def, c);
  }
  return c;
}

export function cloneResult(r: PackResult): PackResult {
  const units = r.units.map((u) => ({
    ...u,
    origin: [u.origin[0], u.origin[1], u.origin[2]] as Vec3,
    rotation: u.rotation,
  }));
  const source = sourceOf.get(r.units);
  if (source) sourceOf.set(units, source);
  return { ...r, units };
}
