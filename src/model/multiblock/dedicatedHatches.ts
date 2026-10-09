import type { MultiblockDef } from './types';

const RC2_SOURCE =
  'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/src/main/java/';

/** Custom adders retain their hatch in a dedicated field, rather than mInputHatches/mOutputHatches.
 * checkMachine also requires the ordinary list. Both interfaces must therefore be present.
 */
export const REVIEWED_DEDICATED_HATCHES = {
  'high-temperature-gas-cooled-reactor':
    RC2_SOURCE + 'kubatech/tileentity/gregtech/multiblock/MTEHighTempGasCooledReactor.java',
  'large-heat-exchanger': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEHeatExchanger.java',
  'target-chamber': RC2_SOURCE + 'gtnhlanth/common/tileentity/MTETargetChamber.java',
  'extreme-heat-exchanger': RC2_SOURCE + 'goodgenerator/blocks/tileEntity/MTEExtremeHeatExchanger.java',
  'ph-neutralization-purification-unit':
    RC2_SOURCE +
    'gregtech/common/tileentities/machines/multi/purification/MTEPurificationUnitPhAdjustment.java',
  'extreme-temperature-fluctuation-purification-unit':
    RC2_SOURCE +
    'gregtech/common/tileentities/machines/multi/purification/MTEPurificationUnitPlasmaHeater.java',
} as const;

export function withDedicatedHatchRegions(def: MultiblockDef): MultiblockDef {
  if (def.id === 'high-temperature-gas-cooled-reactor')
    return {
      ...def,
      // Source transpose mirrors x and reverses y: local [27-x,14-y,z-1]. Source c/w and h/s
      // use separate fields despite having identical input/output placeholder block IDs in the dump.
      layers: def.layers.map((layer, y) =>
        layer.map((row) =>
          [...row]
            .map((char) => (char === 'Q' && y === 8 ? 'T' : char === 'O' && y === 3 ? 'U' : char))
            .join(''),
        ),
      ),
      legend: {
        ...def.legend,
        I: { ...def.legend.I, region: 'helium' },
        Q: { ...def.legend.Q, region: 'coolantIn' },
        T: { ...def.legend.Q, region: 'water' },
        O: { ...def.legend.O, region: 'coolantOut' },
        U: { ...def.legend.O, region: 'steam' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        fluidIn: { min: 3, max: 3, regions: ['helium', 'coolantIn', 'water'] },
        fluidOut: { min: 2, max: 2, regions: ['coolantOut', 'steam'] },
      },
      defaultHatches: [...def.defaultHatches, 'fluidIn', 'fluidOut'],
      resourceHatchRegions: {
        fluidIn: { helium: 'helium', coolant: 'coolantIn', water: 'water' },
        fluidOut: { hotFluid: 'coolantOut', steam: 'steam' },
      },
    };
  if (def.id === 'large-heat-exchanger')
    return {
      ...def,
      legend: {
        ...def.legend,
        c: { ...def.legend.c, region: 'water' },
        H: { ...def.legend.H, region: 'hot' },
        O: { ...def.legend.O, region: 'cold' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        fluidIn: { min: 2, regions: ['hot', 'water'] },
        fluidOut: { min: 2, regions: ['cold', 'water'] },
      },
      resourceHatchRegions: {
        fluidIn: { hotFluid: 'hot', water: 'water' },
        fluidOut: { coldFluid: 'cold', steam: 'water' },
      },
    };
  if (def.id === 'target-chamber') {
    // Source l registers mMaskInputBusses, while t registers the ordinary mInputBusses.
    // Both placeholders collapse to L in the dump; l is the upper cell nearest the controller.
    return {
      ...def,
      layers: def.layers.map((layer, y) =>
        layer.map((row, z) =>
          [...row].map((char, x) => (char === 'L' && y === 4 && z === 1 && x === 2 ? 'M' : char)).join(''),
        ),
      ),
      legend: {
        ...def.legend,
        M: { ...def.legend.L, region: 'mask' },
        L: { ...def.legend.L, region: 'feed' },
        H: { blockId: 'gregtech:gt.blockmachines@10503', facing: 'north' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        itemIn: { min: 2, max: 2, regions: ['mask', 'feed'] },
      },
      resourceHatchRegions: { itemIn: { mask: 'mask', feed: 'feed' } },
    };
  }
  if (def.id === 'extreme-heat-exchanger') {
    return {
      ...def,
      legend: {
        ...def.legend,
        B: { ...def.legend.B, region: 'water' },
        F: { ...def.legend.F, region: 'hot' },
        G: { ...def.legend.G, region: 'cold' },
        H: { ...def.legend.H, region: 'steam' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        fluidIn: { min: 2, regions: ['hot', 'water'] },
        fluidOut: { min: 2, regions: ['cold', 'steam'] },
      },
      resourceHatchRegions: {
        fluidIn: { hotFluid: 'hot', water: 'water' },
        fluidOut: { coldFluid: 'cold', steam: 'steam' },
      },
    };
  }
  if (def.id === 'ph-neutralization-purification-unit') {
    return {
      ...def,
      legend: {
        ...def.legend,
        E: { ...def.legend.E, region: 'water' },
        F: { ...def.legend.F, region: 'acid' },
        G: { ...def.legend.G, region: 'alkaline' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        fluidIn: { min: 2, regions: ['acid', 'water'] },
        fluidOut: { min: 1, regions: ['water'] },
        itemIn: { min: 1, regions: ['alkaline'] },
      },
      resourceHatchRegions: {
        fluidIn: { acid: 'acid', water: 'water' },
        fluidOut: { product: 'water' },
        itemIn: { alkaline: 'alkaline' },
      },
    };
  }
  if (def.id === 'extreme-temperature-fluctuation-purification-unit') {
    // Source K and P are distinct mandatory adders. The dump used one placeholder for both.
    // In the planner's north-facing frame K is (7,0,0); P is (22,0,7).
    const layers = def.layers.map((layer, y) =>
      layer.map((row, z) =>
        [...row].map((char, x) => (char === 'B' && y === 0 && z === 7 && x === 22 ? 'P' : char)).join(''),
      ),
    );
    return {
      ...def,
      layers,
      legend: {
        ...def.legend,
        B: { ...def.legend.B, region: 'coolant' },
        P: { ...def.legend.B, region: 'plasma' },
        D: { ...def.legend.D, region: 'water' },
      },
      requiredHatches: {
        ...def.requiredHatches,
        fluidIn: { min: 3, regions: ['coolant', 'plasma', 'water'] },
        fluidOut: { min: 1, regions: ['water'] },
      },
      resourceHatchRegions: {
        fluidIn: { coolant: 'coolant', plasma: 'plasma', water: 'water' },
        fluidOut: { product: 'water' },
      },
    };
  }
  return def;
}
