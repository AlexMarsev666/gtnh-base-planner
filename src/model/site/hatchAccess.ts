import { isSingleBlock } from '../../data/generic';
import { step } from '../geometry';
import type { PlacedGroup, PlacedPort, SiteWarning } from './buildTypes';
import type { SiteOccupancy } from './occupancy';

/** Verify final faces after the router has turned hatches, against the whole site's structures. */
export function validateHatchAccess(
  groups: readonly PlacedGroup[],
  occupancy: Pick<SiteOccupancy, 'occ'>,
  controllerFronts: ReadonlySet<string>,
  ports: readonly PlacedPort[] = [],
): SiteWarning[] {
  const warnings: SiteWarning[] = [];
  const physicalHatches = new Map(groups.flatMap((pg) => pg.hatches.map((h) => [h.cell.join(), h] as const)));
  const physicalPorts = new Map(ports.map((port) => [port.cell.join(), port]));
  const fronts = new Map<string, { channel: string; groups: Set<string> }>();
  const conflictGroups = new Map<string, Set<string>>();
  for (const pg of groups) {
    if (!pg.def || isSingleBlock(pg.def)) continue;
    for (const hatch of pg.hatches) {
      const front = step(hatch.cell, hatch.face).join();
      const channel = JSON.stringify(
        hatch.net === undefined ? [hatch.kind, hatch.resource ?? null] : ['net', hatch.net],
      );
      const neighbor = physicalHatches.get(front);
      const port = physicalPorts.get(front);
      // Directly adjoining terminals of the same network need no intervening pipe block.
      const direct =
        hatch.net !== undefined &&
        (neighbor?.net === hatch.net || (port && port.port.resource === hatch.resource));
      const blocked =
        occupancy.occ.has(front) && !direct
          ? 'a structure or required air cell'
          : controllerFronts.has(front)
            ? 'controller access'
            : undefined;
      if (blocked)
        warnings.push({
          type: 'error',
          group: pg.group.id,
          code: 'structure',
          message: `${hatch.kind} at ${hatch.cell.join()} faces ${blocked} at ${front}. Choose an exposed connection side.`,
        });
      const previous = fronts.get(front);
      if (previous && previous.channel !== channel) {
        const affected = conflictGroups.get(front) ?? new Set<string>();
        previous.groups.forEach((id) => affected.add(id));
        affected.add(pg.group.id);
        conflictGroups.set(front, affected);
      }
      conflictGroups.get(front)?.add(pg.group.id);
      if (previous) previous.groups.add(pg.group.id);
      else fronts.set(front, { channel, groups: new Set([pg.group.id]) });
    }
  }
  for (const [front, ids] of conflictGroups)
    for (const id of ids)
      warnings.push({
        type: 'error',
        group: id,
        code: 'structure',
        message: `Different hatch resources or kinds need the same connection cell ${front}.`,
      });
  return warnings;
}
