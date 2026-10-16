import { isSingleBlock, singleMachineLook } from '../../data/generic';
import { DEFAULT_HATCH_COLORS } from '../colors';
import { key } from '../geometry';
import type { BomTiers } from '../bom';
import { buildSceneModel } from '../scene';
import { followsGroupTier, groupKey, hatchTier } from '../tiers';
import type { Vec3 } from '../core/types';
import type { SceneModel, Voxel } from '../render/types';
import type { RouteNet } from '../routing/routeNet';
import type { PlacedGroup, PlacedPort, SiteNet } from './buildTypes';
import { siteResource } from './demand';
import { groupPoint, type SiteHatch } from './group';
import { portUnitId } from './ids';
import { netKind } from './nets';
import type { SiteState } from './types';

/**
 * What the renderer draws for a built site: every group's blocks (conflicting cells marked), port blocks,
 * hatch and port markers, the routed pipes and cables (all but `isolate`'s resource dimmed), group and
 * port labels, and bounds covering the site and everything on it.
 */
export function buildSiteScene(
  site: SiteState,
  groups: readonly PlacedGroup[],
  ports: readonly PlacedPort[],
  routed: readonly SiteNet[],
  conflictCells: ReadonlySet<string>,
  isolate?: string | null,
  sharedCells?: ReadonlyMap<string, readonly number[]>,
): SceneModel {
  const [w, d] = site.size;
  const colors = { ...DEFAULT_HATCH_COLORS, ...site.colors };
  const resourceOf = (k: string) => siteResource(site, k);
  const placedPort = new Map(ports.map((p) => [p.port.id, p]));
  const portIndex = new Map(site.ports.map((p, i) => [p.id, i]));

  const voxelMap = new Map<string, Voxel>();
  for (const pg of groups) {
    if (!pg.def || !pg.build) continue;
    const single = isSingleBlock(pg.def);
    const b = pg.build;
    const local = buildSceneModel(
      pg.def,
      pg.units,
      single ? [] : pg.hatches,
      {
        ...b.stats,
        conflictCells: b.stats.conflictCells.map((c) =>
          groupPoint(c, b.size, pg.group.rotation, pg.group.origin, pg.group.elevation),
        ),
      },
      null,
      colors,
    );
    // Each single-block machine shows the look of its own machine in its tier (a transformer: with its step and
    // amperage; the voxel's facing is the front, which a step-down transformer takes its input on).
    const { machine, tier, step, amps } = pg.group;
    const look = single && machine ? singleMachineLook(machine, tier, step, amps) : null;
    for (const v of local.voxels) {
      if (look) v.blockId = look;
      const k = key(v.pos);
      if (conflictCells.has(k)) v.conflict = true;
      const prev = voxelMap.get(k);
      // A wall two groups share is drawn once, for the first group (lowest index), and counted once; it
      // answers for the units of both, and keeps a conflict its own group had.
      const share = prev && !conflictCells.has(k) && sharedCells?.has(k);
      if (prev) {
        if (!share || v.conflict) prev.conflict = true;
        prev.unitIds = [...new Set([...prev.unitIds, ...v.unitIds])].sort((a, b) => a - b);
      } else voxelMap.set(k, v);
    }
  }
  for (const pp of ports) {
    const res = resourceOf(pp.port.resource);
    const k = key(pp.cell);
    if (voxelMap.has(k)) voxelMap.get(k)!.conflict = true;
    // A port shows its front (chest, tank or energy output) towards the site, like a controller.
    else
      voxelMap.set(k, {
        pos: pp.cell,
        blockId: `site.port.${res.kind}`,
        kind: 'controller',
        facing: pp.faces[0],
        unitIds: [portUnitId(portIndex.get(pp.port.id) ?? 0)],
      });
  }
  const voxels = [...voxelMap.values()];

  const markers: NonNullable<SceneModel['markers']> = [];
  const allHatches: SiteHatch[] = [];
  for (const pg of groups)
    for (const h of pg.hatches) {
      allHatches.push(h);
      markers.push({
        pos: h.cell,
        face: h.face,
        color: h.resource ? resourceOf(h.resource).color : colors[h.kind],
      });
    }
  for (const n of routed)
    n.terminals.forEach((t, ti) => {
      const f = n.route?.attach[ti];
      if (t.port)
        markers.push({
          pos: t.cell,
          face: f ?? placedPort.get(t.port)!.faces[0],
          color: resourceOf(n.resource).color,
        });
    });
  for (const pp of ports)
    if (!routed.some((n) => n.terminals.some((t) => t.port === pp.port.id)))
      markers.push({ pos: pp.cell, face: pp.faces[0], color: resourceOf(pp.port.resource).color });

  const pipes: RouteNet[] = routed.map((n) => {
    const r = n.route!;
    return {
      kind: netKind(n.kind),
      id: n.id,
      color: resourceOf(n.resource).color,
      paths: r.paths,
      length: r.length,
      connected: r.connected,
      total: r.total,
      flows: r.flows,
      dim: !!isolate && isolate !== n.resource,
    };
  });
  // Port blocks take a stub like hatches.
  const portStubs = routed.flatMap((n) =>
    n.terminals.flatMap((t, ti) => {
      const f = n.route?.attach[ti];
      return t.port && f ? [{ kind: netKind(n.kind), cell: t.cell, face: f, unitIds: [], net: n.id }] : [];
    }),
  );

  const labels: NonNullable<SceneModel['labels']> = [];
  for (const pg of groups) {
    if (!pg.def) continue;
    const name = pg.group.label ?? pg.def.name;
    const cx = (pg.min[0] + pg.max[0]) / 2;
    const cz = (pg.min[2] + pg.max[2]) / 2;
    const n = pg.units.length;
    labels.push({ pos: [cx, pg.max[1] + 1.2, cz], text: n > 1 ? `${name} ×${n}` : name });
  }
  for (const pp of ports) {
    const res = resourceOf(pp.port.resource);
    labels.push({
      pos: [pp.cell[0] + 0.5, 1.9, pp.cell[2] + 0.5],
      text: `${pp.port.dir === 'in' ? '→' : ''}${res.name}${pp.port.dir === 'out' ? (pp.port.void ? ' ✕' : '→') : ''}`,
      color: res.color,
      small: true,
    });
  }

  let lo: Vec3 = [0, 0, 0];
  let hi: Vec3 = [w, 1, d];
  for (const v of voxels) {
    lo = [Math.min(lo[0], v.pos[0]), Math.min(lo[1], v.pos[1]), Math.min(lo[2], v.pos[2])];
    hi = [Math.max(hi[0], v.pos[0] + 1), Math.max(hi[1], v.pos[1] + 1), Math.max(hi[2], v.pos[2] + 1)];
  }

  return {
    voxels,
    hatches: [...allHatches, ...portStubs],
    pipes: routed.length ? pipes : null,
    bounds: { min: lo, max: hi },
    colors,
    markers,
    labels,
    site: { size: [w, d] },
  };
}

/**
 * The `SiteGroup.hatchTiers` key of each hatch of a group, in the order given (see `groupKey`): kinds without a
 * resource by their number among the hatches of the kind, the others by resource and unit index (the position
 * in `unitIds`), or `shared` for a hatch serving several units.
 */
export function groupHatchKeys(
  hatches: readonly Pick<SiteHatch, 'kind' | 'resource' | 'unitIds'>[],
  unitIds: readonly number[],
): string[] {
  const seen = new Map<string, number>();
  return hatches.map((h) => {
    const n = seen.get(h.kind) ?? 0;
    seen.set(h.kind, n + 1);
    const index = unitIds.indexOf(h.unitIds[0]);
    return groupKey(h.kind, n, h.resource, h.unitIds.length > 1 || index < 0 ? 'shared' : index);
  });
}

/**
 * Tiers for the bill of materials of a built site, matching `SceneModel.hatches` of `buildSiteScene` (the
 * groups' hatches in group order). Each hatch gets the tier `hatchTier` names for its group: its own entry,
 * else the group's tier for energy and dynamo hatches. Undefined when no group has any, so an untiered
 * template lists exactly what it did before.
 */
export function siteBomTiers(groups: readonly PlacedGroup[]): BomTiers | undefined {
  const hatchKeys: string[] = [];
  const hatchTiers: Record<string, NonNullable<ReturnType<typeof hatchTier>>> = {};
  for (const pg of groups) {
    const keys = groupHatchKeys(
      pg.hatches,
      pg.units.map((u) => u.id),
    );
    pg.hatches.forEach((h, i) => {
      const global = `${pg.group.id}|${keys[i]}`;
      hatchKeys.push(global);
      const tier = hatchTier(h.kind, keys[i], pg.group.tier, pg.group.hatchTiers, followsGroupTier);
      if (tier) hatchTiers[global] = tier;
    });
  }
  return Object.keys(hatchTiers).length ? { hatchKeys, hatchTiers } : undefined;
}
