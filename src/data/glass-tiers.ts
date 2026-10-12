import { TIERS, type Tier } from '../model/core/types';

/**
 * The tier of the glasses GT registers as tiered (`GlassTier.RegisterGlassTiers`, GT5-Unofficial 5.09.54.205),
 * by block id. A multiblock that limits its hatches by glass (`MultiblockDef.glassTierLimits`) refuses to form
 * when a hatch outruns the glass. Glass that is not listed (the planner's own `gt.glass.reinforced` stand-in,
 * other mods' glass) has no known tier.
 */

/** Tier number GT gives each glass (the index into `TIERS`: 3 = HV) by block id, then meta. */
const GLASS_TIER_NUMBERS: Readonly<Record<string, readonly (readonly [meta: number, tier: number])[]>> = {
  // Borosilicate glasses, HV (meta 0) to UXV (meta 10), one tier per meta.
  'bartworks:BW_TieredGlass': Array.from({ length: 11 }, (_, meta) => [meta, 3 + meta] as const),
  'gregtech:gt.blockglass1': [
    [0, 4],
    [10, 4],
    [1, 9],
    [2, 9],
    [7, 9],
    [8, 9],
    [3, 10],
    [4, 11],
    [9, 12],
    [5, 12],
  ],
  // Tinted Industrial Glass in all 16 colours.
  'gregtech:gt.blocktintedglass': Array.from({ length: 16 }, (_, meta) => [meta, 4] as const),
};

const BY_BLOCK_ID = new Map<string, Tier>(
  Object.entries(GLASS_TIER_NUMBERS).flatMap(([id, metas]) =>
    metas.map(([meta, tier]) => [`${id}@${meta}`, TIERS[tier]] as const),
  ),
);

/** The tier of the tiered glass a block id names (`modid:name@meta`), or undefined when it has none known. */
export function glassBlockTier(blockId: string): Tier | undefined {
  return BY_BLOCK_ID.get(blockId);
}
