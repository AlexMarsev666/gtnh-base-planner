import type { Demand } from './group';
import type { ResourceBinding } from './types';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import type { Site } from '../hatches/types';
import { resourceRegion } from './resourceRoles';
import { alternativeHatchLimits, quota } from '../hatches/quota';
import { fixedHatchCounts } from '../multiblock/fixedHatches';
import { hatchCapacity } from '../multiblock/casingConstraints';
import { unitCells } from '../geometry';

export interface ResourceRequest {
  kind: HatchKind;
  resource: string;
  region?: string;
  ordinal: number;
  unitId?: number;
}

/** Links enable an interface for the group; they do not invent a per-controller minimum.
 * Explicit empty templates retain their former default quotas.
 */
export function resourceMinimum(def: MultiblockDef, kind: HatchKind, demand: Demand) {
  const req = def.requiredHatches?.[kind];
  return demand[kind]?.length
    ? Math.max(req?.min ?? 0, req?.regions?.length ?? 0, fixedHatchCounts(def)[kind] ?? 0)
    : quota(def, kind).target;
}

/** One request per resource/output slot, not one copy per controller. */
export function groupRequests(def: MultiblockDef, demand: Demand, bindings: readonly ResourceBinding[] = []) {
  return Object.entries(demand).flatMap(([key, list]) => {
    const kind = key as HatchKind;
    return [...new Set(list)].flatMap((resource) => {
      const matches = bindings.filter((b) => b.kind === kind && b.resource === resource);
      const slots =
        matches.length > 1
          ? [...new Set(matches.map((b) => JSON.stringify([b.role ?? null, b.outputSlot ?? null])))]
          : [];
      return (matches.length ? matches : [undefined]).flatMap((binding): ResourceRequest[] => {
        const region = resourceRegion(def, kind, binding);
        return region === null
          ? []
          : [
              {
                kind,
                resource,
                region,
                ordinal:
                  matches.length > 1
                    ? (binding?.outputSlot ?? slots.indexOf(JSON.stringify([binding?.role ?? null, null])))
                    : 0,
                unitId: binding?.unitId,
              },
            ];
      });
    });
  });
}

/** Prefer the historical complete set on every controller. Distribution is a fallback for a set
 * exceeding structural capacity/count limits, never a way to make a feasible ordinary group cheaper.
 * Manual unitId remains required coverage; it does not forbid copies on other controllers.
 */
export function fullResourcePlan(
  def: MultiblockDef,
  units: readonly Unit[],
  enabled: readonly HatchKind[],
  demand: Demand,
  requests: readonly ResourceRequest[],
) {
  if (!units.length) return;
  requests = [
    ...new Map(requests.map((r) => [JSON.stringify([r.kind, r.resource, r.region, r.ordinal]), r])).values(),
  ];
  const selectors: { kind: HatchKind; region?: string }[] = [];
  const counts = new Map(
    enabled.map((kind) => {
      const own = requests.filter((r) => r.kind === kind);
      const missing = (def.requiredHatches?.[kind]?.regions ?? []).filter(
        (region) => !own.some((r) => r.region === region),
      );
      const count = Math.max(resourceMinimum(def, kind, demand), own.length + missing.length);
      selectors.push(...own, ...missing.map((region) => ({ kind, region })));
      for (let i = own.length + missing.length; i < count; i++) selectors.push({ kind });
      return [kind, count] as const;
    }),
  );
  if (
    [...counts].some(([kind, count]) => count > (def.requiredHatches?.[kind]?.max ?? Infinity)) ||
    [...counts.values()].reduce((n, count) => n + count, 0) > hatchCapacity(def, units[0]).capacity ||
    Object.values(alternativeHatchLimits(def))
      .flat()
      .some((rule) => rule.anyOf!.reduce((n, kind) => n + (counts.get(kind) ?? 0), 0) > rule.max!)
  )
    return;
  // A necessary matching on one isolated controller also catches kind/role-specific capacity.
  // Access and shared-cell compatibility are still checked by the real placer on each layout.
  const cells = unitCells(def, units[0]);
  const choices = selectors.map(({ kind, region }) =>
    cells.flatMap((c, i) =>
      c.hatches?.includes(kind) && (!region || def.legend[c.char]?.region === region) ? [i] : [],
    ),
  );
  const owner = new Map<number, number>();
  const augment = (i: number, seen: Set<number>): boolean => {
    for (const cell of choices[i]) {
      if (seen.has(cell)) continue;
      seen.add(cell);
      const previous = owner.get(cell);
      if (previous === undefined || augment(previous, seen)) {
        owner.set(cell, i);
        return true;
      }
    }
    return false;
  };
  if (!choices.every((_, i) => augment(i, new Set()))) return;
  return new Map(units.map((unit) => [unit.id, requests]));
}

/** Necessary physical bound before packing or exploring any hatch/layout choices. Sharing can only
 * reduce the number of physical prerequisites, never give more capacity than the sum of controllers.
 */
export function groupDemandBound(
  def: MultiblockDef,
  count: number,
  enabled: readonly HatchKind[],
  demand: Demand,
  bindings: readonly ResourceBinding[] = [],
) {
  const breakdown = enabled.map((kind) => {
    const resources = [...new Set(demand[kind])].reduce(
      (sum, resource) =>
        sum +
        Math.max(
          1,
          new Set(
            bindings
              .filter((b) => b.kind === kind && b.resource === resource)
              .map((b) => JSON.stringify([b.role ?? null, b.outputSlot ?? null])),
          ).size,
        ),
      0,
    );
    const shared = def.wallshare && def.shareableHatches.includes(kind);
    return [
      kind,
      Math.max(resources, resourceMinimum(def, kind, demand) * (shared ? Number(count > 0) : count)),
    ] as const;
  });
  const needed = breakdown.reduce((n, [, value]) => n + value, 0);
  const capacity = count * hatchCapacity(def, { id: 0, origin: [0, 0, 0], rotation: 0 }).capacity;
  return {
    needed,
    capacity,
    message:
      needed > capacity
        ? `Group demand: at least ${needed} hatches required; total structure capacity ${capacity} ` +
          `(${count} controllers). Required: ${breakdown.map(([kind, n]) => `${kind} ${n}`).join(', ')}. ` +
          'A shared physical hatch consumes capacity in every controller containing its cell.'
        : undefined,
  };
}

/** Bounded machine-assignment backtracking, coupled to the physical placer by its caller. Every yielded
 * assignment receives a cell/face/tier search; failure resumes the machine choices. Minima reuse a
 * resource of the appropriate role, including on another controller (one agent, several machines).
 */
export function* resourceAllocations(
  def: MultiblockDef,
  units: readonly Unit[],
  enabled: readonly HatchKind[],
  requests: readonly ResourceRequest[],
  sites: readonly Site[],
  bestEffort = false,
) {
  const plans = new Map(units.map((u) => [u.id, [] as ResourceRequest[]]));
  const capacity = hatchCapacity(def, units[0]).capacity;
  const usable = new Map<string, boolean>();
  const privateCells = new Map<string, number>();
  const siteKey = (r: ResourceRequest, id: number) => `${id}:${r.kind}:${r.region ?? ''}`;
  const canUse = (request: ResourceRequest, id: number) => {
    const key = siteKey(request, id);
    const cached = usable.get(key);
    if (cached !== undefined) return cached;
    const candidates = sites.filter(
      (s) =>
        s.unitIds.includes(id) &&
        s.kinds.has(request.kind) &&
        (!request.region || s.regions.get(id) === request.region) &&
        (s.unitIds.length === 1 || (def.wallshare && def.shareableHatches.includes(request.kind))),
    );
    const result = candidates.length > 0;
    privateCells.set(key, candidates.filter((s) => s.unitIds.length === 1).length);
    usable.set(key, result);
    return result;
  };
  const demand: Demand = {};
  for (const r of requests) (demand[r.kind] ??= []).push(r.resource);
  const minimum = (kind: HatchKind) => resourceMinimum(def, kind, demand);
  function load(id: number, extra?: ResourceRequest) {
    const plan = extra ? [...plans.get(id)!, extra] : plans.get(id)!;
    return enabled.reduce((total, kind) => {
      const own = plan.filter((r) => r.kind === kind);
      const missing = (def.requiredHatches?.[kind]?.regions ?? []).filter(
        (region) => !own.some((r) => r.region === region),
      ).length;
      return total + Math.max(minimum(kind), own.length + missing);
    }, 0);
  }
  // Manual assignments are required coverage, not a ban on role-minimum copies elsewhere.
  const primary = (r: ResourceRequest) => (units.some((u) => u.id === r.unitId) ? r.unitId : undefined);
  const ordered = [...requests].sort(
    (a, b) => Number(primary(b) !== undefined) - Number(primary(a) !== undefined),
  );
  function choices(request: ResourceRequest) {
    const manual = primary(request);
    return units
      .filter(
        (u) =>
          (manual === undefined || manual === u.id) &&
          (bestEffort || (canUse(request, u.id) && load(u.id, request) <= capacity)),
      )
      .sort(
        (a, b) =>
          load(a.id, request) - load(b.id, request) ||
          (privateCells.get(siteKey(request, b.id)) ?? 0) - (privateCells.get(siteKey(request, a.id)) ?? 0) ||
          plans.get(a.id)!.filter((r) => r.kind === request.kind).length -
            plans.get(b.id)!.filter((r) => r.kind === request.kind).length ||
          a.id - b.id,
      );
  }
  function forced(request: ResourceRequest) {
    const pool = requests.filter((r) => r.kind === request.kind && r.region === request.region);
    const regions = def.requiredHatches?.[request.kind]?.regions ?? [];
    return (
      minimum(request.kind) > 0 &&
      pool.length === 1 &&
      (!regions.length || (request.region && regions.includes(request.region)))
    );
  }
  function complete() {
    // Only primary group requests are assigned here. Structural filler slots choose a resource
    // together with their physical cell, allowing a neighbour's shared hatch to satisfy the minimum.
    return new Map([...plans].map(([id, plan]) => [id, [...plan]]));
  }
  if (bestEffort) {
    for (const request of ordered) {
      const unit = choices(request)[0];
      if (unit) plans.get(unit.id)!.push(request);
    }
    yield complete();
    return;
  }
  // Explicit frames keep large imports independent of the JavaScript call-stack limit.
  const frames: { ids: number[]; next: number }[] = [];
  let depth = 0;
  let visited = 0;
  let yielded = 0;
  const selected: number[] = [];
  while (depth >= 0 && visited < 2 * requests.length + 512 && yielded < 8) {
    if (depth === ordered.length) {
      yield complete();
      yielded++;
      depth--;
      if (depth >= 0) plans.get(selected[depth])!.pop();
      continue;
    }
    const frame =
      frames[depth] ??
      (frames[depth] = {
        ids: choices(ordered[depth])
          .map((u) => u.id)
          .slice(0, forced(ordered[depth]) ? 1 : undefined),
        next: 0,
      });
    if (frame.next === frame.ids.length) {
      frames.pop();
      depth--;
      if (depth >= 0) plans.get(selected[depth])!.pop();
      continue;
    }
    const id = frame.ids[frame.next++];
    visited++;
    selected[depth] = id;
    plans.get(id)!.push(ordered[depth]);
    depth++;
  }
}
