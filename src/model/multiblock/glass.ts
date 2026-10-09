import variants from '../../data/glass-variants.runtime.generated.json';
import type { MultiblockDef } from './types';
import { VOLTAGE_TIERS, type VoltageTier } from '../tiers';

export const BOROSILICATE_GLASS_TIERS = variants.map((v) => v.tier as VoltageTier);

/** GlassTier.RegisterGlassTiers: BW_ExtraGlass has a different, non-consecutive metadata order. */
export function borosilicateTier(block: string): number | undefined {
  const match = /^bartworks:(BW_TieredGlass|BW_ExtraGlass)@(\d+)$/.exec(block);
  if (!match) return undefined;
  const meta = Number(match[2]);
  if (match[1] === 'BW_TieredGlass') return meta <= 10 ? meta + 3 : undefined;
  return meta === 0 ? 5 : meta <= 5 ? meta + 8 : undefined;
}

/** Reinforced glass's existing planner alias uses GT BlockGlass1 meta 10, also registered as EV. */
export function glassBlockTier(block: string): number | undefined {
  return block === 'gt.glass.reinforced' || /^gregtech:gt.blockglass1@(0|10)$/.test(block)
    ? 4
    : borosilicateTier(block);
}

/** The weakest glass actually present in the structure, ignoring unused legend entries. */
export function structureGlassTier(def: MultiblockDef): VoltageTier | undefined {
  const used = new Set(def.layers.flatMap((layer) => layer.flatMap((row) => [...row])));
  const tiers = [...used]
    .map((char) => def.legend[char] && glassBlockTier(def.legend[char].blockId))
    .filter((tier): tier is number => tier !== undefined);
  return tiers.length ? VOLTAGE_TIERS[Math.min(...tiers)] : undefined;
}

/** MTETankTFFT indexes Field.VALUES by meta - 1; T10 (@10) alone costs zero EU/t. */
export function minimumGlassTier(def: MultiblockDef): VoltageTier | undefined {
  if (def.id === 'tfft') {
    const used = new Set(def.layers.flatMap((layer) => layer.flatMap((row) => [...row])));
    const consumesPower = [...used].some((char) =>
      /^kekztech:kekztech_tfftstoragefield_block@[1-9]$/.test(def.legend[char]?.blockId ?? ''),
    );
    if (!consumesPower) return undefined;
  }
  return def.minimumStructureGlassTier;
}

export function withGlassEnergyLimit(def: MultiblockDef): MultiblockDef {
  const tiers = Object.values(def.legend)
    .map((c) => glassBlockTier(c.blockId))
    .filter((n): n is number => n !== undefined);
  if (!tiers.length) return def;
  const max = VOLTAGE_TIERS[Math.min(...tiers)];
  return {
    ...def,
    selectableGlass: true,
    glassLimitsEnergy: true,
    hatchTierLimits: {
      ...def.hatchTierLimits,
      energy: { ...def.hatchTierLimits?.energy, max, reason: `structure glass tier ${max}` },
    },
  };
}

const cache = new WeakMap<MultiblockDef, Map<VoltageTier, MultiblockDef>>();
/** Replace only source-reviewed tiered glass cells; absent settings preserve the original catalog form. */
export function withStructureGlass(def: MultiblockDef, tier?: VoltageTier): MultiblockDef {
  if (!tier || !def.selectableGlass) return def;
  const variant = variants.find((v) => v.tier === tier);
  if (!variant) return def; // Saved unsupported settings remain intact and validation reports them.
  let byTier = cache.get(def);
  if (!byTier) cache.set(def, (byTier = new Map()));
  let result = byTier.get(tier);
  if (!result) {
    const legend = Object.fromEntries(
      Object.entries(def.legend).map(([char, cell]) => [
        char,
        glassBlockTier(cell.blockId) !== undefined ? { ...cell, blockId: variant.id } : cell,
      ]),
    );
    result = { ...def, legend };
    if (def.glassLimitsEnergy) result = withGlassEnergyLimit(result);
    byTier.set(tier, result);
  }
  return result;
}
