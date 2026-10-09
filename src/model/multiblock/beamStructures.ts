import sourceShapes from '../../data/beam-structures.rc2.generated.json';
import type { LegendEntry, MultiblockDef } from './types';
import type { Vec3 } from '../core/types';

/** Source checkMachine uses exact special adders; construct's shared placeholders lose their roles. */
export function withBeamStructures(def: MultiblockDef): MultiblockDef {
  const entry = sourceShapes.entries[def.id as keyof typeof sourceShapes.entries];
  if (!entry) return def;
  const forms = entry.forms.map((form) => {
    const legend: Record<string, LegendEntry> = {};
    for (const [char, blockId] of Object.entries(form.blocks)) {
      const existing = Object.values(def.legend).find((e) => e.blockId === blockId);
      legend[char] = { ...existing, blockId };
      if (def.id === 'source-chamber') {
        legend[char] = { blockId };
        if (char === 'd') legend[char].hatches = ['energy', 'maintenance'];
        if (char === 'i') {
          legend[char].hatches = ['itemIn', 'fluidIn'];
          legend[char].requiredHatch = true;
        }
        if (char === 'o') {
          legend[char].hatches = ['itemOut'];
          legend[char].requiredHatch = true;
        }
      }
      if (char === 'C') legend[char].facing = 'north';
      if (blockId === 'gregtech:gt.blockmachines@3014') legend[char].facing = 'south';
      if (blockId === 'gregtech:gt.blockmachines@10504')
        legend[char].facing = def.id === 'beam-mirror' ? (form.size[1] === 5 ? 'up' : 'north') : 'south';
    }
    return {
      size: [form.size[0], form.size[1], form.size[2]] as Vec3,
      layers: form.layers,
      legend,
      controller: {
        ...def.controller,
        pos: [form.controllerPos[0], form.controllerPos[1], form.controllerPos[2]] as Vec3,
      },
    };
  });
  return {
    ...def,
    ...forms[0],
    source: `https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/${entry.source}`,
    ...(def.id === 'source-chamber'
      ? {
          notes:
            'RC2 requires one input bus OR fluid input hatch in the front-center cell, a bottom output bus, a rear beam output, exactly one energy hatch and exactly one maintenance hatch. The output bus needs access below the base. Recipes and full beam-network dispatch remain under review.',
        }
      : {}),
    ...(forms.length > 1
      ? {
          resize: { axis: 'y', from: 1, to: 2, min: 5, max: 6, default: 5, label: 'height' },
          structureVariants: Object.fromEntries(forms.map((form) => [form.size[1], form])),
        }
      : {}),
  };
}
