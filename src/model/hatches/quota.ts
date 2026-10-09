import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import type { HatchResult } from '../plan/types';
import { HATCH_PRIORITY } from './constants';
import { fixedHatchCounts } from '../multiblock/fixedHatches';
import { countRules, type SourceCountRule } from '../multiblock/rules';

const alternativeLimits = new WeakMap<MultiblockDef, Partial<Record<HatchKind, SourceCountRule[]>>>();
/** A maximum can span several physical variants of one logical interface. */
export function alternativeHatchLimits(def: MultiblockDef): Partial<Record<HatchKind, SourceCountRule[]>> {
  let limits = alternativeLimits.get(def);
  if (!limits) {
    limits = {};
    for (const rule of countRules(def.id))
      if (rule.anyOf && rule.max !== undefined)
        for (const kind of rule.anyOf) (limits[kind] ??= []).push(rule);
    alternativeLimits.set(def, limits);
  }
  return limits;
}

/** Which hatch kinds to place and how many each unit wants. */

/** How many hatches of one kind each unit wants (`target`) and may have at most (`max`). */
export function quota(def: MultiblockDef, kind: HatchKind): { target: number; max: number } {
  const req = def.requiredHatches?.[kind];
  const fixed = fixedHatchCounts(def)[kind] ?? 0;
  if (!req) return { target: Math.max(1, fixed), max: Infinity };
  const max = typeof req.max === 'number' && req.max >= 0 ? Math.floor(req.max) : Infinity;
  const min = Number.isFinite(req.min) ? Math.max(0, Math.floor(req.min)) : 0;
  // An enabled kind always gets at least one hatch, unless the definition forbids it (max 0).
  return { target: Math.min(Math.max(min, fixed, 1), max), max };
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
