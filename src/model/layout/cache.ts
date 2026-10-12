import type { Vec3 } from '../core/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { composeVariants, variantOfDef } from '../mirror';
import { buildShapes } from './shapes';
import type { Candidate, DefCache, LayoutResult, Variant } from './types';

/**
 * Per-definition caches of the layout packer, keyed by the definition object (WeakMap: a new or resized
 * definition gets a fresh cache). Results are cloned on the way out, so callers may mutate what they get.
 */

export const RESULT_CACHE_SIZE = 64;

/** The candidate each layout array handed out came from, so it can be loosened later (see `loosenings`). */
export const sourceOf = new WeakMap<readonly Unit[], Candidate>();

const VARIANTS: readonly Variant[] = [0, 1, 2, 3];

/** The variants a unit of `def` may take: absolute orientation (the def's own plus the unit's) must be allowed. */
function allowedVariants(def: MultiblockDef): Variant[] {
  const own = variantOfDef(def);
  const list = VARIANTS.filter((v) => !def.variants || def.variants.includes(composeVariants(own, v)));
  return list;
}

/** The plain layout a deep or turned one replaced, so a routed loosening can fall back to it (see `loosenings`). */
export const plainOf = new WeakMap<readonly Unit[], Unit[]>();

const caches = new WeakMap<MultiblockDef, DefCache>();

export function defCache(def: MultiblockDef): DefCache {
  let c = caches.get(def);
  if (!c) {
    const blocks = new Map<string, number>();
    c = {
      shapes: buildShapes(def, blocks),
      blocks,
      variantShapes: [],
      allowed: allowedVariants(def),
      pairs: new Map(),
      modes: null,
      extraModes: null,
      results: new Map(),
    };
    caches.set(def, c);
  }
  return c;
}

export function cloneResult(r: LayoutResult): LayoutResult {
  const units = r.units.map((u) => ({
    id: u.id,
    origin: [u.origin[0], u.origin[1], u.origin[2]] as Vec3,
    rotation: u.rotation,
    ...(u.variant ? { variant: u.variant } : {}),
  }));
  const source = sourceOf.get(r.units);
  if (source) sourceOf.set(units, source);
  const plain = plainOf.get(r.units);
  if (plain) plainOf.set(units, plain);
  return r.fallback ? { ...r, units, fallback: { ...r.fallback } } : { ...r, units };
}
