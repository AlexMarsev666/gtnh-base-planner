import source from '../../data/data-bank.rc2.generated.json';
import { DATA_INPUT_KINDS, DATA_OUTPUT_KINDS, DATA_INTERFACES, dataInterfaceBlock } from './dataInterfaces';
import type { MultiblockDef } from './types';

export function withDataBank(def: MultiblockDef): MultiblockDef {
  if (def.id !== 'data-bank') return def;
  return {
    ...def,
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.source}`,
    size: [source.size[0], source.size[1], source.size[2]],
    layers: source.layers,
    controller: {
      ...def.controller,
      pos: [source.controllerPos[0], source.controllerPos[1], source.controllerPos[2]],
    },
    legend: {
      A: { blockId: source.blocks.A },
      B: { blockId: source.blocks.B },
      C: { blockId: source.blocks.C, hatches: ['energy', 'dynamo', 'maintenance'] },
      D: { blockId: source.blocks.D, hatches: [...DATA_INPUT_KINDS, ...DATA_OUTPUT_KINDS] },
    },
    hatchBlocks: {
      ...def.hatchBlocks,
      dataAccess: 'gt.hatch.dataAccess',
      ...Object.fromEntries(
        Object.keys(DATA_INTERFACES).map((kind) => [
          kind,
          dataInterfaceBlock(kind as keyof typeof DATA_INTERFACES),
        ]),
      ),
    },
    requiredHatches: { energy: { min: 1 }, maintenance: { min: 1 } },
    defaultHatches: ['energy', 'maintenance', 'dataAccess', 'assemblyDataOut'],
    notes:
      'RC2 requires an energy input, maintenance, at least one Data Access or wired/wireless recipe-data input, and at least one wired/wireless recipe-data output. Only D computer casing cells accept data interfaces; the three A core computers stay fixed. A wired input sets slave mode; a wireless input inherits Data Access and does not set slave. Optical/wireless recipe transport still needs network integration.',
  };
}
