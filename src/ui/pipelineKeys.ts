import type { Tier } from '../model/core/types';
import type { HatchKind, PlanLimits, Unit } from '../model/multiblock/types';
import type { HatchTiers, WallshareMode } from '../model/plan/types';
import type { RoutedKind } from '../model/routing/kinds';

/**
 * Cache keys of the machine pipeline's stages (see `createPipeline`). Each key lists every input its stage
 * reads, and each builds on the one before it, so a change upstream invalidates everything after it.
 * Adding an input to a stage means adding it here; `pipelineKeys.test.ts` checks each one.
 */

/**
 * Packing: the (sized, maybe mirrored) multiblock, count, limits and wall sharing preference, or the manual
 * units in place of a packed layout.
 */
export function layoutKey(input: {
  defId: string;
  size: number | undefined;
  count: number;
  limits: PlanLimits;
  mirror: boolean;
  wallshare: WallshareMode | undefined;
  manualUnits: readonly Unit[] | undefined;
}): string {
  const { limits, manualUnits } = input;
  return JSON.stringify([
    'layout',
    input.defId,
    input.size ?? null,
    input.count,
    input.mirror,
    input.wallshare ?? 'auto',
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
): string {
  return JSON.stringify(['hatches', layout, enabledHatches, routedLayoutKinds, below]);
}

/** Pipes and cables: the hatches and the kinds switched on. */
export function pipesKey(hatches: string, kinds: readonly RoutedKind[]): string {
  return JSON.stringify(['pipes', hatches, kinds]);
}

/**
 * Validity (what the game's structure check would object to): the pipes, which turn the hatches, and the
 * tiers the glass check compares (machine tier, hatch tier overrides, glass tier).
 */
export function validityKey(
  pipes: string,
  tiers: { tier: Tier | undefined; hatchTiers: HatchTiers | undefined; glassTier: Tier | undefined },
): string {
  const overrides = Object.entries(tiers.hatchTiers ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(['validity', pipes, tiers.tier ?? null, overrides, tiers.glassTier ?? null]);
}

/** The scene: the pipes and the colour of every hatch kind. */
export function sceneKey(pipes: string, colors: Readonly<Record<HatchKind, string>>): string {
  const byKind = Object.keys(colors)
    .sort()
    .map((k) => [k, colors[k as HatchKind]]);
  return JSON.stringify(['scene', pipes, byKind]);
}
