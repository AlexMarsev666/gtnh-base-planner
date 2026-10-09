import source from '../../data/circuit-assembly-line.rc2.generated.json';
import type { LegendEntry, MultiblockDef } from './types';

/** The checker reads FIRST, then NEXT until its first output bus, for a total length of 2–7. */
export function withCircuitAssemblyLine(def: MultiblockDef): MultiblockDef {
  if (def.id !== 'circuit-assembly-line') return def;
  const legend: Record<string, LegendEntry> = {
    G: { blockId: 'gregtech:gt.blockcasings3@10', hatches: ['energy'] },
    g: { blockId: 'bartworks:BW_TieredGlass@0' },
    l: { blockId: 'gregtech:gt.blockcasings2@5' },
    b: { blockId: 'gregtech:gt.blockcasings2@0', hatches: ['fluidIn', 'maintenance'] },
    i: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn'], requiredHatch: true },
    I: { blockId: 'gregtech:gt.blockcasings2@0', hatches: ['itemIn'] },
    o: { blockId: 'gt.hatch.outputBus', hatches: ['itemOut'], requiredHatch: true },
  };
  const structureVariants: NonNullable<MultiblockDef['structureVariants']> = {};
  for (let length = 2; length <= 7; length++)
    structureVariants[length] = {
      size: [length, 3, 3],
      layers: source.segments.next.layers.map((rows, y) =>
        rows.map(
          (row, z) => row.replace('I', 'o') + row.repeat(length - 2) + source.segments.first.layers[y][z],
        ),
      ),
      controller: { ...def.controller, pos: [length - 1, 2, 0] },
      legend,
    };
  return {
    ...def,
    ...structureVariants[2],
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${source.source}`,
    structureVariants,
    resize: { axis: 'x', from: 1, to: 2, min: 2, max: 7, default: 2, label: 'length' },
    selectableGlass: true,
    assemblyGrowth: 'left',
    minimumStructureGlassTier: 'EV',
    requiredHatches: {
      energy: { min: 1, max: 1 },
      maintenance: { min: 1 },
      itemIn: { min: 1 },
      itemOut: { min: 1, max: 1 },
    },
  };
}

const mirrored = new WeakMap<MultiblockDef, MultiblockDef>();
/** Apply after sizing. RC2 clears the original EV-glass error after a successful right-to-left fallback. */
export function withAssemblyGrowth(def: MultiblockDef, growth?: 'left' | 'right'): MultiblockDef {
  const wanted = growth ?? 'left';
  if (def.id !== 'circuit-assembly-line' || wanted === (def.assemblyGrowth ?? 'left')) return def;
  let result = mirrored.get(def);
  if (!result) {
    result = {
      ...def,
      layers: def.layers.map((rows) => rows.map((row) => [...row].reverse().join(''))),
      controller: {
        ...def.controller,
        pos: [def.size[0] - 1 - def.controller.pos[0], def.controller.pos[1], def.controller.pos[2]],
      },
      assemblyGrowth: wanted,
      minimumStructureGlassTier: wanted === 'left' ? 'EV' : undefined,
    };
    mirrored.set(def, result);
  }
  return result;
}
