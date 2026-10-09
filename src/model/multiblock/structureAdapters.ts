import type { HatchKind, LegendEntry, MultiblockDef } from './types';
import type { VoltageTier } from '../tiers';
import { VOLTAGE_TIERS } from '../tiers';
import fusionSlots from '../../data/fusion-slots.rc2.generated.json';
import crackingZones from '../../data/cracking-zones.rc2.generated.json';
import towerSlots from '../../data/tower-slots.rc2.generated.json';
import { withGlassEnergyLimit } from './glass';
import { withDedicatedHatchRegions } from './dedicatedHatches';
import { withBeamStructures } from './beamStructures';
import { withLockedFluidHatches } from './lockedFluidHatches';
import { withLinearAccelerator } from './linearAccelerator';
import { withAssemblyLine } from './assemblyLine';
import { withDataBank } from './dataBank';
import { withCircuitAssemblyLine } from './circuitAssemblyLine';
import { withSteamWaterPump } from './steamWaterPump';
import { withArcFurnace } from './arcFurnace';
import { withComputation } from './computation';

// MTEDrillerBase/MTEOilDrillInfinite/MTEVoidMiners checkMachine applies getTier to the SUM of
// input voltages, not a per-hatch minimum. Void multipliers are the registered 1/2/3 plus 5.
const minimumEnergy: Record<string, VoltageTier> = {
  'fluid-drilling-rig': 'MV',
  'fluid-drilling-rig-ii': 'HV',
  'fluid-drilling-rig-iii': 'EV',
  'fluid-drilling-rig-iv': 'IV',
  'ore-drilling-plant': 'MV',
  'ore-drilling-plant-ii': 'HV',
  'ore-drilling-plant-iii': 'EV',
  'ore-drilling-plant-iv': 'IV',
  'infinite-fluid-drilling-rig': 'UHV',
  'void-miner-i': 'LuV',
  'void-miner-ii': 'ZPM',
  'void-miners': 'UV',
  'concrete-backfiller': 'MV',
  'advanced-concrete-backfiller': 'EV',
  'deep-earth-heating-pump': 'HV',
};

const RC2_SOURCE =
  'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/src/main/java/';

/** Standard energy forms only: exotic hatches need their separate, mutually exclusive alternatives.
 * Synchrotron's adder also rejects unequal amperage; all supported standard hatches use the same class.
 */
export const REVIEWED_ENERGY_RULES: Record<
  string,
  { source: string; uniform: HatchKind[]; count?: { min: number; max: number } }
> = {
  'dimensionally-transcendent-plasma-forge': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEPlasmaForge.java',
    uniform: ['energy'],
    count: { min: 1, max: 2 },
  },
  synchrotron: {
    source: RC2_SOURCE + 'gtnhlanth/common/tileentity/MTESynchrotron.java',
    uniform: ['energy'],
    count: { min: 4, max: 4 },
  },
  'manual-transformer': {
    source: RC2_SOURCE + 'bartworks/common/tileentities/multis/MTEManualTrafo.java',
    uniform: ['energy', 'dynamo'],
  },
};

// Each checkMachine compares standard energy getTierForStructure() with the uniform glass tier.
// Other controllers (e.g. Industrial Mixer) only restrict exotic hatches and must not inherit this cap.
export const REVIEWED_GLASS_ENERGY_RULES: Record<string, string> = {
  'algae-farm': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEAlgaePond.java',
  'exothermic-hearth': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEExothermicHearth.java',
  'extreme-industrial-greenhouse':
    RC2_SOURCE + 'kubatech/tileentity/gregtech/multiblock/MTEExtremeIndustrialGreenhouse.java',
  'fluid-shaper': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEFluidShaper.java',
  'mass-solidifier': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEMassSolidifier.java',
  'mega-chemical-reactor':
    RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEMegaChemicalReactor.java',
  'mega-oil-cracker': RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEMegaOilCracker.java',
  'large-fluid-extractor':
    RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTELargeFluidExtractor.java',
  'extreme-entity-crusher':
    RC2_SOURCE + 'kubatech/tileentity/gregtech/multiblock/MTEExtremeEntityCrusher.java',
};
export const GLASS_TIER_SOURCE = RC2_SOURCE + 'gregtech/api/util/GlassTier.java';
export const GODFORGE_MODULE_IDS = [
  'helioflare-power-forge',
  'helioflux-melting-core',
  'heliothermal-plasma-fabricator',
  'heliofusion-exoticizer',
] as const;
export const GODFORGE_MODULE_HATCH_SOURCE =
  RC2_SOURCE + 'tectech/thing/metaTileEntity/multi/godforge/MTEBaseModule.java';
const CLASSIC_HATCH_BLOCKS = {
  itemIn: 'gt.hatch.inputBus',
  itemOut: 'gt.hatch.outputBus',
  fluidIn: 'gt.hatch.inputHatch',
  fluidOut: 'gt.hatch.outputHatch',
  energy: 'gt.hatch.energy',
  dynamo: 'gt.hatch.dynamo',
  maintenance: 'gt.hatch.maintenance',
  muffler: 'gt.hatch.muffler',
} as const;

/** These checks require glass but do not cap the tier of standard energy hatches. */
export const REVIEWED_GLASS_MINIMUM_RULES: Record<string, { min: VoltageTier; source: string }> = {
  'linear-accelerator': {
    min: 'LuV',
    source: RC2_SOURCE + 'gtnhlanth/common/tileentity/MTELINAC.java',
  },
  'target-chamber': {
    min: 'LuV',
    source: RC2_SOURCE + 'gtnhlanth/common/tileentity/MTETargetChamber.java',
  },
  'component-assembly-line': {
    min: 'UV',
    source: RC2_SOURCE + 'goodgenerator/blocks/tileEntity/MTEComponentAssemblyLine.java',
  },
  'precise-auto-assembler-mt-3662': {
    min: 'EV',
    source: RC2_SOURCE + 'goodgenerator/blocks/tileEntity/MTEPreciseAssembler.java',
  },
  tfft: {
    min: 'EV',
    source: RC2_SOURCE + 'kekztech/common/tileentities/MTETankTFFT.java',
  },
};

// MTEXLTurbineBase's conditional output check dispatches requiresOutputHatch(): only Gas returns false.
// Gas reports a constant 4000 pollution/s and therefore needs exactly four mufflers.
// Splitter's findCoolantHatch accepts precisely one standard InputHatch, consumed as Super Coolant.
export const REVIEWED_INTERFACE_COUNTS: Record<
  string,
  { source: string; counts: MultiblockDef['requiredHatches'] }
> = {
  'drone-centre': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/drone/MTEDroneCentre.java',
    // Both the legacy and current forms call checkHasInputBus after their piece check.
    counts: { itemIn: { min: 1 } },
  },
  'large-essentia-smeltery': {
    source: RC2_SOURCE + 'goodgenerator/blocks/tileEntity/MTELargeEssentiaSmeltery.java',
    // Its current five-block form has three mandatory Muffler.newAny cells, one in each middle slice.
    // The retained source-converted catalog's approximate max=1 is not a checkMachine constraint.
    counts: { muffler: { min: 3 } },
  },
  'xl-turbo-steam-turbine': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/xlturbines/MTEXLTurbineBase.java',
    counts: { fluidOut: { min: 1 } },
  },
  'xl-turbo-hp-steam-turbine': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/xlturbines/MTEXLTurbineBase.java',
    counts: { fluidOut: { min: 1 } },
  },
  'xl-turbo-sc-steam-turbine': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/xlturbines/MTEXLTurbineBase.java',
    counts: { fluidOut: { min: 1 } },
  },
  'xl-turbo-plasma-turbine': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/xlturbines/MTEXLTurbineBase.java',
    counts: { fluidOut: { min: 1 } },
  },
  'xl-turbo-gas-turbine': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/xlturbines/MTEXLTurbineGas.java',
    counts: { muffler: { min: 4, max: 4 } },
  },
  'superconductive-strand-splitter': {
    source:
      RC2_SOURCE +
      'gregtech/common/tileentities/machines/multi/nanochip/modules/MTESuperconductorSplitterModule.java',
    counts: { fluidIn: { min: 1, max: 1 } },
  },
};

/** construct() hints do not always use the elements that checkMachine() actually checks.
 * Keep source-reviewed corrections separate from the generated catalog.
 * RC2 MTESpargeTower: STRUCTURE_DEFINITION, checkMachine, addLayerOutputHatch, addFluidOutputs.
 */
export function withReviewedStructure(def: MultiblockDef): MultiblockDef {
  def = withLockedFluidHatches(def);
  def = withBeamStructures(def);
  def = withLinearAccelerator(def);
  def = withAssemblyLine(def);
  def = withDataBank(def);
  def = withCircuitAssemblyLine(def);
  def = withSteamWaterPump(def);
  def = withArcFurnace(def);
  def = withComputation(def);
  def = withDedicatedHatchRegions(def);
  if ((GODFORGE_MODULE_IDS as readonly string[]).includes(def.id)) {
    // MTEBaseModule's source B is only the front disc. Source C uses the same physical casing
    // in the next slice but does not call the adder; the dump collapsed B/C to one legend entry.
    const char = '\ue100';
    const front = def.layers
      .flatMap((layer) => [...layer[0]])
      .find((c) => def.legend[c]?.blockId === 'tectech:gt.godforgecasing@0');
    if (front)
      def = {
        ...def,
        layers: def.layers.map((layer) =>
          layer.map((row, z) => (z === 0 ? [...row].map((c) => (c === front ? char : c)).join('') : row)),
        ),
        legend: {
          ...def.legend,
          [char]: { ...def.legend[front], hatches: Object.keys(CLASSIC_HATCH_BLOCKS) as HatchKind[] },
        },
        hatchBlocks: { ...def.hatchBlocks, ...CLASSIC_HATCH_BLOCKS },
        shareableHatches: ['itemIn', 'itemOut', 'fluidIn', 'fluidOut'],
        ...(def.id === 'heliofusion-exoticizer'
          ? {
              requiredHatches: { ...def.requiredHatches, itemOut: { min: 1 }, fluidOut: { min: 1 } },
            }
          : {}),
      };
  }
  if (def.id === 'manual-transformer')
    def = {
      ...def,
      // checkMachine accepts 1–8 winding layers between the base and dynamo cap.
      resize: { axis: 'y', from: 1, to: 2, min: 3, max: 10, default: 3, label: 'height' },
      requiredHatches: { ...def.requiredHatches, energy: { min: 1 } },
    };
  if (def.id === 'mega-distillation-tower') {
    const layers = def.layers.map((layer) => [...layer]);
    const legend = { ...def.legend };
    for (const [
      index,
      {
        pos: [x, y, z],
        region,
      },
    ] of towerSlots.cells.entries()) {
      const char = String.fromCharCode(0xe100 + index);
      legend[char] = { ...legend[layers[y][z][x]], hatches: ['fluidOut'], region };
      layers[y][z] = layers[y][z].slice(0, x) + char + layers[y][z].slice(x + 1);
    }
    const regions = towerSlots.cells.map((cell) => cell.region);
    def = {
      ...def,
      layers,
      legend,
      resize: { ...towerSlots.repeat, axis: 'y', default: 30, label: 'height' },
      fluidOutputRegions: regions,
      interleaveFluidOutputRegions: true,
      requiredHatches: { ...def.requiredHatches, fluidOut: { min: 3, max: 3, regions } },
    };
  }
  if (def.id === 'mega-oil-cracker') {
    const layers = def.layers.map((layer) => [...layer]);
    const casing = 'gregtech:gt.blockcasings14@5';
    const legend = {
      ...def.legend,
      l: { blockId: casing, hatches: ['fluidIn'] as HatchKind[], region: 'side' },
      m: { blockId: casing, hatches: ['fluidIn'] as HatchKind[], region: 'middle' },
      r: { blockId: casing, hatches: ['fluidOut'] as HatchKind[] },
    };
    for (const [char, cells] of Object.entries(crackingZones.cells))
      for (const [x, y, z] of cells)
        layers[y][z] = layers[y][z].slice(0, x) + char + layers[y][z].slice(x + 1);
    def = {
      ...def,
      layers,
      legend,
      // checkMachine requires a side input; a catalyst binding additionally requires a middle input.
      // Unlike the small cracker it does not require an empty middle hatch before a recipe is chosen.
      requiredHatches: { ...def.requiredHatches, fluidIn: { min: 1, regions: ['side'] } },
    };
  }
  if (REVIEWED_GLASS_ENERGY_RULES[def.id]) {
    def = withGlassEnergyLimit(def);
  }
  const glassMinimum = REVIEWED_GLASS_MINIMUM_RULES[def.id];
  if (glassMinimum) def = { ...def, selectableGlass: true, minimumStructureGlassTier: glassMinimum.min };
  const interfaces = REVIEWED_INTERFACE_COUNTS[def.id];
  if (interfaces) def = { ...def, requiredHatches: { ...def.requiredHatches, ...interfaces.counts } };
  const energyRule = REVIEWED_ENERGY_RULES[def.id];
  if (energyRule)
    def = {
      ...def,
      uniformHatchTiers: energyRule.uniform,
      ...(energyRule.count ? { requiredHatches: { ...def.requiredHatches, energy: energyRule.count } } : {}),
    };
  const fusion = fusionSlots.entries[def.id as keyof typeof fusionSlots.entries];
  if (fusion) {
    const layers = def.layers.map((layer) => [...layer]);
    const legend = { ...def.legend };
    const symbols = new Map<string, string>();
    for (const [x, y, z] of fusion.cells) {
      const old = layers[y][z][x];
      let symbol = symbols.get(old);
      if (!symbol) {
        symbol = String.fromCharCode(0xe000 + symbols.size);
        symbols.set(old, symbol);
        legend[symbol] = { ...legend[old], hatches: ['energy'] };
      }
      layers[y][z] = layers[y][z].slice(0, x) + symbol + layers[y][z].slice(x + 1);
    }
    const min = VOLTAGE_TIERS[fusion.minTier];
    def = {
      ...def,
      layers,
      legend,
      hatchBlocks: { ...def.hatchBlocks, energy: 'gt.hatch.energy' },
      defaultHatches: ['fluidIn', 'fluidOut', 'energy'],
      minimumVoltageTier: min,
      hatchTierLimits: { ...def.hatchTierLimits, energy: { min } },
    };
  }
  // TileEntityModuleBase's optional adder delegates to TTMultiblockBase.addClassicToMachineList.
  // It accepts all eight standard kinds; energy is supplied by the elevator and is not required here.
  if (/^space-(assembler|pumping|mining|research|project)-/.test(def.id)) {
    const kinds: HatchKind[] = [
      'itemIn',
      'itemOut',
      'fluidIn',
      'fluidOut',
      'energy',
      'dynamo',
      'maintenance',
      'muffler',
    ];
    def = {
      ...def,
      legend: Object.fromEntries(
        Object.entries(def.legend).map(([char, cell]) => [
          char,
          cell.blockId === 'gtnhintergalactic:gt.blockcasingsSE@0' ? { ...cell, hatches: kinds } : cell,
        ]),
      ),
      hatchBlocks: {
        ...def.hatchBlocks,
        itemIn: 'gt.hatch.inputBus',
        itemOut: 'gt.hatch.outputBus',
        fluidIn: 'gt.hatch.inputHatch',
        fluidOut: 'gt.hatch.outputHatch',
        energy: 'gt.hatch.energy',
        dynamo: 'gt.hatch.dynamo',
        maintenance: 'gt.hatch.maintenance',
        muffler: 'gt.hatch.muffler',
      },
      shareableHatches: ['itemIn', 'itemOut', 'fluidIn', 'fluidOut'],
    };
  }
  if (def.id === 'reactor-fuel-processing-plant') {
    def = {
      ...def,
      legend: Object.fromEntries(
        Object.entries(def.legend).map(([char, cell]) => [
          char,
          cell.blockId === 'miscutils:gtplusplus.blockcasings.2@2'
            ? { ...cell, hatches: [...(cell.hatches ?? []), 'muffler' as const] }
            : cell,
        ]),
      ),
      hatchBlocks: { ...def.hatchBlocks, muffler: 'gt.hatch.muffler' },
      minimumVoltageTier: 'IV',
      hatchTierLimits: { muffler: { min: 'IV' } },
    };
  }
  if (def.id === 'exxonmobil-chemical-plant') {
    // The checked default shape uses LV machine casings. addChemicalPlantList accepts energy
    // even though its survival item filter advertises only the four resource interface kinds.
    const limits = { max: 'LV' as const };
    def = {
      ...def,
      legend: Object.fromEntries(
        Object.entries(def.legend).map(([char, cell]) => [
          char,
          cell.blockId === 'miscutils:gtplusplus.blockspecialcasings.2@0'
            ? { ...cell, hatches: [...(cell.hatches ?? []), 'energy' as const] }
            : cell,
        ]),
      ),
      hatchBlocks: { ...def.hatchBlocks, energy: 'gt.hatch.energy' },
      hatchTierLimits: { energy: limits, itemIn: limits, itemOut: limits, fluidIn: limits, fluidOut: limits },
    };
  }
  if (minimumEnergy[def.id])
    def = {
      ...def,
      minimumVoltageTier: minimumEnergy[def.id],
      minimumInputVoltageTier: minimumEnergy[def.id],
    };
  if (def.id === 'thorium-reactor-lftr') return thoriumReactor(def);
  if (def.id === 'dangote-distillus') return dangoteTower(def);
  if (def.id !== 'sparge-tower-controller') return def;
  const casing = 'miscutils:gtplusplus.blockcasings.5@4';
  const baseKinds: HatchKind[] = ['itemIn', 'fluidIn', 'energy', 'maintenance'];
  const legend: Record<string, LegendEntry> = {
    A: {
      blockId: casing,
      hatches: baseKinds,
    },
    // Energy and maintenance use separate unrestricted adders after the layered output adder.
    T: { blockId: casing, hatches: ['fluidOut', 'itemOut', 'maintenance'], region: 'topCenter' },
  };
  const layers = [['A~A', 'AAA', 'AAA']];
  const regions: string[] = [];
  for (let y = 1; y <= 7; y++) {
    const char = String.fromCharCode(65 + y);
    const region = `layer${y}`;
    regions.push(region);
    legend[char] = {
      blockId: casing,
      hatches: ['fluidOut', 'energy', 'maintenance'],
      region,
    };
    layers.push([char.repeat(3), `${char}${y === 7 ? 'T' : '-'}${char}`, char.repeat(3)]);
  }
  return {
    ...def,
    layers,
    legend,
    fluidOutputRegions: regions,
    hatchBlocks: { ...def.hatchBlocks, itemOut: 'gt.hatch.outputBus' },
    requiredHatches: { ...def.requiredHatches, fluidOut: { min: 1, regions: ['layer1'] } },
    defaultHatches: [...new Set([...def.defaultHatches, 'fluidOut' as const])],
  };
}

/** Standard-hatch form of MTENuclearReactor. A future ME-output form needs its separate alternative
 * minimum (one ME output instead of four standard outputs). Interior '-' is required air.
 */
function thoriumReactor(def: MultiblockDef): MultiblockDef {
  const layers = def.layers.map((layer, y) =>
    layer.map((row, z) =>
      [...row]
        .map((char, x) => (y >= 1 && y <= 2 && x >= 1 && x <= 5 && z >= 1 && z <= 5 ? '-' : char))
        .join(''),
    ),
  );
  return {
    ...def,
    layers,
    minimumVoltageTier: 'IV',
    hatchTierLimits: {
      fluidIn: { min: 'IV' },
      fluidOut: { min: 'IV' },
      muffler: { min: 'IV' },
      dynamo: { min: 'EV', max: 'LuV' },
    },
    requiredHatches: { ...def.requiredHatches, fluidOut: { min: 4 } },
  };
}

/** MTEAdvDistillationTower checks the layer element even on the top; its construct() top hint has
 * different hatch permissions. Mufflers terminate the scan, so intermediate layers cannot take one.
 * Output roles here describe the controller's default tower mode.
 */
function dangoteTower(def: MultiblockDef): MultiblockDef {
  const casing = 'gregtech:gt.blockcasings4@1';
  const baseKinds: HatchKind[] = ['itemIn', 'itemOut', 'fluidIn', 'energy', 'maintenance'];
  const sideKinds: HatchKind[] = ['fluidOut', 'energy', 'maintenance'];
  const sides: LegendEntry = {
    blockId: casing,
    hatches: sideKinds,
  };
  return {
    ...def,
    size: [3, 3, 3],
    layers: [
      ['A~A', 'AAA', 'AAA'],
      ['BBB', 'B-B', 'BBB'],
      ['CCC', 'CTC', 'CCC'],
    ],
    legend: {
      A: {
        blockId: casing,
        hatches: baseKinds,
      },
      B: { ...sides, region: 'layer' },
      C: { ...sides, hatches: [...sideKinds, 'muffler'], region: 'top' },
      T: { blockId: casing, hatches: ['fluidOut', 'itemOut', 'maintenance', 'muffler'], region: 'topCenter' },
    },
    resize: { axis: 'y', from: 1, to: 2, min: 3, max: 12, default: 3, label: 'height' },
    fluidOutputRegions: ['layer', 'top'],
    requiredHatches: { ...def.requiredHatches, fluidOut: { min: 2, regions: ['layer', 'top'] } },
    defaultHatches: [...new Set([...def.defaultHatches, 'fluidOut' as const])],
  };
}

export function hasLayeredFluidOutputs(def: MultiblockDef | undefined): boolean {
  return !!def && (def.id === 'distillation-tower' || !!def.fluidOutputRegions);
}

export function isOilCracker(def: MultiblockDef | undefined): boolean {
  return def?.id === 'oil-cracking-unit' || def?.id === 'mega-oil-cracker';
}
