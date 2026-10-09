import source from '../../data/steam-water-pump.rc2.generated.json';
import type { MultiblockDef } from './types';

export type SteamFrameTier = 'bronze' | 'steel';

/** The steam input uses its own superclass list, and all frames must have the same material. */
export function withSteamWaterPump(def: MultiblockDef): MultiblockDef {
  if (def.id !== 'water-pump') return def;
  return {
    ...def,
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.source}`,
    size: source.size as [number, number, number],
    layers: source.layers,
    legend: {
      A: { blockId: source.frames.bronze.blockId },
      C: { blockId: 'gregtech:gt.blockcasings9@2', hatches: ['steamIn', 'fluidOut'] },
    },
    hatchBlocks: {
      steamIn: `gregtech:gt.blockmachines@${source.steamHatch.meta}`,
      fluidOut: 'gt.hatch.outputHatch',
    },
    requiredHatches: { steamIn: { min: 1, max: 1 }, fluidOut: { min: 1, max: 1 } },
    defaultHatches: ['steamIn', 'fluidOut'],
    shareableHatches: ['steamIn', 'fluidOut'],
    lockedFluidInputs: { steamIn: 'steam' },
    fixedFluidOutputs: { fluidOut: 'water' },
  };
}

const variants = new WeakMap<MultiblockDef, MultiblockDef>();
/** Absent frame choice retains the historical bronze form. Applied copies remain safe to reuse. */
export function withSteamFrame(def: MultiblockDef, frame?: SteamFrameTier): MultiblockDef {
  if (def.id !== 'water-pump') return def;
  const blockId = source.frames[frame ?? 'bronze'].blockId;
  if (def.legend.A.blockId === blockId) return def;
  let result = variants.get(def);
  if (!result) {
    result = { ...def, legend: { ...def.legend, A: { ...def.legend.A, blockId } } };
    variants.set(def, result);
  }
  return result;
}
