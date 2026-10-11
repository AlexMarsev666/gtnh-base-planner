import { TIERS, type Tier } from '../model/core/types';
import type { HatchKind } from '../model/multiblock/types';
import type { HatchPlacement } from '../model/plan/types';
import { HIGHEST_TIER, followsMachineTier, planHatchKeys } from '../model/tiers';

/** One hatch of the build in the settings' tier list. */
export interface HatchTierRow {
  /** Key in `PlanState.hatchTiers`. */
  key: string;
  kind: HatchKind;
  /** Number among the hatches of its kind, from 1. */
  number: number;
}

/** Hatches that have no voltage tier. */
const UNTIERED: readonly HatchKind[] = ['maintenance', 'steamIn'];

/**
 * The hatches that can be given a tier, in the order the bill of materials keys them. With `selected` unit
 * ids only the hatches serving one of those units are listed; the keys and numbers stay those of the whole
 * build.
 */
export function hatchTierRows(
  hatches: readonly Pick<HatchPlacement, 'kind' | 'unitIds'>[],
  selected: readonly number[] = [],
): HatchTierRow[] {
  const keys = planHatchKeys(hatches);
  const rows: HatchTierRow[] = [];
  hatches.forEach((h, i) => {
    if (UNTIERED.includes(h.kind)) return;
    if (selected.length && !h.unitIds.some((id) => selected.includes(id))) return;
    rows.push({
      key: keys[i],
      kind: h.kind,
      number: Number(keys[i].slice(keys[i].lastIndexOf(':') + 1)) + 1,
    });
  });
  return rows;
}

/** Tiers a hatch of this kind can take (GT has no MAX energy or dynamo hatch). */
export function hatchTierOptions(kind: HatchKind): Tier[] {
  return followsMachineTier(kind) ? TIERS.slice(0, TIERS.indexOf(HIGHEST_TIER) + 1) : [...TIERS];
}

/** How many hatch tiers (`PlanState.hatchTiers` keys) name no hatch of the build, e.g. in a loaded plan. */
export function unmatchedHatchTiers(
  hatchTiers: Readonly<Record<string, unknown>> | undefined,
  hatches: readonly Pick<HatchPlacement, 'kind'>[],
): number {
  const keys = new Set(planHatchKeys(hatches));
  return Object.keys(hatchTiers ?? {}).filter((k) => !keys.has(k)).length;
}
