import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import type { HatchResult } from '../plan/types';
import { HATCH_PRIORITY } from './constants';

/** Which hatch kinds to place and how many each unit wants. */

/**
 * How many hatches of one kind each unit wants (`target`) and may have at most (`max`). `any` is what a
 * `requiredAny` group asks of this kind (see `anyMins`), counted like a `requiredHatches` min.
 */
export function quota(def: MultiblockDef, kind: HatchKind, any = 0): { target: number; max: number } {
  const req = def.requiredHatches?.[kind];
  if (!req) return { target: Math.max(1, any), max: Infinity };
  const max = typeof req.max === 'number' && req.max >= 0 ? Math.floor(req.max) : Infinity;
  const min = Number.isFinite(req.min) ? Math.max(0, Math.floor(req.min)) : 0;
  // An enabled kind always gets at least one hatch, unless the definition forbids it (max 0).
  return { target: Math.min(Math.max(min, any, 1), max), max };
}

/**
 * What the `requiredAny` groups ask of each kind: a group's `min` falls on the first of its kinds that is in
 * `kinds` (enabled, and the def has a hatch block for it). A group none of whose kinds is in `kinds` asks
 * nothing: it is left unmet (and reported by `checkValidity`), not added behind the user's back.
 */
export function anyMins(def: MultiblockDef, kinds: readonly HatchKind[]): Map<HatchKind, number> {
  const out = new Map<HatchKind, number>();
  for (const group of def.requiredAny ?? []) {
    const kind = group.kinds.find((k) => kinds.includes(k) && def.hatchBlocks?.[k] !== undefined);
    if (kind !== undefined) out.set(kind, Math.max(out.get(kind) ?? 0, group.min));
  }
  return out;
}

/** Kinds to place: enabled, supported by the def (it has a hatch block), deduplicated, fixed order. */
export function kindsToPlace(def: MultiblockDef, enabled: readonly HatchKind[]): HatchKind[] {
  const wanted = new Set(enabled);
  return HATCH_PRIORITY.filter((k) => wanted.has(k) && def.hatchBlocks?.[k] !== undefined);
}

export function sortedIds(units: readonly Unit[]): number[] {
  return [...new Set(units.map((u) => u.id))].sort((a, b) => a - b);
}

export function allUnplaced(def: MultiblockDef, units: readonly Unit[], kinds: HatchKind[]): HatchResult {
  const unplaced: HatchResult['unplaced'] = [];
  for (const kind of kinds) {
    const { target } = quota(def, kind);
    for (const unitId of sortedIds(units)) for (let i = 0; i < target; i++) unplaced.push({ unitId, kind });
  }
  return { hatches: [], unplaced };
}
