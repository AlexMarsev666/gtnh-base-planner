// Test-only exhaustive witnesses. Never imported by the application or the production placer.
import { getMultiblock } from '../../../data/catalog';
import { controllerFacing, step, unitCells, rotatedSize } from '../../geometry';
import type { Vec3 } from '../../core/types';
import type { HatchKind, Unit } from '../../multiblock/types';
import { findSites } from '../../hatches/sites';
import { defCache } from '../../layout/cache';
import { pairOk } from '../../layout/shapes';
import { computeWallStats } from '../../walls';
import type { SiteHatch } from '../group';
import type { PlacedGroup } from '../buildTypes';
import type { SiteState } from '../types';
import { analyzeOccupancy } from '../occupancy';
import { placeSitePorts } from '../ports';
import { buildSiteNetworks, routeSiteNetworks } from '../nets';
import { validateHatchAccess } from '../hatchAccess';
import { validateResourceHatches } from '../resourcePlacement';

export const cracker = getMultiblock('oil-cracking-unit')!;
export const feeds = ['feed-1', 'feed-2', 'feed-3', 'feed-4'];
export const agents = ['agent-1', 'agent-2'];
export const products = ['product-1', 'product-2', 'product-3', 'product-4'];
export const inputs = [...feeds, ...agents];
export const resources = [...inputs, ...products];

export interface CrackingWitness {
  axis: number;
  pitch: number;
  units: Unit[];
  hatches: SiteHatch[];
  blocks: number;
}

/** Exhaust 3 axes × 4 pitches (shared/touching/1-block gap/2-block gap) × 2 relative turns.
 * Solve a separate exact-cover problem for 14 ordinary hatches, excluding every shared cell.
 * Neither buildGroup nor placeResourceHatches is used to find the witnesses.
 */
export function enumerateCrackingCapacity() {
  let tried = 0;
  let geometric = 0;
  const witnesses: CrackingWitness[] = [];
  for (const axis of [0, 1, 2])
    for (const pitch of [
      cracker.size[axis] - 1,
      cracker.size[axis],
      cracker.size[axis] + 1,
      cracker.size[axis] + 2,
    ])
      for (const rotation of [0, 2] as const) {
        tried++;
        const offset: Vec3 = [axis === 0 ? pitch : 0, axis === 1 ? pitch : 0, axis === 2 ? pitch : 0];
        if (!pairOk(cracker, defCache(cracker), 0, rotation, offset)) continue;
        geometric++;
        const units: Unit[] = [
          { id: 0, origin: [0, 0, 0], rotation: 0 },
          { id: 1, origin: offset, rotation },
        ];
        const { sites } = findSites(cracker, units, true);
        const slots = units.flatMap((unit) => {
          const pairs: [HatchKind, string | undefined, string | undefined][] = [
            ['energy', undefined, undefined],
            ['maintenance', undefined, undefined],
            ['fluidIn', feeds[unit.id * 2], 'side'],
            ['fluidIn', feeds[unit.id * 2 + 1], 'side'],
            ['fluidIn', agents[unit.id], 'middle'],
            ['fluidOut', products[unit.id * 2], undefined],
            ['fluidOut', products[unit.id * 2 + 1], undefined],
          ];
          return pairs.map(([kind, resource, region]) => ({ unitId: unit.id, kind, resource, region }));
        });
        const options = slots.map((slot) =>
          sites
            .filter(
              (site) =>
                site.unitIds.length === 1 &&
                site.unitIds[0] === slot.unitId &&
                site.kinds.has(slot.kind) &&
                (!slot.region || site.regions.get(slot.unitId) === slot.region),
            )
            .flatMap((site) =>
              site.faces
                .filter((face) => !site.blocked.get(slot.kind)?.has(face.dir))
                .map((face) => ({ site, face })),
            ),
        );
        const order = slots.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);
        const used = new Set<string>();
        const fronts = new Map<string, string>();
        const hatches: SiteHatch[] = [];
        function solve(depth: number): boolean {
          if (depth === order.length) return true;
          const i = order[depth];
          const slot = slots[i];
          for (const { site, face } of options[i]) {
            const cell = site.pos.join();
            const front = step(site.pos, face.dir).join();
            const token = slot.resource ?? slot.kind;
            if (used.has(cell) || (fronts.has(front) && fronts.get(front) !== token)) continue;
            const previous = fronts.get(front);
            used.add(cell);
            fronts.set(front, token);
            hatches.push({
              kind: slot.kind,
              resource: slot.resource,
              cell: site.pos,
              face: face.dir,
              unitIds: [slot.unitId],
              tier: 'HV',
            });
            // Forward checking cuts impossible side-wall layouts without enumerating every permutation.
            const possible = order
              .slice(depth + 1)
              .every((j) =>
                options[j].some(
                  ({ site: s, face: f }) =>
                    !used.has(s.pos.join()) &&
                    (!fronts.has(step(s.pos, f.dir).join()) ||
                      fronts.get(step(s.pos, f.dir).join()) === (slots[j].resource ?? slots[j].kind)),
                ),
              );
            if (possible && solve(depth + 1)) return true;
            hatches.pop();
            used.delete(cell);
            if (previous === undefined) fronts.delete(front);
            else fronts.set(front, previous);
          }
          return false;
        }
        if (solve(0))
          witnesses.push({
            axis,
            pitch,
            units,
            hatches,
            blocks: computeWallStats(cracker, units, hatches).totalBlocks,
          });
      }
  return { tried, geometric, witnesses };
}

/** Route an independently found witness with exactly the same network/access code as a site build. */
export function routeCrackingWitness(site: SiteState, witness: CrackingWitness) {
  const group = site.groups[0];
  const shift = (pos: Vec3): Vec3 => [pos[0] + group.origin[0], pos[1], pos[2] + group.origin[1]];
  const units = witness.units.map((unit) => ({ ...unit, origin: shift(unit.origin) }));
  const maxAt = (axis: number) =>
    Math.max(...units.map((unit) => unit.origin[axis] + rotatedSize(cracker, unit.rotation)[axis]));
  const max: Vec3 = [maxAt(0), maxAt(1), maxAt(2)];
  const placed: PlacedGroup = {
    group,
    index: 0,
    def: cracker,
    units,
    hatches: witness.hatches.map((hatch) => ({ ...hatch, cell: shift(hatch.cell) })),
    min: shift([0, 0, 0]),
    max,
    demand: { fluidIn: inputs, fluidOut: products },
  };
  const occupancy = analyzeOccupancy(site, [placed]);
  const ports = placeSitePorts(site, [placed], occupancy);
  const { nets, hatchNet } = buildSiteNetworks(site, [placed], ports.ports);
  const routed = routeSiteNetworks(site, [placed], ports.ports, nets, hatchNet, occupancy, {
    pipes: true,
    cables: true,
    below: true,
  });
  const fronts = new Set(
    units.map((unit) => {
      const cell = unitCells(cracker, unit).find((cell) => cell.role === 'controller')!;
      return step(cell.pos, controllerFacing(cracker, unit)).join();
    }),
  );
  return {
    placed,
    nets,
    pipeBlocks: nets.reduce((sum, net) => sum + (net.route?.length ?? 0), 0),
    warnings: [
      ...occupancy.warnings,
      ...ports.warnings,
      ...routed.warnings,
      ...validateHatchAccess([placed], occupancy, fronts, ports.ports),
      ...validateResourceHatches(cracker, units, placed.hatches),
    ],
  };
}
