import source from '../../data/arc-furnace.rc2.generated.json';
import type { HatchKind, MultiblockDef } from './types';

export const ARC_HATCHES = source.hatches;
export const ARC_ELECTRODES = source.electrodes;

/** First physical Electrode Hatch is dedicated; later ones enter the ordinary Input Bus list. */
export function withArcFurnace(def: MultiblockDef): MultiblockDef {
  if (def.id !== 'industrial-arc-furnace') return def;
  const ids = ARC_ELECTRODES.map((e) => e.gameId);
  const kinds: HatchKind[] = ['electrodeIn', 'electrodeBus', 'electrodeDetector'];
  return {
    ...def,
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.source}`,
    layers: source.layers,
    legend: { ...def.legend, B: { ...def.legend.B, hatches: [...def.legend.B.hatches!, ...kinds] } },
    hatchBlocks: {
      ...def.hatchBlocks,
      electrodeIn: `gregtech:gt.blockmachines@${ARC_HATCHES.electrode.meta}`,
      electrodeBus: `gregtech:gt.blockmachines@${ARC_HATCHES.electrode.meta}`,
      electrodeDetector: `gregtech:gt.blockmachines@${ARC_HATCHES.detector.meta}`,
    },
    requiredHatches: { ...def.requiredHatches, electrodeIn: { min: 1, max: 1 } },
    defaultHatches: [...def.defaultHatches, 'electrodeIn'],
    shareableHatches: [...def.shareableHatches, ...kinds],
    lockedItemInputs: { electrodeIn: ids, electrodeBus: ids },
    orderedHatchKinds: [
      { first: 'electrodeIn', later: 'electrodeBus', order: source.order as [number, number, number][] },
    ],
  };
}
