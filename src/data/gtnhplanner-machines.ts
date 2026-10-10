import { catalog } from './catalog';
import gtMachineTypes from './gt-machine-types.generated.json';
import { SINGLE_MACHINES } from './single-machines';

/**
 * How GTNH Planner (gtnhplanner.com) names machines, mapped to what a site can build.
 *
 * Their recipes carry `machineType` (the NEI recipe map name, e.g. "Blast Furnace") and optionally a
 * machine handler label (e.g. "Electric Blast Furnace"). Catalog multiblocks match by their own name
 * automatically; this file only lists the other spellings, plus names that are GT single-block machines
 * and names that are not machines at all (passive sources, sinks, hand crafting).
 *
 * All keys are lower case.
 */

/** Other names of catalog multiblocks. */
export const MULTIBLOCK_ALIASES: Readonly<Record<string, string>> = {
  'blast furnace': 'electric-blast-furnace',
  ebf: 'electric-blast-furnace',
  'oil cracker': 'oil-cracking-unit',
  'oil cracking': 'oil-cracking-unit',
  lcr: 'large-chemical-reactor',
  'large chemical reactor': 'large-chemical-reactor',
  'assembling line': 'assembly-line',
  'primitive blast furnace': 'bricked-blast-furnace',
  'pyrolyse oven': 'pyrolyse-oven',
  'pyrolysis oven': 'pyrolyse-oven',
  'vacuum freezer': 'vacuum-freezer',
  'distillation tower': 'distillation-tower',
  'coke oven': 'coke-oven',
  'multi smelter': 'multi-smelter',
  'implosion compressor': 'implosion-compressor',
  'turbocan pro': 'turbocan-pro',
  'industrial autoclave': 'industrial-autoclave',
  'dissection apparatus': 'dissection-apparatus',
  'big barrel brewery': 'big-barrel-brewery',
  'large fluid extractor': 'large-fluid-extractor',
  'large heat exchanger': 'large-heat-exchanger',
  'large combustion engine': 'large-combustion-engine',
  'extreme combustion engine': 'extreme-combustion-engine',
  'large gas turbine': 'large-gas-turbine',
  'large steam turbine': 'large-steam-turbine',
  'large hp steam turbine': 'large-hp-steam-turbine',
  'large high pressure steam turbine': 'large-hp-steam-turbine',
  'large plasma turbine': 'large-plasma-turbine',
  'large supercritical steam turbine': 'large-supercritical-steam-turbine',
  'large semifluid generator': 'large-semifluid-generator',
  'large bronze boiler': 'large-bronze-boiler',
  'large steel boiler': 'large-steel-boiler',
  'large titanium boiler': 'large-titanium-boiler',
  'large tungstensteel boiler': 'large-tungstensteel-boiler',
  // GT++ recipe maps shared by the industrial multiblocks ("Multiblock Electrolyzer" and so on).
  'multiblock electrolyzer': 'industrial-electrolyzer',
  'multiblock centrifuge': 'industrial-centrifuge',
  'multiblock mixer': 'industrial-mixing-machine',
  // GT++ recipe map of the IsaMill.
  milling: 'isamill-grinding-machine',
  'assemblyline process': 'assembly-line',
  // Water purification plant recipe maps, one per unit.
  clarifier: 'clarifier-purification-unit',
  ozonation: 'ozonation-purification-unit',
  flocculation: 'flocculation-purification-unit',
  'ph neutralization': 'ph-neutralization-purification-unit',
  'extreme temperature fluctuation': 'extreme-temperature-fluctuation-purification-unit',
  'high energy laser': 'high-energy-laser-purification-unit',
  'residual decontaminant degasser': 'residual-decontaminant-degasser-purification-unit',
  'absolute baryonic perfection': 'absolute-baryonic-perfection-purification-unit',
  // GT++ names its fuel cells "Mk I", where the catalog says "Mk-I".
  'solid-oxide fuel cell mk i': 'solid-oxide-fuel-cell-mk-i',
  'solid-oxide fuel cell mk ii': 'solid-oxide-fuel-cell-mk-ii',
};

/** GT single-block machines (recipe map names). */
export const SINGLE_BLOCK_NAMES: ReadonlySet<string> = new Set([
  // Every machine that has a look of its own (src/data/single-machines.json).
  ...SINGLE_MACHINES.flatMap((m) => m.names),
  'alloy smelter',
  'amplifabricator',
  'arc furnace',
  'assembler',
  'autoclave',
  'bender',
  'brewery',
  'canner',
  'centrifuge',
  'chemical bath',
  'chemical reactor',
  'circuit assembler',
  'compressor',
  'cutting machine',
  'distillery',
  'electric furnace',
  'electrolyzer',
  'electromagnetic polarizer',
  'electromagnetic separator',
  'extractor',
  'extruder',
  'fermenter',
  'fluid canner',
  'fluid extractor',
  'fluid heater',
  'fluid solidifier',
  'forge hammer',
  'forming press',
  'furnace',
  'lathe',
  'laser engraver',
  'macerator',
  'mass fabricator',
  'microwave',
  'mixer',
  'ore washer',
  'ore washing machine',
  'packager',
  'plasma arc furnace',
  'polarizer',
  'precision laser engraver',
  'printer',
  'pump',
  'recycler',
  'replicator',
  'rock breaker',
  'scanner',
  'sifter',
  // GTNH Planner's cell emptying: a tank block (or fluid canner) in game.
  'tank',
  'slicer',
  'thermal centrifuge',
  'unpackager',
  'wiremill',
  'wire mill',
  'industrial apiary',
]);

/** Not machines that need a place on the site: they become boundary ports. */
export const SOURCE_NAMES: ReadonlySet<string> = new Set([
  'source',
  'source hatch',
  'producer',
  'crop farm',
  'bee produce',
  'ic2 crop',
  'crop manager',
  'ore vein',
  'small ore',
  'underground fluid',
]);

/** Sinks that destroy what they get. */
export const VOID_NAMES: ReadonlySet<string> = new Set(['trash can', 'void', 'trash']);

/** Not placed at all (hand crafting, Thaumcraft). */
export const SKIP_NAMES: ReadonlySet<string> = new Set([
  'shaped crafting',
  'shapeless crafting',
  'crafting',
  'thaumcraft essentia smelting',
]);

/** Recipe kinds (their `recipe.kind`) that are passive sources. */
export const SOURCE_KINDS: ReadonlySet<string> = new Set([
  'bee_produce',
  'crop_produce',
  'ore_vein',
  'small_ore',
  'underground_fluid',
]);

const byName = new Map<string, string>(catalog.map((d) => [d.name.toLowerCase(), d.id]));

/** Catalog id for a machine name, or undefined. */
export function multiblockForName(name: string): string | undefined {
  const k = name.trim().toLowerCase();
  return byName.get(k) ?? (Object.hasOwn(MULTIBLOCK_ALIASES, k) ? MULTIBLOCK_ALIASES[k] : undefined);
}

/**
 * Machine types GT names in multiblock tooltips (`getMachineType()`), e.g. "Vacuum Furnace" for the
 * Utupu-Tanuri, written by `tools/gt-source/machine-types.mjs`. Many of them are also single-block machines
 * ("Electrolyzer"), so the import tries them only for names that are not.
 */
export const GT_MACHINE_TYPES: Readonly<Record<string, string>> = gtMachineTypes;

/** Catalog id of the only multiblock GT gives this machine type, or undefined. */
export function multiblockForMachineType(name: string): string | undefined {
  const k = name.trim().toLowerCase();
  return Object.hasOwn(GT_MACHINE_TYPES, k) ? GT_MACHINE_TYPES[k] : undefined;
}
