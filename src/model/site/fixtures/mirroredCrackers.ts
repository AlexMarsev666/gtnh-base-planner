// Test-only export of the current planner pair; never imported by the application.
import { getMultiblock } from '../../../data/catalog';
import { controllerFacing, unitCells } from '../../geometry';
import { buildGroup } from '../group';
import { validateResourceHatches } from '../resourcePlacement';

export function crackerWallsharingCase() {
  const def = getMultiblock('oil-cracking-unit')!;
  const demand = { fluidIn: ['feed', 'agent'], fluidOut: ['product'] };
  const settings = {
    voltageTier: 'HV' as const,
    wallsharing: 'side' as const,
    resourceBindings: [
      { kind: 'fluidIn' as const, resource: 'feed', role: 'feed' as const },
      { kind: 'fluidIn' as const, resource: 'agent', role: 'catalyst' as const },
    ],
  };
  const built = buildGroup(def, 2, { x: 2, y: 1, z: 1 }, def.defaultHatches, demand, true, {}, settings);
  if (
    built.unplaced.length ||
    built.missing.length ||
    validateResourceHatches(built.def, built.units, built.hatches, settings, demand).length
  )
    throw new Error('Invalid planner pair.');
  const shared = built.hatches.find((h) => h.resource === 'feed' && h.unitIds.length === 2);
  if (!shared) throw new Error('The pair must have one shared side input.');
  const hatches = new Map(built.hatches.map((h) => [h.cell.join(), h]));
  const cells = new Map<string, object>();
  for (const unit of built.units)
    for (const cell of unitCells(built.def, unit)) {
      const hatch = hatches.get(cell.pos.join());
      const block =
        cell.role === 'controller'
          ? def.controller.blockId
          : cell.role === 'air'
            ? 'minecraft:air@0'
            : cell.blockId === 'gt.coil.cupronickel'
              ? 'gregtech:gt.blockcasings5@0'
              : 'gregtech:gt.blockcasings4@1';
      cells.set(
        cell.pos.join(),
        hatch
          ? {
              pos: cell.pos,
              hatch: hatch.kind,
              tier: hatch.tier ?? 'HV',
              face: hatch.face,
              resource: hatch.resource,
            }
          : {
              pos: cell.pos,
              block,
              ...(cell.role === 'controller' ? { face: controllerFacing(def, unit) } : {}),
            },
      );
    }
  return {
    name: 'oil-cracker-mirrored-shared-side-pair',
    machine: def.id,
    source: def.source,
    circuit: 0,
    expectedStructure: true,
    crackingPair: { pos: shared.cell },
    cells: [...cells.values()],
  };
}
