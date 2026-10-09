import source from '../../data/assembly-line.rc2.generated.json';
import type { LegendEntry, MultiblockDef } from './types';
import { DATA_INPUT_KINDS, DATA_INTERFACES, dataInterfaceBlock } from './dataInterfaces';

const defaults = new WeakMap<MultiblockDef, MultiblockDef>();
/** Empty templates retain all input buses and put their terminating output on a side casing.
 * These choices contain no resource conflict, so the ordinary deterministic allocator suffices. */
export function withAssemblyInputDefaults(def: MultiblockDef): MultiblockDef {
  if (!['assembly-line', 'advanced-assembly-line'].includes(def.id)) return def;
  let selected = defaults.get(def);
  if (!selected) {
    selected = {
      ...def,
      legend: Object.fromEntries(
        Object.entries(def.legend).map(([char, entry]) => [
          char,
          entry.requiredHatch && entry.hatches?.includes('itemIn')
            ? { ...entry, hatches: ['itemIn'] }
            : entry,
        ]),
      ),
    };
    defaults.set(def, selected);
  }
  return selected;
}

/** Outputs terminate checkMachine's scan after a LATER piece, never immediately after FIRST.
 * Keep every declared interface registered; fluid outputs do not terminate that scan. */
export function withAssemblyLine(def: MultiblockDef): MultiblockDef {
  if (!['assembly-line', 'advanced-assembly-line'].includes(def.id)) return def;
  const legend: Record<string, LegendEntry> = {
    G: { blockId: 'gregtech:gt.blockcasings3@10' },
    d: { blockId: 'gregtech:gt.blockcasings3@10', hatches: [...DATA_INPUT_KINDS] },
    l: { blockId: 'gregtech:gt.blockcasings2@9' },
    m: { blockId: 'gregtech:gt.blockcasings2@5' },
    g: { blockId: 'bartworks:BW_TieredGlass@0' },
    e: { blockId: 'gregtech:gt.blockcasings2@0', hatches: ['energy'] },
    b: { blockId: 'gregtech:gt.blockcasings2@0', hatches: ['fluidIn', 'fluidOut', 'maintenance'] },
    B: {
      blockId: 'gregtech:gt.blockcasings2@0',
      hatches: ['fluidIn', 'fluidOut', 'maintenance', 'itemOut'],
    },
    i: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn'], requiredHatch: true },
    I: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn', 'fluidOut'], requiredHatch: true },
    T: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn', 'fluidOut', 'itemOut'], requiredHatch: true },
  };
  if (def.id === 'assembly-line') {
    // Keep the established saved-plan/material aliases; the native validator resolves these aliases.
    const aliases: Record<string, string> = {
      'gregtech:gt.blockcasings3@10': 'gt.casing.grate',
      'gregtech:gt.blockcasings2@9': 'gt.casing.assembler',
      'gregtech:gt.blockcasings2@5': 'gt.casing.assemblyLine',
      'gregtech:gt.blockcasings2@0': 'gt.casing.solidSteel',
      'bartworks:BW_TieredGlass@0': 'gt.glass.reinforced',
    };
    for (const entry of Object.values(legend)) entry.blockId = aliases[entry.blockId] ?? entry.blockId;
  }
  const final = source.segments.later.layers.map((rows, y) =>
    rows.map((row) => (y === 0 ? row.replaceAll('b', 'B').replace('I', 'T') : row)),
  );
  const requiredHatches: MultiblockDef['requiredHatches'] = {
    energy: { min: 1 },
    maintenance: { min: 1 },
    itemOut: { min: 1, max: 3 },
    dataAccess: { min: 0, max: 1 },
  };
  const structureVariants: NonNullable<MultiblockDef['structureVariants']> = {};
  for (let length = 3; length <= 16; length++)
    structureVariants[length] = {
      size: [length, 4, 3],
      layers: final.map((rows, y) =>
        rows.map(
          (row, z) =>
            row + source.segments.later.layers[y][z].repeat(length - 2) + source.segments.first.layers[y][z],
        ),
      ),
      legend,
      controller: { ...def.controller, pos: [length - 1, 2, 0] },
      requiredHatches,
    };
  return {
    ...def,
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.sources[def.id === 'assembly-line' ? 0 : 1].source}`,
    size: [2, 4, 3],
    // FIRST may already contain outputs: the checker still reads one complete LATER before stopping.
    // Five output cells minus the mandatory maintenance side permit at most four output buses here.
    layers: final.map((rows, y) =>
      rows.map(
        (row, z) =>
          row +
          (y === 0
            ? source.segments.first.layers[y][z].replace('b', 'B')
            : source.segments.first.layers[y][z]),
      ),
    ),
    legend,
    controller: { ...def.controller, pos: [1, 2, 0] },
    hatchBlocks: {
      ...def.hatchBlocks,
      itemIn: 'gt.hatch.inputBus',
      itemOut: 'gt.hatch.outputBus',
      fluidOut: 'gt.hatch.outputHatch',
      dataAccess: 'gt.hatch.dataAccess',
      ...Object.fromEntries(
        DATA_INPUT_KINDS.filter((kind) => kind !== 'dataAccess').map((kind) => [
          kind,
          dataInterfaceBlock(kind as keyof typeof DATA_INTERFACES),
        ]),
      ),
    },
    requiredHatches: { ...requiredHatches, itemOut: { min: 1, max: 4 } },
    structureVariants,
    defaultHatches: [...new Set([...def.defaultHatches, 'itemIn', 'itemOut'] as const)],
    resize: {
      axis: 'x',
      from: 1,
      to: 2,
      min: 2,
      max: 16,
      default: def.id === 'assembly-line' ? 16 : 5,
      label: 'length',
      section: { size: [1, 4, 3], layers: source.segments.later.layers },
    },
    notes:
      'RC2 checks FIRST then LATER until an output bus terminates the line (2–16 slices). A two-slice line also accepts FIRST outputs, up to four buses total while keeping maintenance. Longer lines allow up to three outputs in the final slice. Every later centre needs an input bus or fluid output; the final centre may instead be the output bus. Data Access is optional, at most one, on a grate outside the first slice, with registered EV/LuV/UV variants. Recipe input ordering still requires its role adapter.',
  };
}
