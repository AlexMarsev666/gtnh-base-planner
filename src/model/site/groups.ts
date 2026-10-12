import { getSiteDef } from '../../data/generic';
import { withCoil } from '../coil';
import { effectiveSharing, withSharing } from '../hatches/sharing';
import { mirroredDef } from '../mirror';
import { effectiveSize, sizedDef } from '../resize';
import { DEFAULT_TIER, hatchTier } from '../tiers';
import { glassTierProblems, type UnitValidity } from '../validity';
import type { PlacedGroup, SiteWarning } from './buildTypes';
import {
  buildGroup,
  IO_KINDS,
  placeHatch,
  placeUnit,
  rotatedGroupSize,
  type Demand,
  type GroupBuild,
  type GroupNote,
  type GroupProblem,
  type Toward,
  type WithGroup,
} from './group';
import { GROUP_STRIDE } from './ids';
import { groupHatchKeys } from './siteScene';
import type { SiteGroup, SiteState } from './types';

/**
 * Built groups by everything their build depends on (multiblock, size, count, limits, hatches, demand,
 * connections from below, pipe directions, shared hatches). Holds the build or its error; the builds are
 * never mutated.
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
): {
  groups: PlacedGroup[];
  warnings: SiteWarning[];
  notes: WithGroup<GroupNote>[];
  problems: WithGroup<GroupProblem>[];
} {
  const warnings: SiteWarning[] = [];
  const notes: WithGroup<GroupNote>[] = [];
  const problems: WithGroup<GroupProblem>[] = [];
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
    const sized = sizedDef(raw, effectiveSize(raw, g.size));
    const turned = g.mirror ? mirroredDef(sized) : sized;
    const shaped = withCoil(turned, g.coil);
    const sharing = effectiveSharing(shaped, { maintenance: g.shareMaintenance, energy: g.shareEnergy });
    const def = withSharing(shaped, sharing);
    // Only the choices that name a resource this group has can matter (a stale entry must not rebuild it).
    const assign = Object.fromEntries(
      Object.entries(g.assign ?? {})
        .filter(([r]) => Object.values(demand).some((list) => list?.includes(r)))
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    const base = g.enabledHatches.filter((k) => !IO_KINDS.includes(k));
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
      g.mirror ?? false,
      shaped === turned ? null : g.coil,
      g.wallshare ?? 'auto',
      sharing.maintenance,
      sharing.energy,
      assign,
    ]);
    used.add(ck);
    let built = cache.get(ck);
    if (!built) {
      try {
        built = buildGroup(def, g.count, g.limits, base, demand, below, toward, {
          assign,
          wallshare: g.wallshare,
        });
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
    // Unmet requirements (`reason` required) and the overload are told by `problems`, once each.
    const failed = b.unplaced.filter((u) => u.reason !== 'required' && u.reason !== 'capacity').length;
    if (failed) warnings.push({ type: 'unplaced', group: g.id, count: failed });
    for (const n of b.notes) notes.push({ ...n, group: g.id });
    for (const p of b.problems) problems.push({ ...p, group: g.id });
    const missingBy = new Map<string, number>();
    for (const m of b.missing) missingBy.set(m.resource, (missingBy.get(m.resource) ?? 0) + 1);
    for (const [resource, n] of missingBy)
      warnings.push({ type: 'missing', group: g.id, resource, units: n });
    // Tiers are not part of the build's cache key (they re-tier hatches, not re-pack), so this is checked here.
    const keys = groupHatchKeys(
      hatches,
      units.map((u) => u.id),
    );
    const glass = glassTierProblems(b.def, hatches, {
      glassTier: g.glassTier,
      hatchTierOf: (i) => hatchTier(hatches[i].kind, keys[i], g.tier ?? DEFAULT_TIER, g.hatchTiers),
    });
    const glassValidity: UnitValidity = Object.fromEntries([...glass].sort(([a], [z]) => a - z));
    return {
      group: g,
      index,
      def: b.def,
      build: b,
      units,
      hatches,
      ...(glass.size > 0 ? { glassValidity } : {}),
      min: [g.origin[0], elevation, g.origin[1]],
      max: [g.origin[0] + rs[0], elevation + rs[1], g.origin[1] + rs[2]],
      demand,
    };
  });
  if (prune) for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
  return { groups, warnings, notes, problems };
}
