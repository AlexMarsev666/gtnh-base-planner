import type { PlacedGroup, PlacedPort, SiteBuild, SiteBuilder, SiteNet } from './buildTypes';
import { deriveSiteDemand } from './demand';
import { placeGroups, type GroupCache } from './groups';
import { buildSiteNetworks, routeSiteNetworks } from './nets';
import { analyzeOccupancy } from './occupancy';
import { placeSitePorts } from './ports';
import type { RouteResult } from './router';
import { buildSiteScene } from './siteScene';
import { groupToward } from './toward';
import { validateAlternativeCounts } from '../multiblock/rules';
import { validateResourceHatches } from './resourcePlacement';
import { isSingleBlock } from '../../data/generic';
import { hatchTiers } from '../../data/single-machines';
import { validateHatchAccess } from './hatchAccess';
import type { HatchKind } from '../multiblock/types';

/**
 * Builds sites. Keeps a per-group cache: moving, rotating or relinking one group only re-packs the groups
 * whose own inputs (multiblock, count, limits, hatches, demand) changed.
 */
export function createSiteBuilder(): SiteBuilder {
  const cache: GroupCache = new Map();

  return function buildSite(site, opts) {
    opts = { ...opts, below: site.routing?.mode === 'neat' || opts.below };
    const demand = deriveSiteDemand(site);
    const placed = placeGroups(
      site,
      demand.demands,
      groupToward(site, demand.endsOf),
      !!opts.below,
      cache,
      !opts.keepCache,
    );
    const { groups } = placed;
    const occupancy = analyzeOccupancy(site, groups);
    const { ports, warnings: portWarnings } = placeSitePorts(site, groups, occupancy);
    const { nets, hatchNet } = buildSiteNetworks(site, groups, ports);
    const controllerFronts = new Set(occupancy.keepFree.map((pos) => pos.join()));
    const routing = routeSiteNetworks(site, groups, ports, nets, hatchNet, occupancy, opts);
    const structureWarnings: SiteBuild['warnings'] = validateHatchAccess(
      groups,
      occupancy,
      controllerFronts,
      ports,
    );
    for (const pg of groups) {
      if (!pg.def || isSingleBlock(pg.def)) continue;
      for (const hatch of pg.hatches) {
        const tiers = hatchTiers(hatch.kind);
        if (hatch.tier && tiers.length && !tiers.includes(hatch.tier))
          structureWarnings.push({
            type: 'error',
            group: pg.group.id,
            code: 'tier',
            message: `${hatch.kind} has no ${hatch.tier} variant in RC2 at (${hatch.cell.join(', ')}). Choose a supported individual tier.`,
          });
      }
      const messages = new Set(
        validateResourceHatches(pg.def, pg.units, pg.hatches, pg.group, pg.demand, [
          ...new Set([...pg.group.enabledHatches, ...(Object.keys(pg.demand) as HatchKind[])]),
        ]),
      );
      validateAlternativeCounts(pg.def, pg.units, pg.hatches).forEach((message) => messages.add(message));
      for (const message of messages)
        structureWarnings.push({ type: 'error', group: pg.group.id, code: 'structure', message });
    }
    const electricalWarnings: SiteBuild['warnings'] = [];
    for (const net of nets.filter((n) => n.kind === 'power')) {
      const tiers = new Set(net.terminals.flatMap((t) => (t.hatch?.tier ? [t.hatch.tier] : [])));
      if (tiers.size > 1) {
        for (const group of new Set(net.terminals.flatMap((t) => (t.group ? [t.group] : []))))
          electricalWarnings.push({
            type: 'error',
            group,
            code: 'electrical',
            message: `Incompatible electrical tiers in ${net.resource}: ${[...tiers].join(', ')}. Insert a transformer between these networks.`,
          });
      }
    }
    return {
      groups,
      ports,
      nets,
      scene: buildSiteScene(site, groups, ports, routing.routed, occupancy.conflictCells, opts.isolate),
      warnings: [
        ...new Map(
          [
            ...demand.warnings,
            ...placed.warnings,
            ...occupancy.warnings,
            ...portWarnings,
            ...routing.warnings,
            ...electricalWarnings,
            ...structureWarnings,
          ].map((warning) => [JSON.stringify(warning), warning]),
        ).values(),
      ],
      stats: siteStats(groups, ports, routing.routed, site.routing?.mode === 'neat'),
    };
  };
}

/** Totals shown under the site: groups, units, blocks, hatches, pipe and cable blocks, connections. */
function siteStats(
  groups: readonly PlacedGroup[],
  ports: readonly PlacedPort[],
  routed: readonly SiteNet[],
  neat = false,
): SiteBuild['stats'] {
  let blocks = ports.length;
  let hatches = 0;
  for (const pg of groups) {
    blocks += pg.build?.stats.totalBlocks ?? 0;
    hatches += pg.build?.stats.hatches ?? 0;
  }
  const sum = (list: readonly SiteNet[], f: (r: RouteResult) => number) =>
    list.reduce((s, n) => s + (n.route ? f(n.route) : 0), 0);
  return {
    ...(neat
      ? {
          depthPenalty: routed.reduce(
            (sum, n) =>
              sum +
              [...new Set((n.route?.paths ?? []).flat().map((p) => p.join()))].reduce(
                (cost, cell) => cost + Math.max(0, -Number(cell.split(',')[1]) - 1) * 0.25,
                0,
              ),
            0,
          ),
          surfaceBlocks: routed.reduce(
            (sum, n) =>
              sum +
              new Set(
                (n.route?.paths ?? [])
                  .flat()
                  .filter((p) => p[1] >= 0)
                  .map((p) => p.join()),
              ).size,
            0,
          ),
          bends: routed.reduce(
            (sum, n) =>
              sum +
              (n.route?.paths ?? []).reduce(
                (sum, path) =>
                  sum +
                  path
                    .slice(2)
                    .filter((p, j) =>
                      p.some((v, axis) => v - path[j + 1][axis] !== path[j + 1][axis] - path[j][axis]),
                    ).length,
                0,
              ),
            0,
          ),
        }
      : {}),
    groups: groups.length,
    units: groups.reduce((s, g) => s + g.units.length, 0),
    blocks,
    hatches,
    pipeBlocks: sum(
      routed.filter((n) => n.kind !== 'power'),
      (r) => r.length,
    ),
    cableBlocks: sum(
      routed.filter((n) => n.kind === 'power'),
      (r) => r.length,
    ),
    connected: sum(routed, (r) => r.connected),
    terminals: sum(routed, (r) => r.total),
  };
}

/** Height in blocks of each built group, for `arrangeSite`'s floors. */
export function localHeights(build: SiteBuild): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of build.groups) if (g.build) out.set(g.group.id, g.build.size[1]);
  return out;
}

/** Local footprint [x, z] (before rotation) of each built group, for `arrangeSite`. */
export function localFootprints(build: SiteBuild): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const g of build.groups) if (g.build) out.set(g.group.id, [g.build.size[0], g.build.size[2]]);
  return out;
}
