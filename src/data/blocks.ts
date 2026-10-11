/**
 * Block registry: every blockId used by multiblock JSON files must be listed here.
 * `color` is the flat colour for SIMPLE view and the fallback for DETAILED.
 * Texture mapping for DETAILED view lives in `src/render/textures.json` (owned by the renderer).
 * Additive changes only: other work units rely on these ids.
 * Blocks used only by generated catalog entries live in `./blocks.generated.json` (tools/game-dump).
 */
import generatedBlocks from './blocks.generated.json' with { type: 'json' };
import {
  SINGLE_MACHINES,
  machineLookName,
  parseMachineLookId,
  singleMachineBlockId,
} from './single-machines';

export interface BlockInfo {
  id: string;
  name: string;
  color: string;
}

const list: BlockInfo[] = [
  // Coke Oven (GT:NH 2.9+)
  { id: 'gt.cokeOvenBrick', name: 'Coke Oven Bricks', color: '#a0654a' },
  { id: 'gt.cokeOvenController', name: 'Coke Oven', color: '#6b3b2a' },
  { id: 'gt.cokeOvenHatch', name: 'Coke Oven Hatch', color: '#7a4a35' },

  // Common GT machine casings
  { id: 'gt.casing.heatProof', name: 'Heat Proof Machine Casing', color: '#b8a58c' },
  { id: 'gt.casing.frostProof', name: 'Frost Proof Machine Casing', color: '#b9d7e6' },
  { id: 'gt.casing.solidSteel', name: 'Solid Steel Machine Casing', color: '#8f959c' },
  { id: 'gt.casing.cleanStainless', name: 'Clean Stainless Steel Machine Casing', color: '#c9ced4' },
  { id: 'gt.casing.stableTitanium', name: 'Stable Titanium Machine Casing', color: '#9d93b0' },
  { id: 'gt.casing.chemicallyInert', name: 'Chemically Inert Machine Casing', color: '#e3e3dc' },
  { id: 'gt.casing.ptfePipe', name: 'PTFE Pipe Machine Casing', color: '#f1f1ee' },
  { id: 'gt.casing.ulv', name: 'ULV Machine Casing', color: '#6f6f6f' },
  { id: 'gt.casing.bronzePlated', name: 'Bronze Plated Bricks', color: '#b07a3c' },
  { id: 'gt.casing.steelSolid', name: 'Solid Steel Machine Casing', color: '#8f959c' },
  { id: 'gt.casing.bronzeFirebox', name: 'Bronze Firebox Casing', color: '#9c6a33' },
  { id: 'gt.casing.steelFirebox', name: 'Steel Firebox Casing', color: '#6e747a' },
  { id: 'gt.casing.robustTungstensteel', name: 'Robust Tungstensteel Machine Casing', color: '#4b5058' },
  { id: 'gt.coil.cupronickel', name: 'Cupronickel Coil Block', color: '#c9844f' },
  { id: 'gt.glass.reinforced', name: 'Reinforced Glass', color: '#cfe6ee' },

  // Generic controllers and hatches (flat colours; hatches are recoloured by kind in SIMPLE view)
  { id: 'gt.controller', name: 'Multiblock Controller', color: '#3d4247' },
  { id: 'gt.hatch.inputBus', name: 'Input Bus', color: '#5b6168' },
  { id: 'gt.hatch.outputBus', name: 'Output Bus', color: '#5b6168' },
  { id: 'gt.hatch.inputHatch', name: 'Input Hatch', color: '#5b6168' },
  { id: 'gt.hatch.outputHatch', name: 'Output Hatch', color: '#5b6168' },
  { id: 'gt.hatch.energy', name: 'Energy Hatch', color: '#5b6168' },
  { id: 'gt.hatch.dynamo', name: 'Dynamo Hatch', color: '#5b6168' },
  { id: 'gt.hatch.maintenance', name: 'Maintenance Hatch', color: '#5b6168' },
  { id: 'gt.hatch.muffler', name: 'Muffler Hatch', color: '#5b6168' },

  // Added by the multiblock catalog (unit 9)
  { id: 'gt.casing.firebricks', name: 'Firebricks', color: '#8e5a3c' },
  { id: 'gt.casing.titaniumPipe', name: 'Titanium Pipe Casing', color: '#a89cb8' },
  { id: 'gt.casing.steelPipe', name: 'Steel Pipe Casing', color: '#7d848b' },
  { id: 'gt.casing.pyrolyseOven', name: 'Pyrolyse Oven Casing', color: '#6d5a4a' },
  { id: 'gt.casing.itemPipeTin', name: 'Tin Item Pipe Casing', color: '#b4b8bd' },
  { id: 'gt.casing.reinforcedWooden', name: 'Reinforced Wooden Casing', color: '#8a6a43' },
  { id: 'gt.frame.steel', name: 'Steel Frame Box', color: '#6f767d' },
  // Added with the GT:NH 2.9 catalog expansion (steam multiblocks, boilers, turbines, engines, ...)
  { id: 'gt.casing.bronzeGearbox', name: 'Bronze Gear Box Casing', color: '#a8773f' },
  { id: 'gt.casing.steelGearbox', name: 'Steel Gear Box Casing', color: '#80878e' },
  { id: 'gt.casing.titaniumGearbox', name: 'Titanium Gear Box Casing', color: '#a99fb9' },
  { id: 'gt.casing.bronzePipe', name: 'Bronze Pipe Casing', color: '#b3823f' },
  { id: 'gt.casing.tungstensteelPipe', name: 'Tungstensteel Pipe Casing', color: '#555b66' },
  { id: 'gt.casing.pbiPipe', name: 'PBI Pipe Casing', color: '#5a5048' },
  { id: 'gt.casing.titaniumFirebox', name: 'Titanium Firebox Casing', color: '#9a8fae' },
  { id: 'gt.casing.tungstensteelFirebox', name: 'Tungstensteel Firebox Casing', color: '#4f5560' },
  { id: 'gt.casing.turbine', name: 'Turbine Casing', color: '#8d949b' },
  { id: 'gt.casing.turbineStainless', name: 'Stainless Steel Turbine Casing', color: '#c3c9cf' },
  { id: 'gt.casing.turbineTitanium', name: 'Titanium Turbine Casing', color: '#a197b4' },
  { id: 'gt.casing.turbineSC', name: 'Supercritical Fluid Turbine Casing', color: '#6b6f78' },
  { id: 'gt.casing.turbineTungstensteel', name: 'Tungstensteel Turbine Casing', color: '#50565f' },
  { id: 'gt.casing.engineIntake', name: 'Engine Intake Casing', color: '#9ea4aa' },
  { id: 'gt.casing.extremeEngineIntake', name: 'Extreme Engine Intake Casing', color: '#5d636b' },
  { id: 'gt.casing.grate', name: 'Grate Machine Casing', color: '#6e7479' },
  { id: 'gt.casing.assembler', name: 'Assembler Machine Casing', color: '#9aa3ab' },
  { id: 'gt.casing.assemblyLine', name: 'Assembly Line Casing', color: '#7f8a93' },
  { id: 'gt.casing.pressureContainment', name: 'Pressure Containment Casing', color: '#7b8189' },
  { id: 'gt.coil.solenoid', name: 'Solenoid Superconductor Coil', color: '#5d7f9e' },
  { id: 'gt.frame.bronze', name: 'Bronze Frame Box', color: '#b07a3c' },
  { id: 'gt.frame.iron', name: 'Iron Frame Box', color: '#c8c8c8' },
  { id: 'gt.frame.stainless', name: 'Stainless Steel Frame Box', color: '#c8c8dc' },
  { id: 'gt.frame.titanium', name: 'Titanium Frame Box', color: '#dca0f0' },
  { id: 'gt.frame.pbi', name: 'Polybenzimidazole Frame Box', color: '#2d2d2d' },
  { id: 'gt.frame.tungstensteel', name: 'Tungstensteel Frame Box', color: '#6464a0' },
  { id: 'gt.frame.ptfe', name: 'Polytetrafluoroethylene Frame Box', color: '#646464' },
  { id: 'gt.frame.blackSteel', name: 'Black Steel Frame Box', color: '#646464' },
  { id: 'mc.ironBlock', name: 'Block of Iron', color: '#d8d8d8' },
  { id: 'gt.hatch.steamInput', name: 'Steam Input Hatch', color: '#8a6a3e' },
  { id: 'gt.hatch.steamInputBus', name: 'Steam Input Bus', color: '#8a6a3e' },
  { id: 'gt.hatch.steamOutputBus', name: 'Steam Output Bus', color: '#8a6a3e' },
  // Industrial Centrifuge (GT:NH 2.9)
  { id: 'gtpp.casing.centrifuge', name: 'Centrifuge Casing', color: '#7e5f29' },
  { id: 'gtpp.casing.largeSieveGrate', name: 'Large Sieve Grate', color: '#6a5252' },
  { id: 'gt.frame.eglinSteel', name: 'Eglin Steel Frame Box', color: '#8b4513' },
  // Site stand-ins (src/data/generic.ts) and boundary ports
  { id: 'site.singleblock', name: 'Single-block Machine', color: '#7c848c' },
  { id: 'site.placeholder', name: 'Placeholder Casing', color: '#c7b3d9' },
  { id: 'site.port.item', name: 'Item Port', color: '#d9a441' },
  { id: 'site.port.fluid', name: 'Fluid Port', color: '#4f9fcf' },
  { id: 'site.port.power', name: 'Power Port', color: '#d8c04a' },
];

/** Blocks of the generated catalog entries (tools/game-dump); hand-made entries above win. */
const generated: BlockInfo[] = generatedBlocks;

/** The look of each GT single-block machine in a template (src/data/single-machines.json). */
const machines: BlockInfo[] = SINGLE_MACHINES.map((m) => ({
  id: singleMachineBlockId(m.id),
  name: m.name,
  color: '#7c848c',
}));

export const BLOCKS: Readonly<Record<string, BlockInfo>> = Object.fromEntries(
  [...generated, ...machines, ...list].map((b) => [b.id, b]),
);

/** Tiered looks resolved so far (only valid ids are kept, a few hundred at most). */
const lookInfo = new Map<string, BlockInfo>();

export function blockInfo(id: string): BlockInfo {
  const known = BLOCKS[id];
  if (known) return known;
  // The tiered looks of single-block machines are not listed one by one: their id says what they are.
  const cached = lookInfo.get(id);
  if (cached) return cached;
  const look = parseMachineLookId(id);
  if (!look) return { id, name: id, color: '#999999' };
  const info = { id, name: machineLookName(look), color: '#7c848c' };
  lookInfo.set(id, info);
  return info;
}
