import type { MultiblockDef } from '../model/multiblock/types';
import { catalog, getMultiblock } from './catalog';

/**
 * Stand-ins used by sites (and the GTNH Planner import) for machines the catalog does not have:
 * - `single-block`: an ordinary GT single-block machine (Assembler, Macerator, ...). One block; its item and
 *   fluid IO sit on its own faces, so the site pipeline puts "hatches" on the machine block itself.
 * - `placeholder`: a multiblock that has not been transcribed yet. A 3×3×3 box whose casings take any
 *   hatch, so the chain can still be laid out and piped; the real structure will differ.
 *
 * They are not in the catalog, so the single-machine picker never lists them.
 */

export const SINGLE_BLOCK_ID = 'single-block';
export const PLACEHOLDER_ID = 'placeholder';
export const TRANSFORMER_ID = 'transformer';

const IO_AND_POWER = ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'energy', 'dynamo', 'maintenance'] as const;

export const SINGLE_BLOCK_DEF: MultiblockDef = {
  id: SINGLE_BLOCK_ID,
  name: 'Single-block machine',
  size: [1, 1, 1],
  layers: [['~']],
  legend: {},
  controller: { pos: [0, 0, 0], facing: 'north', blockId: 'site.singleblock' },
  hatchBlocks: {},
  shareableHatches: [],
  defaultHatches: [],
  wallshare: false,
  notes: 'Any GT single-block machine. Items, fluids and power connect to its faces; the front stays free.',
};

export const PLACEHOLDER_DEF: MultiblockDef = {
  id: PLACEHOLDER_ID,
  name: 'Placeholder multiblock',
  size: [3, 3, 3],
  layers: [
    ['c~c', 'ccc', 'ccc'],
    ['ccc', 'c-c', 'ccc'],
    ['ccc', 'ccc', 'ccc'],
  ],
  legend: { c: { blockId: 'site.placeholder', hatches: [...IO_AND_POWER] } },
  controller: { pos: [1, 0, 0], facing: 'north', blockId: 'gt.controller' },
  hatchBlocks: {
    itemIn: 'gt.hatch.inputBus',
    itemOut: 'gt.hatch.outputBus',
    fluidIn: 'gt.hatch.inputHatch',
    fluidOut: 'gt.hatch.outputHatch',
    energy: 'gt.hatch.energy',
    dynamo: 'gt.hatch.dynamo',
    maintenance: 'gt.hatch.maintenance',
  },
  shareableHatches: ['itemIn', 'itemOut', 'fluidIn', 'fluidOut'],
  requiredHatches: { maintenance: { min: 1, max: 1 } },
  defaultHatches: ['maintenance'],
  wallshare: false,
  notes:
    'A 3×3×3 stand-in for a multiblock that is not in the catalog yet. Its size and hatches are not real.',
};

export const TRANSFORMER_DEF: MultiblockDef = {
  ...SINGLE_BLOCK_DEF,
  id: TRANSFORMER_ID,
  name: 'Transformer',
  controller: { ...SINGLE_BLOCK_DEF.controller, blockId: 'site.transformer.LV.down' },
  hatchBlocks: { energy: 'gt.hatch.energy', dynamo: 'gt.hatch.dynamo' },
  notes: 'RC2 transformer: the front is the higher voltage side; all other faces are the lower side.',
};
const GENERIC: readonly MultiblockDef[] = [SINGLE_BLOCK_DEF, TRANSFORMER_DEF, PLACEHOLDER_DEF];

/** Catalog multiblock or generic stand-in by id. */
export function getSiteDef(id: string): MultiblockDef | undefined {
  return getMultiblock(id) ?? GENERIC.find((d) => d.id === id);
}

/** Everything a site group can be: catalog entries (by name), then the generic stand-ins. */
export const siteDefs: readonly MultiblockDef[] = [...catalog, ...GENERIC];

export function isSingleBlock(def: MultiblockDef): boolean {
  return def.id === SINGLE_BLOCK_ID || def.id === TRANSFORMER_ID;
}
