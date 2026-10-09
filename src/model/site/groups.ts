import { withSteamFrame } from '../multiblock/steamWaterPump';
import { getSiteDef } from '../../data/generic';
import { effectiveSize, sizedDef } from '../resize';
import { singleMachineTiers } from '../../data/single-machines';
import type { PlacedGroup, SiteWarning } from './buildTypes';
import {
  buildGroup,
  placeHatch,
  placeUnit,
  rotatedGroupSize,
  type Demand,
  type GroupBuild,
  type Toward,
} from './group';
import { GROUP_STRIDE } from './ids';
import type { SiteGroup, SiteState } from './types';
import { withStructureGlass } from '../multiblock/glass';
import { withAssemblyGrowth } from '../multiblock/circuitAssemblyLine';

/**
 * Built groups by everything their build depends on (multiblock, size, count, limits, hatches, demand,
 * connections from below, pipe directions). Holds the build or its error; the builds are never mutated.
 */
export type GroupCache = Map<string, GroupBuild | { error: string }>;

/**
 * Every group of the site packed, given its hatches and placed on the site (turned, moved, with unit ids
 * made unique by `GROUP_STRIDE`). Reuses and refreshes `cache`, and drops the entries no group uses any
 * more (unless `prune` is off), so memory stays bounded while editing.
 */
export function placeGroups(
  site: SiteState,
  demands: ReadonlyMap<string, Demand>,
  towardOf: (g: SiteGroup) => Toward,
  below: boolean,
  cache: GroupCache,
  prune = true,
): { groups: PlacedGroup[]; warnings: SiteWarning[] } {
  const warnings: SiteWarning[] = [];
  const used = new Set<string>();
  const groups: PlacedGroup[] = site.groups.map((g, index) => {
    const raw = getSiteDef(g.multiblockId);
    const demand = demands.get(g.id) ?? {};
    const empty: PlacedGroup = {
      group: g,
      index,
      units: [],
      hatches: [],
      min: [g.origin[0], g.elevation ?? 0, g.origin[1]],
      max: [g.origin[0], g.elevation ?? 0, g.origin[1]],
      demand,
    };
    if (!raw) {
      warnings.push({ type: 'error', group: g.id, message: `Unknown multiblock "${g.multiblockId}"` });
      return { ...empty, error: 'unknown' };
    }
    const def = withSteamFrame(
      withAssemblyGrowth(
        withStructureGlass(sizedDef(raw, effectiveSize(raw, g.size)), g.structureGlassTier),
        g.assemblyGrowth,
      ),
      g.steamFrameTier,
    );
    if (g.size !== undefined && effectiveSize(raw, g.size) !== g.size)
      warnings.push({
        type: 'error',
        group: g.id,
        code: 'structure',
        message: `Stored size ${g.size} is not supported by RC2 for ${g.multiblockId}. Choose a supported size explicitly.`,
      });
    if (
      g.machine &&
      g.voltageTier &&
      singleMachineTiers(g.machine).length &&
      !singleMachineTiers(g.machine).includes(g.voltageTier)
    )
      warnings.push({
        type: 'error',
        group: g.id,
        code: 'tier',
        message: `${g.machine} has no ${g.voltageTier} variant in RC2. Select an existing tier.`,
      });
    const base = g.enabledHatches;
    const toward = towardOf(g);
    const ck = JSON.stringify([
      def.id,
      effectiveSize(raw, g.size) ?? null,
      g.count,
      g.limits,
      base,
      demand,
      below,
      toward,
      g.voltageTier,
      g.hatchTiers,
      g.resourceBindings,
      g.transformer,
      g.crackingFeedSide,
      g.manualTransformerMode,
      g.dataBankWireless,
      g.assemblyGrowth,
      g.structureGlassTier,
      g.steamFrameTier,
    ]);
    used.add(ck);
    let built = cache.get(ck);
    if (!built) {
      try {
        built = buildGroup(def, g.count, g.limits, base, demand, below, toward, g);
      } catch (err) {
        // Shown on the group; a malformed definition must not stop the rest of the site.
        built = { error: err instanceof Error ? err.message : String(err) };
      }
      cache.set(ck, built);
    }
    if ('error' in built) {
      warnings.push({ type: 'error', group: g.id, message: built.error });
      return { ...empty, def, error: built.error };
    }
    const b = built;
    for (const message of b.capacityProblems ?? [])
      warnings.push({ type: 'error', group: g.id, code: 'structure', message });
    const gid = (id: number) => index * GROUP_STRIDE + id;
    const units = b.units.map((u) => ({
      ...placeUnit(b.def, u, b.size, g.rotation, g.origin, g.elevation),
      id: gid(u.id),
    }));
    const hatches = b.hatches.map((h) => ({
      ...placeHatch(h, b.size, g.rotation, g.origin, g.elevation),
      unitIds: h.unitIds.map(gid),
    }));
    const rs = rotatedGroupSize(b.size, g.rotation);
    const elevation = g.elevation ?? 0;
    if (b.pack.placed < b.pack.requested)
      warnings.push({ type: 'fewer', group: g.id, placed: b.pack.placed, requested: b.pack.requested });
    if (b.unplaced.length) warnings.push({ type: 'unplaced', group: g.id, count: b.unplaced.length });
    const missingBy = new Map<string, number>();
    for (const m of b.missing) missingBy.set(m.resource, (missingBy.get(m.resource) ?? 0) + 1);
    for (const [resource, n] of missingBy)
      warnings.push({ type: 'missing', group: g.id, resource, units: n });
    return {
      group: g,
      index,
      def: b.def,
      build: b,
      units,
      hatches,
      min: [g.origin[0], elevation, g.origin[1]],
      max: [g.origin[0] + rs[0], elevation + rs[1], g.origin[1] + rs[2]],
      demand,
    };
  });
  if (prune) for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
  return { groups, warnings };
}
