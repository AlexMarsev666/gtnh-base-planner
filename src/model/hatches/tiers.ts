import type { HatchKind, MultiblockDef } from '../multiblock/types';
import type { PlanState } from '../plan/types';
import { VOLTAGE_TIERS, type VoltageTier } from '../tiers';

const STANDARD_TIERED_HATCHES = new Set([
  'gt.hatch.inputBus',
  'gt.hatch.outputBus',
  'gt.hatch.inputHatch',
  'gt.hatch.outputHatch',
  'gt.hatch.energy',
  'gt.hatch.dynamo',
  'gt.hatch.muffler',
  'gt.hatch.dataAccess',
  'gt.hatch.uncertainty',
]);

/** Coke Oven and steam interfaces are fixed registered blocks, not tiered GT buses/hatches. */
export function supportsHatchTier(def: MultiblockDef, kind: HatchKind): boolean {
  return STANDARD_TIERED_HATCHES.has(def.hatchBlocks[kind] ?? '');
}

/** ManualTrafo.checkProcessing: signed output/input tier difference equals the winding count.
 * An unavailable tier stays unspecified and is reported by validation; it is never clamped.
 */
export function defaultHatchTier(
  def: MultiblockDef,
  kind: HatchKind,
  settings: Pick<PlanState, 'voltageTier' | 'manualTransformerMode'>,
): VoltageTier | undefined {
  if (!supportsHatchTier(def, kind)) return undefined;
  if (kind === 'dataAccess') return 'EV';
  if (kind === 'uncertainty') return 'IV';
  if (def.id !== 'manual-transformer' || kind !== 'dynamo' || !settings.voltageTier)
    return settings.voltageTier;
  const windingLayers = def.size[1] - 2;
  const output =
    VOLTAGE_TIERS.indexOf(settings.voltageTier) +
    (settings.manualTransformerMode === 'down' ? -windingLayers : windingLayers);
  return output >= 0 && output < VOLTAGE_TIERS.length ? VOLTAGE_TIERS[output] : undefined;
}
