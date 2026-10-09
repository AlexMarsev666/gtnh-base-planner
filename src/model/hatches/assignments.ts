import type { PlanState, HatchResult } from '../plan/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { unitCells } from '../geometry';
import { defaultHatchTier } from './tiers';

/** Logical identity survives packing and rotation; a resource key is never a coordinate. */
export function hatchAssignmentKey(unitId: number, kind: string, resource?: string, ordinal = 0): string {
  return JSON.stringify([unitId, kind, resource ?? null, ordinal]);
}

/** Uniform tiers do not change placement. Reuse the efficient classic placement and annotate it. */
export function withUniformHatchTiers(
  def: MultiblockDef,
  units: readonly Unit[],
  result: HatchResult,
  settings: Pick<PlanState, 'voltageTier' | 'manualTransformerMode'>,
): HatchResult {
  const cells = new Map(units.map((u) => [u.id, new Map(unitCells(def, u).map((c) => [c.pos.join(), c]))]));
  const counts = new Map<string, number>();
  return {
    ...result,
    hatches: result.hatches.map((h) => {
      const assignments = h.unitIds.map((id) => {
        const regions = def.requiredHatches?.[h.kind]?.regions ?? [];
        const cell = cells.get(id)?.get(h.cell.join());
        const region = cell && def.legend[cell.char]?.region;
        const regional = region ? regions.indexOf(region) : -1;
        const key = `${id}:${h.kind}`;
        const ordinal = regional >= 0 ? regional : (counts.get(key) ?? regions.length);
        if (regional < 0) counts.set(key, ordinal + 1);
        return hatchAssignmentKey(id, h.kind, undefined, ordinal);
      });
      return {
        ...h,
        assignments,
        ...(defaultHatchTier(def, h.kind, settings) ? { tier: defaultHatchTier(def, h.kind, settings) } : {}),
      };
    }),
  };
}
