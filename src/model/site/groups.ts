import { getSiteDef } from '../../data/generic';
import { withCoil } from '../coil';
import { effectiveSharing, withSharing } from '../hatches/sharing';
import { mirroredDef } from '../mirror';
import type { Tier, Vec3 } from '../core/types';
import type { MultiblockDef } from '../multiblock/types';
import { effectiveSize, sizedDef } from '../resize';
import { DEFAULT_TIER, followsGroupTier, hatchTier } from '../tiers';
import { glassTierProblems, type UnitValidity } from '../validity';
import type { PlacedGroup, SiteWarning } from './buildTypes';
import {
  IO_KINDS,
  layoutGroup,
  layoutSize,
  leanGroup,
  placeHatch,
  placeUnit,
  rotatedGroupSize,
  type Demand,
  type GroupBuild,
  type GroupLayout,
  type GroupNote,
  type GroupProblem,
  type Toward,
  type WithGroup,
} from './group';
import { sharedPlanes, type PlacedBox } from './groupFaces';
import { GROUP_STRIDE } from './ids';
import { MULTI_KINDS } from './requests';
import { groupHatchKeys } from './siteScene';
import type { SiteGroup, SiteState } from './types';

/**
 * Built groups by everything their build depends on (multiblock, size, count, limits, hatches, demand,
 * connections from below, pipe directions, shared hatches). Holds the build or its error; the builds are
 * never mutated.
 */
export type GroupCache = Map<string, GroupBuild | { error: string }>;

/**
 * Per `GroupCache`, the layouts its builds came from, by the same key without the pipe directions: a group
 * whose neighbours moved keeps its layout and only re-places its hatches (see `layoutGroup`, `leanGroup`).
 * Pruned only together with the cache (when `prune` is on).
 */
const layoutsOf = new WeakMap<GroupCache, Map<string, GroupLayout | { error: string }>>();

/**
 * Per `GroupCache`, the builds with hatches kept off a shared plane (see `leanGroup`), least recently used
 * first and at most `MAX_AVOIDED`: Optimize tries many layouts with groups flush, each with its own planes,
 * and they must not crowd out or outlive the cache's ordinary entries. Never pruned with the cache.
 */
const avoidedOf = new WeakMap<GroupCache, Map<string, GroupBuild | { error: string }>>();
const MAX_AVOIDED = 128;

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
  const usedLayouts = new Set<string>();
  const avoided = avoidedOf.get(cache) ?? new Map<string, GroupBuild | { error: string }>();
  avoidedOf.set(cache, avoided);
  const layouts = layoutsOf.get(cache) ?? new Map<string, GroupLayout | { error: string }>();
  layoutsOf.set(cache, layouts);
  /** Everything about a group that does not depend on its neighbours: its layout (and so its footprint). */
  interface Prepared {
    g: SiteGroup;
    index: number;
    demand: Demand;
    empty: PlacedGroup;
    /** Absent for a multiblock that does not exist. */
    known?: {
      def: MultiblockDef;
      layout: GroupLayout | { error: string };
      layoutKey: unknown[];
      toward: Toward;
      tier: Tier;
    };
  }
  const prepared: Prepared[] = site.groups.map((g, index) => {
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
    if (!raw) return { g, index, demand, empty };
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
    // The tiers that set how many resources a bus or input hatch holds (others do not rebuild the group).
    const tier = g.tier ?? DEFAULT_TIER;
    const busTiers = Object.fromEntries(
      Object.entries(g.hatchTiers ?? {})
        .filter(([key]) =>
          MULTI_KINDS.some((kind) => demand[kind]?.some((r) => key.startsWith(`${kind}:${r}:`))),
        )
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    const layoutKey = [
      def.id,
      effectiveSize(raw, g.size) ?? null,
      g.count,
      g.limits,
      base,
      demand,
      below,
      g.mirror ?? false,
      shaped === turned ? null : g.coil,
      g.wallshare ?? 'auto',
      sharing.maintenance,
      sharing.energy,
      assign,
      tier,
      busTiers,
      g.quadFluid ?? true,
    ];
    // `toward` moves hatches, never the layout, so it is not part of the layout's key.
    const lk = JSON.stringify(layoutKey);
    usedLayouts.add(lk);
    // Shown on the group when it fails; a malformed definition must not stop the rest of the site.
    let layout = layouts.get(lk);
    if (!layout) {
      try {
        layout = layoutGroup(def, g.count, g.limits, base, demand, below, {
          assign,
          wallshare: g.wallshare,
          tier,
          hatchTiers: busTiers,
          quadFluid: g.quadFluid,
        });
      } catch (err) {
        layout = { error: err instanceof Error ? err.message : String(err) };
      }
      layouts.set(lk, layout);
    }
    return { g, index, demand, empty, known: { def, layout, layoutKey, toward, tier } };
  });
  // Where groups touch by one block, the plane they may share: hatches keep off it (see `leanGroup`).
  const planes = sharedPlanes(
    prepared.map((p): PlacedBox | undefined =>
      p.known && !('error' in p.known.layout)
        ? {
            origin: p.g.origin,
            elevation: p.g.elevation ?? 0,
            rotation: p.g.rotation,
            size: layoutSize(p.known.layout),
            separate: p.g.wallshare === 'separate',
          }
        : undefined,
    ),
  );
  const groups: PlacedGroup[] = prepared.map(({ g, index, demand, empty, known }) => {
    if (!known) {
      warnings.push({ type: 'error', group: g.id, message: `Unknown multiblock "${g.multiblockId}"` });
      return { ...empty, error: 'unknown' };
    }
    const { def, layout, layoutKey, toward, tier } = known;
    const ck = JSON.stringify([...layoutKey, toward]);
    used.add(ck);
    const lean = (avoid?: readonly Vec3[]): GroupBuild | { error: string } => {
      try {
        return 'error' in layout ? layout : leanGroup(layout, toward, avoid);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };
    let built = cache.get(ck);
    if (!built) {
      built = lean();
      cache.set(ck, built);
    }
    // Hatches are only moved when the plain placement has one on a plane the group may share, so groups
    // that merely stand next to each other keep the build they had.
    const avoid = planes[index];
    if (avoid.length > 0 && !('error' in built)) {
      const plane = new Set(avoid.map((c) => c.join()));
      if (built.hatches.some((h) => plane.has(h.cell.join()))) {
        // Layouts with groups flush are many and short-lived: their builds live in a small cache of their own.
        const ak = `${ck}|${avoid
          .map((c) => c.join())
          .sort()
          .join(';')}`;
        let again = avoided.get(ak);
        if (again) avoided.delete(ak);
        else again = lean(avoid);
        avoided.set(ak, again);
        if (avoided.size > MAX_AVOIDED) avoided.delete(avoided.keys().next().value!);
        built = again;
      }
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
    // Other tiers are not part of the build's cache key (they re-tier hatches, not re-pack), so this is checked here.
    const keys = groupHatchKeys(
      hatches,
      units.map((u) => u.id),
    );
    const glass = glassTierProblems(b.def, hatches, {
      glassTier: g.glassTier,
      hatchTierOf: (i) => hatchTier(hatches[i].kind, keys[i], tier, g.hatchTiers, followsGroupTier),
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
  if (prune) {
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    for (const k of [...layouts.keys()]) if (!usedLayouts.has(k)) layouts.delete(k);
  }
  return { groups, warnings, notes, problems };
}
