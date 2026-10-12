import { isSingleBlock } from '../../data/generic';
import { DefinitionError, defOfUnit, rotateDir, rotatedSize, step, unitCells } from '../geometry';
import { layoutCandidates, packUnits } from '../layout/packer';
import { resolveLayout } from '../plan';
import { placeHatches } from '../hatches/placement';
import { findSites } from '../hatches/sites';
import { inZone, resolveZone, withHatchZones } from '../hatches/zones';
import type { HatchAvoid, HatchRequest, PlaceOptions, PlaceResult, UnplacedHatch } from '../hatches/types';
import type { Dir, Rotation, Tier, Vec3 } from '../core/types';
import type { HatchKind, MultiblockDef, PlanLimits, Unit } from '../multiblock/types';
import type { HatchPlacement, PackResult, WallshareMode, WallStats } from '../plan/types';
import { checkValidity, type UnitValidity } from '../validity';
import { computeWallStats } from '../walls';
import { DEFAULT_TIER, followsGroupTier, hatchCapacity, hatchTier, groupHatchKey } from '../tiers';
import { reachOf, type Reach, type Terminals } from './terminals';
import {
  distributedRequests,
  fullRequests,
  completeRequests,
  groupRequests,
  overloaded,
  packBuses,
  rebalanced,
  type GroupNote,
  type GroupProblem,
  type HatchProblemReason,
} from './requests';
import type { HatchAssign } from './types';

export type { GroupNote, GroupProblem, WithGroup } from './requests';

/** Hatch kinds that carry a link's resource into or out of a group. */
export const IN_KINDS: readonly HatchKind[] = ['itemIn', 'fluidIn', 'steamIn', 'energy'];
export const OUT_KINDS: readonly HatchKind[] = ['itemOut', 'fluidOut', 'dynamo'];
/** Kinds only links place (a site group never enables them by hand). */
export const IO_KINDS: readonly HatchKind[] = ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'steamIn'];

/** A hatch of a site group, with the resource it carries. */
export interface SiteHatch extends HatchPlacement {
  /** The resource it carries; with `resources`, the first of them. */
  resource?: string;
  /** Every resource of a hatch that holds several (a bus with several items, a Quadruple Input Hatch). */
  resources?: string[];
  /** Sides it may never face (GT `disallowFaces`, e.g. Distillation Tower layer outputs never face up). */
  blocked?: Dir[];
  /** Net id once the site has been routed. */
  net?: number;
}

/** Per hatch kind, the side (in the group's own frame) its pipes leave by: to a port or another group. */
export type Toward = Partial<Record<HatchKind, Dir>>;

/** How far out on its side a `Toward` direction points: far enough to act as a direction, not a spot. */
const TOWARD_REACH = 1000;

/**
 * `PlaceOptions.toward` points for a group's units: far out from the middle of their box on each kind's
 * side, at ground level (ports and most pipes are there).
 */
function towardPoints(
  def: MultiblockDef,
  units: readonly Unit[],
  toward: Toward,
): Partial<Record<HatchKind, Vec3>> {
  const out: Partial<Record<HatchKind, Vec3>> = {};
  const entries = Object.entries(toward) as [HatchKind, Dir][];
  if (entries.length === 0 || units.length === 0) return out;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const u of units) {
    const sz = rotatedSize(def, u.rotation);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], u.origin[i]);
      hi[i] = Math.max(hi[i], u.origin[i] + sz[i]);
    }
  }
  for (const [kind, dir] of entries) {
    const v = step([0, 0, 0], dir);
    out[kind] = [(lo[0] + hi[0]) / 2 + v[0] * TOWARD_REACH, lo[1], (lo[2] + hi[2]) / 2 + v[2] * TOWARD_REACH];
  }
  return out;
}

/** Resources a group must take or give per hatch kind, in a stable order. */
export type Demand = Partial<Record<HatchKind, string[]>>;

export interface GroupBuild {
  /** The def the group was built with (sized, and mirrored when asked). */
  def: MultiblockDef;
  /** Units and hatches in group-local coordinates, normalised so the min corner is (0, 0, 0). */
  units: Unit[];
  hatches: SiteHatch[];
  /** Local bounding box size. */
  size: Vec3;
  pack: PackResult;
  loosened: boolean;
  unplaced: UnplacedHatch[];
  stats: WallStats;
  /** A unit that ended up without a hatch for one of the resources it needs. */
  missing: { kind: HatchKind; resource: string; unitId: number }[];
  /** What the build did on its own (see `GroupNote`). */
  notes: GroupNote[];
  /** Choices and requirements it could not meet (see `GroupProblem`). */
  problems: GroupProblem[];
  /** What the game's structure check would object to, per unit (see `checkValidity`); absent when all is well. */
  validity?: UnitValidity;
  /** Where each resource's hatches may go (see `Terminals`); absent for single blocks. */
  ends?: Terminals;
}

/** Block of a hatch that holds several fluids. */
const QUAD_BLOCK = 'gt.hatch.quadInput';

/** Times the spread resources are moved to units with room after a placement (see `rebalanced`). */
const REBALANCE_PASSES = 3;

/** The per-group choices `buildGroup` honours besides the machine and the demand. */
export interface GroupOptions {
  /** Where each resource's hatch goes (`SiteGroup.assign`). */
  assign?: Readonly<Record<string, HatchAssign>>;
  wallshare?: WallshareMode;
  /** The group's tier and `SiteGroup.hatchTiers`: they set how many resources a bus or input hatch holds. */
  tier?: Tier;
  hatchTiers?: Readonly<Record<string, Tier>>;
  /** Fluid inputs may share Quadruple Input Hatches (`SiteGroup.quadFluid`); false = one regular hatch per fluid. */
  quadFluid?: boolean;
}

/**
 * How many resources the hatch of `kind` that starts with `resource` holds on unit number `unitIndex` of the group
 * (see `hatchCapacity`): its tier is its own entry in `hatchTiers` (a hatch of that unit, else one shared by
 * several), else the group's tier.
 */
function capacityFor(opts: GroupOptions): (kind: HatchKind, resource: string, unitIndex: number) => number {
  const tier = opts.tier ?? DEFAULT_TIER;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(opts.hatchTiers ?? {}, key);
  return (kind, resource, unitIndex) => {
    const own = groupHatchKey(kind, resource, unitIndex);
    const key = has(own) ? own : groupHatchKey(kind, resource, 'shared');
    if (kind === 'fluidIn' && opts.quadFluid === false) return 1;
    return hatchCapacity(kind, hatchTier(kind, key, tier, opts.hatchTiers, followsGroupTier) ?? tier);
  };
}

/** Blocks from one layer of single-block machines to the next: the machine and two free blocks for pipes. */
export const SINGLE_LAYER_PITCH = 3;

/**
 * GT single-block machines: a grid with one free block between them, so each keeps open faces for IO.
 * `limits.x` caps the machines per row and `limits.y` stacks the grid in layers, each holding an equal share.
 */
function singleBlockLayout(count: number, limits: PlanLimits): Unit[] {
  const layers = Math.max(1, Math.min(limits.y ?? 1, count));
  const perLayer = Math.ceil(count / layers);
  const perRow = Math.max(1, Math.min(limits.x ?? Math.ceil(Math.sqrt(perLayer)), perLayer));
  return Array.from({ length: count }, (_, i) => {
    const layer = Math.floor(i / perLayer);
    const at = i % perLayer;
    return {
      id: i,
      origin: [(at % perRow) * 2, layer * SINGLE_LAYER_PITCH, Math.floor(at / perRow) * 3] as Vec3,
      rotation: 0 as Rotation,
    };
  });
}

/**
 * Limits that fit `count` single-block machines into `room` blocks along X and Z (either way round): the
 * fewest layers that do, else the most `maxLayers` allows with the squarest grid. The grid takes 2 blocks
 * per machine along a row and 3 per row.
 */
export function singleBlockLimits(count: number, room: [number, number], maxLayers: number): PlanLimits {
  let best: PlanLimits = { x: null, y: null, z: null };
  let bestSpan = Infinity;
  for (let layers = 1; layers <= maxLayers; layers++) {
    const perLayer = Math.ceil(count / layers);
    for (let perRow = 1; perRow <= perLayer; perRow++) {
      const span: [number, number] = [2 * perRow - 1, 3 * Math.ceil(perLayer / perRow) - 2];
      if ((span[0] <= room[0] && span[1] <= room[1]) || (span[1] <= room[0] && span[0] <= room[1]))
        return { x: perRow, y: layers, z: null };
      // Nothing fits yet: remember the squarest grid of the tallest stack.
      if (layers === maxLayers && Math.max(...span) < bestSpan) {
        bestSpan = Math.max(...span);
        best = { x: perRow, y: layers, z: null };
      }
    }
  }
  return best;
}

/** Faces a single-block machine offers for IO, in order (its front, north, stays free for the player). */
const SINGLE_FACES: readonly Dir[] = ['south', 'east', 'west', 'up'];

/** Local disallowed faces of the hatch cell (from the legend of the unit that holds it). */
function blockedFaces(def: MultiblockDef, units: Unit[], h: HatchPlacement): Dir[] | undefined {
  const unit = units.find((u) => u.id === h.unitIds[0]);
  if (!unit) return undefined;
  const cell = unitCells(def, unit).find(
    (c) => c.pos[0] === h.cell[0] && c.pos[1] === h.cell[1] && c.pos[2] === h.cell[2],
  );
  const dirs =
    cell?.role === 'casing' ? defOfUnit(def, unit).legend[cell.char]?.disallowFaces?.[h.kind] : undefined;
  return dirs?.map((d) => rotateDir(d, unit.rotation));
}

/**
 * Pack one group and place its hatches, in group-local coordinates. `demand` lists the resources per hatch
 * kind; `base` the other hatch kinds to place (energy, maintenance, muffler, ...).
 */
export function buildGroup(
  def: MultiblockDef,
  count: number,
  limits: PlanLimits,
  base: readonly HatchKind[],
  demand: Demand,
  below = false,
  toward: Toward = {},
  opts: GroupOptions = {},
): GroupBuild {
  if (isSingleBlock(def)) return buildSingleBlocks(def, count, limits, demand, opts.assign);
  const packed = packUnits(def, count, limits, opts.wallshare);
  const targets = towardPoints(def, packed.units, toward);
  // With `below`, hatches may face down from the lowest layer (see `PlaceOptions`); with `toward`, each
  // kind's hatches lean to the side its pipes leave by.
  // Requirements of kinds the group did not ask for (not enabled, no resources) are not its business: the
  // engine reports them, legacy builds neither placed nor reported them.
  const place = (d: MultiblockDef, u: Unit[], e: HatchKind[], a?: HatchAvoid, o?: PlaceOptions) => {
    const r = placeHatches(d, u, e, a, { below, toward: targets, ...o });
    const asked = o?.requests;
    if (!asked) return r;
    return {
      ...r,
      unplaced: r.unplaced.filter((x) => x.reason !== 'required' || asked.some((q) => q.kind === x.kind)),
    };
  };
  const deps = {
    placeHatches: place,
    layoutCandidates: (d: MultiblockDef, n: number, l: PlanLimits) =>
      layoutCandidates(d, n, l, opts.wallshare),
  };
  const unitIds = packed.units.map((u) => u.id).sort((a, b) => a - b);
  const wanted = groupRequests(def, base, demand, opts.assign, unitIds, count);
  const notes: GroupNote[] = [];
  const problems = [...wanted.problems];
  if (packed.fallback) notes.push({ type: 'wallshare', ...packed.fallback });
  const demandKinds = (Object.keys(demand) as HatchKind[]).filter((k) => demand[k]?.length);
  const capacity = capacityFor(opts);
  const pad = (r: HatchRequest[]) =>
    completeRequests(def, packBuses(r, unitIds, capacity), unitIds, demandKinds);
  let requests = pad(fullRequests(wanted));
  let resolved = resolveLayout(def, packed, [], limits, deps, undefined, requests);
  if (overloaded(wanted, resolved.hatches.capacity, resolved.hatches.unplaced, unitIds, capacity)) {
    // The full set does not fit: spread the resources over the units, from the layout just chosen, and move
    // what still finds no cell to units with room for it.
    let raw = distributedRequests(def, unitIds, wanted, resolved.hatches.capacity, capacity);
    let merged = pad(raw);
    let second = resolveLayout(def, resolved.pack, [], limits, deps, undefined, merged);
    let best = { raw, second };
    for (let pass = 0; pass <= REBALANCE_PASSES && second.hatches.unplaced.length > 0; pass++) {
      const placed = new Map<string, number>();
      for (const h of second.hatches.hatches)
        for (const id of h.unitIds) placed.set(String(id), (placed.get(String(id)) ?? 0) + 1);
      const moved = rebalanced(
        raw,
        second.hatches.unplaced,
        placed,
        unitIds,
        pass < REBALANCE_PASSES,
        merged,
      );
      if (!moved) break;
      raw = moved;
      merged = pad(raw);
      second = resolveLayout(def, second.pack, [], limits, deps, undefined, merged);
      if (second.hatches.unplaced.length < best.second.hatches.unplaced.length) best = { raw, second };
    }
    ({ raw, second } = best);
    // A tie keeps the full set.
    if (second.hatches.unplaced.length < resolved.hatches.unplaced.length) {
      requests = pad(raw);
      resolved = second;
      const subset = requests
        .filter((r) => r.units !== 'each' && r.units.length < unitIds.length)
        .flatMap((r) => r.keys ?? (r.key !== undefined ? [r.key] : []))
        .filter((key) => wanted.auto.some((a) => a.resource === key));
      if (subset.length > 0) notes.push({ type: 'distributed', resources: [...new Set(subset)] });
    }
  }
  // An `all` resource the engine could not share among the units.
  for (const r of wanted.fixed) {
    if (r.key === undefined || r.units === 'each' || r.units.length < 2) continue;
    const n = resolved.hatches.hatches.filter((h) => h.kind === r.kind && h.key === r.key).length;
    if (n > 1) notes.push({ type: 'split', resource: r.key, hatches: n });
  }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const u of resolved.pack.units) {
    const s = rotatedSize(def, u.rotation);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], u.origin[i]);
      hi[i] = Math.max(hi[i], u.origin[i] + s[i]);
    }
  }
  if (resolved.pack.units.length === 0) {
    lo.fill(0);
    hi.fill(0);
  }
  const shift = (p: Vec3): Vec3 => [p[0] - lo[0], p[1] - lo[1], p[2] - lo[2]];
  const units = resolved.pack.units.map((u) => ({ ...u, origin: shift(u.origin) }));
  const hatches: SiteHatch[] = resolved.hatches.hatches.map(({ key, keys, ...h }) => {
    const out: SiteHatch = { ...h, cell: shift(h.cell) };
    if (key !== undefined) out.resource = key;
    if (keys) {
      out.resources = keys;
      // A hatch that holds several fluids is a Quadruple Input Hatch.
      if (h.kind === 'fluidIn') out.block = QUAD_BLOCK;
    }
    const blocked = blockedFaces(def, resolved.pack.units, h);
    if (blocked?.length) out.blocked = blocked;
    return out;
  });
  // Every unit a request names should have its hatch.
  const missing: GroupBuild['missing'] = [];
  for (const r of requests) {
    if (r.key === undefined) continue;
    for (const id of r.units === 'each' ? unitIds : r.units)
      for (const resource of r.keys ?? [r.key])
        if (
          !hatches.some(
            (h) =>
              h.kind === r.kind && h.unitIds.includes(id) && (h.resources ?? [h.resource]).includes(resource),
          )
        )
          missing.push({ kind: r.kind, resource, unitId: id });
  }
  problems.push(...problemsOf(resolved.hatches));
  const validity = checkValidity(def, units, hatches);
  return {
    def,
    units,
    hatches,
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    pack: resolved.pack,
    loosened: resolved.loosened,
    unplaced: resolved.hatches.unplaced,
    stats: computeWallStats(def, units, hatches),
    missing,
    notes,
    problems,
    ...(Object.keys(validity).length > 0 ? { validity } : {}),
    ends: candidateEnds(def, resolved.pack.units, requests, below, shift),
  };
}

/**
 * Per resource key of `requests`, the box around the cells a hatch for it may take: structure cells with an open
 * face that allow its kind, in its zone, on a unit that asks for it (in the same frame as `shift` gives).
 */
function candidateEnds(
  def: MultiblockDef,
  units: readonly Unit[],
  requests: readonly HatchRequest[],
  below: boolean,
  shift: (p: Vec3) => Vec3,
): Terminals {
  const keyed = requests.filter((r) => r.key !== undefined);
  if (keyed.length === 0 || units.length === 0) return {};
  const zoned = withHatchZones(def);
  const ids = units.map((u) => u.id);
  let sites;
  try {
    sites = findSites(zoned, units, below).sites;
  } catch (err) {
    // A malformed definition places nothing: nothing to lean to. Anything else is a bug.
    if (err instanceof DefinitionError) return {};
    throw err;
  }
  const cells = new Map<string, [number, number][]>();
  for (const r of keyed) {
    const asked = r.units === 'each' ? ids : r.units;
    const zone = r.zone === undefined ? undefined : resolveZone(zoned, r.zone);
    for (const key of r.keys ?? [r.key!]) {
      const list = cells.get(key) ?? [];
      for (const site of sites) {
        if (!site.kinds.has(r.kind) || !site.faces.some((f) => !site.blocked.get(r.kind)?.has(f.dir)))
          continue;
        if (!site.unitIds.some((id) => asked.includes(id) && (zone === undefined || inZone(site, id, zone))))
          continue;
        const p = shift(site.pos);
        list.push([p[0], p[2]]);
      }
      cells.set(key, list);
    }
  }
  const out: Record<string, Reach> = {};
  for (const [key, list] of cells) {
    const box = reachOf(list);
    if (box) out[key] = box;
  }
  return out;
}

/** The capacity overload of a placement (the worst one) and its other unmet hatches, one entry each. */
function problemsOf(r: PlaceResult): GroupProblem[] {
  const out: GroupProblem[] = [];
  if (r.capacity?.length) {
    const worst = r.capacity.reduce((a, c) => (c.remove > a.remove ? c : a));
    const units = r.capacity.reduce((n, c) => n + c.unitIds.length, 0);
    out.push({
      type: 'capacity',
      needed: worst.needed,
      fits: worst.fits,
      remove: worst.remove,
      units,
      ...(r.capacity.some((c) => c.mandatory) ? { mandatory: true as const } : {}),
    });
  }
  const seen = new Map<
    string,
    { kind: HatchKind; reason: HatchProblemReason; region?: string; keys: Set<string>; ids: Set<number> }
  >();
  for (const u of r.unplaced) {
    if (u.reason === undefined || u.reason === 'capacity' || u.reason === 'noUnit') continue;
    const id = `${u.kind}\u0000${u.reason}\u0000${u.region ?? ''}`;
    let e = seen.get(id);
    if (!e) {
      e = { kind: u.kind, reason: u.reason, keys: new Set(), ids: new Set() };
      if (u.region !== undefined) e.region = u.region;
      seen.set(id, e);
    }
    if (u.key !== undefined) e.keys.add(u.key);
    e.ids.add(u.unitId);
  }
  for (const e of seen.values())
    out.push({
      type: 'hatch',
      kind: e.kind,
      reason: e.reason,
      ...(e.region !== undefined ? { region: e.region } : {}),
      resources: [...e.keys],
      units: e.ids.size,
    });
  return out;
}

function buildSingleBlocks(
  def: MultiblockDef,
  count: number,
  limits: PlanLimits,
  demand: Demand,
  assign: GroupOptions['assign'],
): GroupBuild {
  const units = singleBlockLayout(count, limits);
  const flows = Object.entries(demand).flatMap(([kind, list]) =>
    (list ?? []).map((r) => [kind as HatchKind, r] as const),
  );
  const hatches: SiteHatch[] = [];
  const missing: GroupBuild['missing'] = [];
  const problems: GroupProblem[] = [];
  const ids = new Set(units.map((u) => u.id));
  for (const [, resource] of flows) {
    const unit = assign?.[resource]?.unit;
    if (
      typeof unit === 'number' &&
      !ids.has(unit) &&
      !problems.some((p) => p.type === 'assignInactive' && p.resource === resource)
    )
      problems.push({ type: 'assignInactive', resource, unit });
  }
  for (const u of units)
    flows.forEach(([kind, resource], i) => {
      const only = assign?.[resource]?.unit;
      if (typeof only === 'number' && only !== u.id) return;
      // More flows than faces: the extras share the top face (a pipe may still come in from any side).
      hatches.push({
        kind,
        resource,
        cell: u.origin,
        face: SINGLE_FACES[Math.min(i, SINGLE_FACES.length - 1)],
        unitIds: [u.id],
      });
    });
  const size: Vec3 = units.length
    ? [
        Math.max(...units.map((u) => u.origin[0])) + 1,
        Math.max(...units.map((u) => u.origin[1])) + 1,
        Math.max(...units.map((u) => u.origin[2])) + 1,
      ]
    : [0, 0, 0];
  const stats: WallStats = {
    totalBlocks: units.length,
    byBlock: { [def.controller.blockId]: units.length },
    controllers: units.length,
    hatches: 0,
    sharedWalls: [],
    conflicts: [],
    conflictCells: [],
    savedBlocks: 0,
  };
  return {
    def,
    units,
    hatches,
    size,
    pack: { units, requested: count, placed: units.length },
    loosened: false,
    unplaced: [],
    stats,
    missing,
    notes: [],
    problems,
  };
}

/**
 * Place a local point of a group of local size `size` on the site: turn it `r` times, then move it (along the
 * ground by `origin`, upwards by `elevation`).
 */
export function groupPoint(p: Vec3, size: Vec3, r: Rotation, origin: [number, number], elevation = 0): Vec3 {
  let [x, y, z] = p;
  let sx = size[0];
  let sz = size[2];
  for (let i = 0; i < r; i++) {
    const nx = sz - 1 - z;
    z = x;
    x = nx;
    [sx, sz] = [sz, sx];
  }
  return [x + origin[0], y + elevation, z + origin[1]];
}

/** Size of the group's bounding box after rotation. */
export function rotatedGroupSize(size: Vec3, r: Rotation): Vec3 {
  return r % 2 === 0 ? size : [size[2], size[1], size[0]];
}

/** A unit of a group, placed on the site (see `groupPoint`). */
export function placeUnit(
  def: MultiblockDef,
  u: Unit,
  size: Vec3,
  r: Rotation,
  origin: [number, number],
  elevation = 0,
): Unit {
  const s = rotatedSize(def, u.rotation);
  const a = groupPoint(u.origin, size, r, origin, elevation);
  const b = groupPoint(
    [u.origin[0] + s[0] - 1, u.origin[1], u.origin[2] + s[2] - 1],
    size,
    r,
    origin,
    elevation,
  );
  return {
    id: u.id,
    origin: [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])],
    rotation: ((u.rotation + r) % 4) as Rotation,
    ...(u.variant ? { variant: u.variant } : {}),
  };
}

export function placeHatch(
  h: SiteHatch,
  size: Vec3,
  r: Rotation,
  origin: [number, number],
  elevation = 0,
): SiteHatch {
  const out: SiteHatch = {
    ...h,
    cell: groupPoint(h.cell, size, r, origin, elevation),
    face: rotateDir(h.face, r),
  };
  if (h.blocked) out.blocked = h.blocked.map((d) => rotateDir(d, r));
  return out;
}
