import type { HatchKind, PlanLimits, Unit } from '../model/multiblock/types';
import type { RoutedKind } from '../model/routing/kinds';
import type { PlanState } from '../model/plan/types';

/**
 * Cache keys of the machine pipeline's stages (see `createPipeline`). Each key lists every input its stage
 * reads, and each builds on the one before it, so a change upstream invalidates everything after it.
 * Adding an input to a stage means adding it here; `pipelineKeys.test.ts` checks each one.
 */

/** Packing: the (sized) multiblock, count, limits, or the manual units in place of a packed layout. */
export function layoutKey(input: {
  defId: string;
  structureGlassTier?: PlanState['structureGlassTier'];
  assemblyGrowth?: PlanState['assemblyGrowth'];
  steamFrameTier?: PlanState['steamFrameTier'];
  size: number | undefined;
  count: number;
  limits: PlanLimits;
  manualUnits: readonly Unit[] | undefined;
}): string {
  const { limits, manualUnits } = input;
  return JSON.stringify([
    'layout',
    input.defId,
    input.structureGlassTier ?? null,
    input.assemblyGrowth ?? null,
    input.steamFrameTier ?? null,
    input.size ?? null,
    input.count,
    limits.x ?? null,
    limits.y ?? null,
    limits.z ?? null,
    manualUnits?.map((u) => [u.id, u.origin[0], u.origin[1], u.origin[2], u.rotation]) ?? null,
  ]);
}

/**
 * Hatches (and the layout they may loosen): the layout, enabled hatches in order, the routed kinds when an
 * auto layout is chosen for its pipes (null otherwise), and whether hatches may face down.
 */
export function hatchKey(
  layout: string,
  enabledHatches: readonly HatchKind[],
  routedLayoutKinds: readonly RoutedKind[] | null,
  below: boolean,
  tiers?: Pick<PlanState, 'voltageTier' | 'hatchTiers' | 'manualTransformerMode' | 'dataBankWireless'>,
): string {
  return JSON.stringify([
    'hatches',
    layout,
    enabledHatches,
    routedLayoutKinds,
    below,
    tiers?.voltageTier ?? null,
    tiers?.manualTransformerMode ?? null,
    tiers?.dataBankWireless ?? null,
    Object.entries(tiers?.hatchTiers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

/** Pipes and cables: the hatches and the kinds switched on. */
export function pipesKey(hatches: string, kinds: readonly RoutedKind[]): string {
  return JSON.stringify(['pipes', hatches, kinds]);
}

/** The scene: the pipes and the colour of every hatch kind. */
export function sceneKey(pipes: string, colors: Readonly<Record<HatchKind, string>>): string {
  const byKind = Object.keys(colors)
    .sort()
    .map((k) => [k, colors[k as HatchKind]]);
  return JSON.stringify(['scene', pipes, byKind]);
}
