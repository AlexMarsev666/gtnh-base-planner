import source from '../../data/linear-accelerator.rc2.generated.json';
import type { LegendEntry, MultiblockDef } from './types';

export function withLinearAccelerator(def: MultiblockDef): MultiblockDef {
  if (def.id !== 'linear-accelerator') return def;
  const legend: Record<string, LegendEntry> = Object.fromEntries(
    Object.entries(source.blocks).map(([char, blockId]) => [char, { blockId }]),
  );
  legend.i.facing = 'north';
  legend.o.facing = 'south';
  legend.j.hatches = ['energy', 'maintenance'];
  legend.h.hatches = ['fluidIn', 'fluidOut'];
  legend.h.requiredHatch = true;
  return {
    ...def,
    size: [7, 7, 17],
    layers: source.segments.base.layers.map((rows, y) => [...rows, ...source.segments.end.layers[y]]),
    legend,
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.source}`,
    resize: {
      axis: 'z',
      from: 8,
      to: 10,
      min: 17,
      max: 135,
      default: 19,
      label: 'length',
      section: { size: [7, 7, 2], layers: source.segments.layer.layers },
    },
    requiredHatches: { ...def.requiredHatches, energy: { min: 0, max: 2 } },
    notes:
      'RC2 checkMachine accepts complete base/layer/end forms of odd length 17–135. The construction hint offers 19–83; default 19 preserves existing plans. Each top interface accepts input or output fluid independently. Energy is optional structurally (maximum two); productive operation needs energy and coolant. The end-less length-128 checker escape is not a productive structure.',
  };
}
