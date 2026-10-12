import { HATCH_PRIORITY } from '../hatches/constants';
import { quota } from '../hatches/quota';
import type { CapacityEntry, HatchRequest, UnplacedHatch } from '../hatches/types';
import type { HatchKind, MultiblockDef } from '../multiblock/types';
import type { WallshareMode } from '../plan/types';
import type { WallshareFallback } from '../layout/types';
import type { Demand } from './group';
import type { HatchAssign } from './types';

/** Turning a group's demand and `SiteGroup.assign` into the hatch requests the placer takes. */

/** Something the user should know about a group that is not wrong: what the build did on its own. */
export type GroupNote =
  /** The resources did not fit as a full set on every unit, so each unit got a share of them. */
  | { type: 'distributed'; resources: string[] }
  /** The wallshare preference could not be honoured (see `WallshareFallback`). */
  /** An `all` resource could not share one hatch among every unit and got several. */
  | { type: 'split'; resource: string; hatches: number }
  | { type: 'wallshare'; wanted: WallshareMode; used: WallshareMode; reason: WallshareFallback['reason'] };

/** Why a hatch is missing for a reason other than being over full or on a unit that is not there. */
export type HatchProblemReason = Exclude<NonNullable<UnplacedHatch['reason']>, 'capacity' | 'noUnit'>;

/** A choice of the user, or a requirement, that the build could not meet. */
export type GroupProblem =
  /** `assign[resource].unit` names a unit the group does not have (its count is lower); no hatch is placed. */
  | { type: 'assignInactive'; resource: string; unit: number }
  /** Units want more hatches than they have cells for: the worst overload (most to remove) of the group. */
  | { type: 'capacity'; needed: number; fits: number; remove: number; units: number; mandatory?: true }
  /** Hatches that found no place, or requirements left open; one per kind, reason and region. */
  | {
      type: 'hatch';
      kind: HatchKind;
      reason: HatchProblemReason;
      region?: string;
      /** Resources (request keys) that went without. */
      resources: string[];
      /** Units that went without. */
      units: number;
    };

/** A note or problem of one group of a site. */
export type WithGroup<T> = T extends unknown ? T & { group: string } : never;

/** A resource hatch the build may spread over the units. */
export interface AutoHatch {
  kind: HatchKind;
  resource: string;
  zone?: string;
}

export interface GroupRequests {
  /** Hatches that are not up to the build: plain kinds, and resources the user assigned. */
  fixed: HatchRequest[];
  /** Resources without `assign.unit`: wanted on every unit, or spread when that does not fit. */
  auto: AutoHatch[];
  problems: GroupProblem[];
}

/**
 * The requests of a group. `base` are the plain kinds to place (energy, maintenance, ...; a kind with
 * resources in `demand` gets one hatch per resource instead), `unitIds` the units that are placed. An assigned
 * unit that is not placed gets no hatch and is reported.
 */
export function groupRequests(
  def: MultiblockDef,
  base: readonly HatchKind[],
  demand: Demand,
  assign: Readonly<Record<string, HatchAssign>> | undefined,
  unitIds: readonly number[],
  count: number,
): GroupRequests {
  const fixed: HatchRequest[] = [];
  const auto: AutoHatch[] = [];
  const problems: GroupProblem[] = [];
  const active = new Set(unitIds);
  const withResources = (k: HatchKind) => (demand[k]?.length ?? 0) > 0;
  for (const kind of base) {
    if (withResources(kind) || def.hatchBlocks?.[kind] === undefined) continue;
    for (let n = 0; n < quota(def, kind).target; n++) fixed.push({ kind, units: 'each' });
  }
  for (const [kind, list] of Object.entries(demand) as [HatchKind, string[]][]) {
    for (const resource of list ?? []) {
      const a = assign?.[resource];
      const inZone = a?.zone ? { zone: a.zone } : {};
      if (a?.unit === 'all') fixed.push({ kind, units: [...unitIds], key: resource, ...inZone });
      else if (typeof a?.unit === 'number') {
        if (active.has(a.unit)) fixed.push({ kind, units: [a.unit], key: resource, ...inZone });
        // A unit below the count that was not placed is the packer's shortfall (`fewer`), not the user's.
        else if (a.unit >= count) problems.push({ type: 'assignInactive', resource, unit: a.unit });
      } else auto.push({ kind, resource, ...inZone });
    }
  }
  return { fixed, auto, problems };
}

const zone = (a: AutoHatch) => (a.zone ? { zone: a.zone } : {});

/** Every auto resource on every unit, after the fixed hatches. */
export function fullRequests(r: Pick<GroupRequests, 'fixed' | 'auto'>): HatchRequest[] {
  return [
    ...r.fixed,
    ...r.auto.map((a) => ({ kind: a.kind, units: 'each' as const, key: a.resource, ...zone(a) })),
  ];
}

/** What a unit needs of a hatch kind: how many hatches the resources `keys` fill (see `packBuses`). */
type CapacityOf = (kind: HatchKind, key: string, unitIndex: number) => number;

/**
 * Hatches of `kind` a unit needs: the unkeyed requests of `fixed` count one each, the resources of a multi kind
 * (the keyed requests of `fixed`, then `auto`) fill hatches as `packBuses` fills them (per zone), any other
 * keyed request gets its own.
 */
function hatchesOf(
  kind: HatchKind,
  unitIndex: number,
  fixed: readonly HatchRequest[],
  auto: readonly AutoHatch[],
  capacityOf: CapacityOf,
): number {
  if (!MULTI_KINDS.includes(kind)) return fixed.length + auto.length;
  const byZone = new Map<string, string[]>();
  let n = 0;
  const add = (key: string, zone: string | undefined) => {
    const id = zone ?? '';
    byZone.set(id, [...(byZone.get(id) ?? []), key]);
  };
  for (const f of fixed)
    if (f.key === undefined) n++;
    else add(f.key, f.zone);
  for (const a of auto) add(a.resource, a.zone);
  for (const keys of byZone.values())
    for (let at = 0; at < keys.length; n++) at += Math.max(1, capacityOf(kind, keys[at], unitIndex));
  return n;
}

/**
 * Whether the auto resources are worth spreading: some unit is over full, or at a kind's maximum. Counts are
 * of hatches, with the resources of a multi kind merged (see `packBuses`).
 */
export function overloaded(
  r: Pick<GroupRequests, 'fixed' | 'auto'>,
  capacity: readonly CapacityEntry[] | undefined,
  unplaced: readonly UnplacedHatch[],
  unitIds: readonly number[],
  capacityOf: CapacityOf,
): boolean {
  if (r.auto.length === 0) return false;
  const ids = [...unitIds].sort((a, b) => a - b);
  const kinds = [...new Set(r.fixed.map((f) => f.kind))];
  // An overload the fixed hatches alone cause (mandatory ones that do not fit) is not for spreading to fix.
  const fixedOf = (id: number) =>
    kinds.reduce(
      (n, kind) =>
        n +
        hatchesOf(
          kind,
          ids.indexOf(id),
          r.fixed.filter((f) => f.kind === kind && (f.units === 'each' || f.units.includes(id))),
          [],
          capacityOf,
        ),
      0,
    );
  if (capacity?.some((c) => c.remove > 0 && c.needed > Math.min(...c.unitIds.map(fixedOf)))) return true;
  const keys = new Set(r.auto.map((a) => a.resource));
  return unplaced.some(
    (u) =>
      u.reason === 'max' &&
      u.key !== undefined &&
      (keys.has(u.key) || (MULTI_KINDS.includes(u.kind) && r.auto.some((a) => a.kind === u.kind))),
  );
}

/**
 * The auto resources spread over the units, deterministic and balanced: first every resource goes to the unit
 * with the most room left (lowest id on ties), then units take more of them, the least loaded first, while
 * they have room. A unit's room is what it wants less what `capacity` says does not fit, and never beyond a
 * kind's `max`; all of it counted in hatches, where the resources of a multi kind fill hatches as `packBuses`
 * fills them, so a resource that fits a hatch the unit has anyway costs nothing. Each resource lands on at
 * least one unit, room or not.
 */
export function distributedRequests(
  def: MultiblockDef,
  unitIds: readonly number[],
  r: Pick<GroupRequests, 'fixed' | 'auto'>,
  capacity: readonly CapacityEntry[] | undefined,
  capacityOf: CapacityOf,
): HatchRequest[] {
  const ids = [...unitIds].sort((a, b) => a - b);
  const remove = new Map<number, number>();
  for (const c of capacity ?? [])
    for (const id of c.unitIds) remove.set(id, (remove.get(id) ?? 0) + c.remove);
  const kinds = [...new Set(r.auto.map((a) => a.kind))];
  const given: number[][] = r.auto.map(() => []);
  const every = r.auto.map((_, i) => i);
  /** Hatches of `kind` on unit `id` when it takes the auto resources `mine` (indices) and nothing else. */
  const hatches = (kind: HatchKind, id: number, mine: readonly number[]) =>
    hatchesOf(
      kind,
      ids.indexOf(id),
      r.fixed.filter((f) => f.kind === kind && (f.units === 'each' || f.units.includes(id))),
      mine.filter((i) => r.auto[i].kind === kind).map((i) => r.auto[i]),
      capacityOf,
    );
  const taken = (id: number) => every.filter((i) => given[i].includes(id));
  /** Hatches the auto resources `mine` add to unit `id`. */
  const added = (id: number, mine: readonly number[]) =>
    kinds.reduce((n, kind) => n + hatches(kind, id, mine) - hatches(kind, id, []), 0);
  const room = new Map(ids.map((id) => [id, added(id, every) - (remove.get(id) ?? 0)]));
  const left = (id: number) => room.get(id)! - added(id, taken(id));
  /** Hatches resource `i` would add to unit `id`, or null when that takes it past the kind's `max`. */
  const cost = (i: number, id: number): number | null => {
    const kind = r.auto[i].kind;
    const now = hatches(kind, id, taken(id));
    const after = hatches(
      kind,
      id,
      [...taken(id), i].sort((x, y) => x - y),
    );
    return after > now && after > quota(def, kind).max ? null : after - now;
  };
  // A resource that fits a hatch the unit has anyway is given for free, but only when all the resources of its
  // kind fit one unit: else the free slot is better kept for a resource that found no room elsewhere.
  const fitsAll = (kind: HatchKind, id: number) => hatches(kind, id, every) <= quota(def, kind).max;
  const give = (i: number, id: number) => given[i].push(id);
  r.auto.forEach((_, i) => {
    const open = ids.filter((id) => cost(i, id) !== null);
    const from = open.length > 0 ? open : ids;
    give(
      i,
      from.reduce((best, id) => (left(id) > left(best) ? id : best)),
    );
  });
  for (let more = true; more;) {
    more = false;
    r.auto.forEach((_, i) => {
      const open = ids.filter((id) => {
        if (given[i].includes(id)) return false;
        const c = cost(i, id);
        return c !== null && (c === 0 ? fitsAll(r.auto[i].kind, id) : left(id) > 0);
      });
      if (open.length === 0) return;
      const load = (id: number) => taken(id).length;
      give(
        i,
        open.reduce((best, id) => (load(id) < load(best) ? id : best)),
      );
      more = true;
    });
  }
  return [
    ...r.fixed,
    ...r.auto.map((a, i) => ({
      kind: a.kind,
      units: given[i].sort((x, y) => x - y),
      key: a.resource,
      ...zone(a),
    })),
  ];
}

/** Hatch kinds whose hatches hold several resources (see `hatchCapacity`). */
export const MULTI_KINDS: readonly HatchKind[] = ['itemIn', 'itemOut', 'fluidIn'];

/**
 * `requests` with the keyed hatches of the multi kinds merged per unit: the resources a unit takes of a kind (in
 * the same zone) go into as few hatches as `capacityOf(kind, first resource, unit index)` allows, filled in
 * request order. A merged request has `key` (its first resource) and `keys`; units that fill their hatches the
 * same way share one request. Requests that merge nothing come back as they were, in their order.
 */
export function packBuses(
  requests: readonly HatchRequest[],
  unitIds: readonly number[],
  capacityOf: (kind: HatchKind, key: string, unitIndex: number) => number,
): HatchRequest[] {
  const ids = [...unitIds].sort((a, b) => a - b);
  interface Pool {
    kind: HatchKind;
    members: HatchRequest[];
  }
  const pools = new Map<string, Pool>();
  const slots: (HatchRequest | Pool)[] = [];
  for (const r of requests) {
    if (!MULTI_KINDS.includes(r.kind) || r.key === undefined || r.keys !== undefined) {
      slots.push(r);
      continue;
    }
    const id = JSON.stringify([r.kind, r.zone ?? null]);
    let pool = pools.get(id);
    if (!pool) {
      pool = { kind: r.kind, members: [] };
      pools.set(id, pool);
      slots.push(pool);
    }
    pool.members.push(r);
  }
  const packed = (pool: Pool): HatchRequest[] => {
    const named = (r: HatchRequest, id: number) => r.units === 'each' || r.units.includes(id);
    const chunks = new Map<string, { keys: string[]; units: number[] }>();
    ids.forEach((id, i) => {
      const keys = pool.members.filter((m) => named(m, id)).map((m) => m.key!);
      for (let at = 0; at < keys.length;) {
        const chunk = keys.slice(at, at + Math.max(1, capacityOf(pool.kind, keys[at], i)));
        at += chunk.length;
        const e = chunks.get(JSON.stringify(chunk)) ?? { keys: chunk, units: [] };
        e.units.push(id);
        chunks.set(JSON.stringify(chunk), e);
      }
    });
    const first = (keys: string[]) => pool.members.findIndex((m) => m.key === keys[0]);
    return [...chunks.values()]
      .sort((a, b) => first(a.keys) - first(b.keys))
      .map(({ keys, units }) => {
        const all = units.length === ids.length ? ('each' as const) : units;
        const member = pool.members[first(keys)];
        const base: HatchRequest = { kind: pool.kind, units: all, key: keys[0] };
        if (member.zone !== undefined) base.zone = member.zone;
        if (keys.length > 1) return { ...base, keys };
        // Unmerged: the request itself when it names the same units.
        const same = member.units === 'each' ? all === 'each' : sameIds(member.units, units);
        return same ? member : base;
      });
  };
  return slots.flatMap((s) => ('members' in s ? packed(s) : [s]));
}

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === b[i]);

/**
 * `requests` completed with what the def requires of the kinds asked for (and of the `kinds` with resources): each
 * required region (a Distillation Tower wants an output on every layer) gets a resource hatch that has no zone,
 * in resource order, or else an unkeyed one; then unkeyed hatches fill up to `requiredHatches[kind].min`. A zone
 * the user set is never changed. Nothing is added for a kind nobody asked for.
 */
export function completeRequests(
  def: MultiblockDef,
  requests: readonly HatchRequest[],
  unitIds: readonly number[],
  kinds: readonly HatchKind[],
): HatchRequest[] {
  const names = (r: HatchRequest) => (r.units === 'each' ? unitIds : r.units);
  const naming = (out: readonly HatchRequest[], kind: HatchKind, id: number) =>
    out.filter((r) => r.kind === kind && names(r).includes(id));
  const out = requests.map((r) => ({ ...r }));
  for (const kind of HATCH_PRIORITY) {
    const regions = def.requiredHatches?.[kind]?.regions ?? [];
    if (regions.length === 0 || def.hatchBlocks?.[kind] === undefined) continue;
    if (!kinds.includes(kind) && !out.some((r) => r.kind === kind)) continue;
    // Resource hatches without a zone, in resource order, take the regions no zoned request names.
    const named = new Set(out.filter((r) => r.kind === kind && r.zone !== undefined).map((r) => r.zone));
    const free = regions.filter((g) => !named.has(g));
    const auto = out.filter((r) => r.kind === kind && r.zone === undefined && r.key !== undefined);
    auto.sort((a, b) => (a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0));
    for (const r of auto) if (free.length > 0) r.zone = free.shift();
    for (const region of regions) {
      const lacking = unitIds.filter((id) => !naming(out, kind, id).some((r) => r.zone === region));
      if (lacking.length > 0)
        out.push({ kind, units: lacking.length === unitIds.length ? 'each' : lacking, zone: region });
    }
  }
  for (const kind of kinds) {
    const min = def.requiredHatches?.[kind]?.min;
    if (!min || def.hatchBlocks?.[kind] === undefined) continue;
    const have = new Map(unitIds.map((id) => [id, naming(out, kind, id).length]));
    for (let n = 1; n <= min; n++) {
      const units = unitIds.filter((id) => have.get(id)! < n);
      if (units.length > 0) out.push({ kind, units: units.length === unitIds.length ? 'each' : units });
    }
  }
  return out;
}

/**
 * `requests` with the keyed hatches that found no cell moved: each unit that went without a resource gives it
 * up to a unit that does not have it and went without nothing of that kind, the one with the fewest hatches
 * placed (`placed`, per unit id), lowest id first (or just drops it when other units have the resource and none
 * has room). Only requests that list their units are moved. A hatch of `merged` (the requests `packBuses`
 * made of `requests`) that holds several resources moves them all together. Returns null when nothing can move.
 */
export function rebalanced(
  requests: readonly HatchRequest[],
  unplaced: readonly UnplacedHatch[],
  placed: ReadonlyMap<string, number>,
  unitIds: readonly number[],
  move = true,
  merged: readonly HatchRequest[] = [],
): HatchRequest[] | null {
  const out = requests.map((r) => ({ ...r }));
  const failed = new Set(unplaced.filter((u) => u.key !== undefined).map((u) => `${u.kind}/${u.unitId}`));
  let moved = false;
  for (const u of unplaced) {
    if (u.key === undefined) continue;
    const keys = merged.find(
      (m) =>
        m.keys !== undefined &&
        m.kind === u.kind &&
        m.key === u.key &&
        (m.units === 'each' || m.units.includes(u.unitId)),
    )?.keys ?? [u.key];
    const rs = keys.flatMap((key) => {
      const r = out.find(
        (x) => x.kind === u.kind && x.key === key && x.units !== 'each' && x.units.includes(u.unitId),
      );
      return r && r.units !== 'each' ? [r as HatchRequest & { units: readonly number[] }] : [];
    });
    if (rs.length === 0) continue;
    const have = rs[0].units;
    const to = (move ? unitIds : [])
      .filter((id) => !have.includes(id) && !failed.has(`${u.kind}/${id}`))
      .sort((a, b) => (placed.get(String(a)) ?? 0) - (placed.get(String(b)) ?? 0) || a - b)[0];
    if (to === undefined) {
      // Nowhere to go: the resources stay served by the units that have them.
      for (const r of rs)
        if (r.units.length > 1) {
          r.units = r.units.filter((id) => id !== u.unitId);
          moved = true;
        }
      continue;
    }
    for (const r of rs)
      r.units = [...new Set([...r.units.filter((id) => id !== u.unitId), to])].sort((a, b) => a - b);
    placed = new Map(placed).set(String(to), (placed.get(String(to)) ?? 0) + 1);
    moved = true;
  }
  return moved ? out : null;
}
