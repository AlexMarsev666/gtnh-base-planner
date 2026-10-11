import type { Tier } from '../model/core/types';
import type { MultiblockDef } from '../model/multiblock/types';
import type { TransformerAmps, TransformerStep } from '../model/site/types';
import { catalog, getMultiblock } from './catalog';
import {
  getSingleMachine,
  singleMachineBlockId,
  singleMachineTiers,
  transformerValid,
} from './single-machines';

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

const GENERIC: readonly MultiblockDef[] = [SINGLE_BLOCK_DEF, PLACEHOLDER_DEF];

/** Catalog multiblock or generic stand-in by id. */
export function getSiteDef(id: string): MultiblockDef | undefined {
  return getMultiblock(id) ?? GENERIC.find((d) => d.id === id);
}

/** Everything a site group can be: catalog entries (by name), then the generic stand-ins. */
export const siteDefs: readonly MultiblockDef[] = [...catalog, ...GENERIC];

export function isSingleBlock(def: MultiblockDef): boolean {
  return def.id === SINGLE_BLOCK_ID;
}

/**
 * Block id of a single-block machine's look in the atlas (scripts/build-atlas.mjs): `site.machine.<id>@<tier>`
 * when the machine exists in that tier, `site.machine.transformer@<high tier>:<step>:<amps>` for a transformer
 * (a step-down one shows its input on the front), else the untiered `site.machine.<id>` of earlier versions.
 * A transformer GT has no block for (Hi-Amp below UEV) is drawn with 4 amps.
 */
export function singleMachineLook(
  machine: string,
  tier?: Tier,
  step: TransformerStep = 'down',
  amps: TransformerAmps = 4,
): string {
  const base = singleMachineBlockId(machine);
  if (!tier) return base;
  if (getSingleMachine(machine)?.transformer) {
    const a = transformerValid(tier, amps) ? amps : 4;
    return transformerValid(tier, a) ? `${base}@${tier}:${step}:${a}` : base;
  }
  return singleMachineTiers(machine).includes(tier) ? `${base}@${tier}` : base;
}
