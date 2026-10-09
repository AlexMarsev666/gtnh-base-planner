import type { HatchKind, MultiblockDef } from './types';

const RC2_SOURCE =
  'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/src/main/java/';
export const LOCKED_FLUID_HATCH_RULES = {
  'cryogenic-freezer': {
    kind: 'cryotheumIn',
    fluid: 'cryotheum',
    meta: 967,
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTECryogenicFreezer.java',
  },
  volcanus: {
    kind: 'pyrotheumIn',
    fluid: 'pyrotheum',
    meta: 968,
    source:
      RC2_SOURCE +
      'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/advanced/MTEAdvEBF.java',
  },
} as const;

/** The custom fluid class enters its own list, never the ordinary recipe input list. */
export function withLockedFluidHatches(def: MultiblockDef): MultiblockDef {
  const rule = LOCKED_FLUID_HATCH_RULES[def.id as keyof typeof LOCKED_FLUID_HATCH_RULES];
  if (!rule) return def;
  const legend = Object.fromEntries(
    Object.entries(def.legend).map(([char, entry]) => [
      char,
      entry.hatches?.includes('fluidIn')
        ? { ...entry, hatches: [...entry.hatches, rule.kind] as HatchKind[] }
        : entry,
    ]),
  );
  return {
    ...def,
    source: rule.source,
    legend,
    // Freezer's source uses skipped spaces, not AIR markers. Volcanus explicitly requires its two air cells.
    ...(def.id === 'cryogenic-freezer'
      ? { layers: def.layers.map((layer) => layer.map((row) => row.replaceAll('-', ' '))) }
      : {}),
    hatchBlocks: { ...def.hatchBlocks, [rule.kind]: `gregtech:gt.blockmachines@${rule.meta}` },
    requiredHatches: { ...def.requiredHatches, [rule.kind]: { min: 1 } },
    lockedFluidInputs: { [rule.kind]: rule.fluid },
    shareableHatches: [...def.shareableHatches, rule.kind],
  };
}
