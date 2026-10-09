import { findSites } from '../hatches/sites';
import type { Site } from '../hatches/types';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import type { HatchResult } from '../plan/types';
import type { VoltageTier } from '../tiers';
import { VOLTAGE_TIERS } from '../tiers';
import type { Demand, SiteHatch, Toward } from './group';
import type { ResourceBinding, SiteGroup } from './types';
import { rotateDir, step, unitCells } from '../geometry';
import type { Rotation } from '../core/types';
import { casingAllowance, hatchCapacity, validateCasings } from '../multiblock/casingConstraints';
import { hasLayeredFluidOutputs, isOilCracker } from '../multiblock/structureAdapters';
import { defaultHatchTier, supportsHatchTier } from '../hatches/tiers';
import { BOROSILICATE_GLASS_TIERS, minimumGlassTier, structureGlassTier } from '../multiblock/glass';
import { hatchAssignmentKey } from '../hatches/assignments';
import { fixedHatchKinds } from '../multiblock/fixedHatches';
import { quota, alternativeHatchLimits } from '../hatches/quota';
import type { HatchAvoid, PlaceOptions } from '../hatches/types';
import { hatchTiers } from '../../data/single-machines';
import { hatchOrder } from '../multiblock/hatchOrder';
export { hatchAssignmentKey } from '../hatches/assignments';

export type HatchSettings = Pick<
  SiteGroup,
  | 'voltageTier'
  | 'hatchTiers'
  | 'resourceBindings'
  | 'transformer'
  | 'crackingFeedSide'
  | 'manualTransformerMode'
  | 'dataBankWireless'
  | 'assemblyGrowth'
  | 'steamFrameTier'
  | 'structureGlassTier'
>;

interface Slot {
  unitId: number;
  kind: HatchKind;
  resource?: string;
  region?: string;
  key: string;
  tier?: VoltageTier;
  mandatory?: boolean;
}

function resourceRegion(
  def: MultiblockDef,
  kind: HatchKind,
  binding?: ResourceBinding,
): string | null | undefined {
  const roles = def.resourceHatchRegions?.[kind];
  if (roles) return binding?.role ? (roles[binding.role] ?? null) : null;
  if (isOilCracker(def) && kind === 'fluidIn') {
    return binding?.role === 'catalyst' ? 'middle' : binding?.role === 'feed' ? 'side' : null;
  }
  if (hasLayeredFluidOutputs(def) && kind === 'fluidOut') {
    if (binding?.outputSlot === undefined) return null;
    const regions = def.fluidOutputRegions ?? def.requiredHatches?.fluidOut?.regions ?? [];
    return regions[binding.outputSlot] ?? null;
  }
  return undefined;
}

/** Resource, region and tier are chosen together, before any physical cell is occupied.
 * Every controller containing a shared cell must accept the same assignment. Most constrained slots
 * are searched first; on conflict the search restores cells, fronts and all served controllers.
 */
export function placeResourceHatches(
  def: MultiblockDef,
  units: readonly Unit[],
  enabled: readonly HatchKind[],
  demand: Demand,
  settings: HatchSettings,
  below: boolean,
  toward: Toward,
  avoid?: HatchAvoid,
  towardPoints?: PlaceOptions['toward'],
  structuralDef: MultiblockDef = def,
): Omit<HatchResult, 'hatches'> & { hatches: SiteHatch[] } {
  const { sites } = findSites(def, units, below);
  const required = new Map<number, { pos: string; kinds: readonly HatchKind[] }[]>();
  const fixed = new Map<string, Set<string>>();
  for (const unit of units)
    for (const cell of unitCells(def, unit)) {
      const kinds = fixedHatchKinds(def, def.legend[cell.char]);
      if (!kinds.length) continue;
      const positions = required.get(unit.id) ?? [];
      positions.push({ pos: cell.pos.join(), kinds });
      required.set(unit.id, positions);
      for (const kind of kinds) {
        const key = `${unit.id}:${kind}`;
        const cells = fixed.get(key) ?? new Set<string>();
        cells.add(cell.pos.join());
        fixed.set(key, cells);
      }
    }
  const slots: Slot[] = [];
  for (const unit of units)
    for (const kind of enabled) {
      if (!def.hatchBlocks[kind]) continue;
      const req = def.requiredHatches?.[kind];
      const start = slots.length;
      for (const resource of demand[kind] ?? []) {
        const bindings =
          settings.resourceBindings?.filter((b) => b.kind === kind && b.resource === resource) ?? [];
        for (const [ordinal, binding] of (bindings.length ? bindings : [undefined]).entries()) {
          const region = resourceRegion(def, kind, binding);
          // An unknown role/slot is deliberately unresolved; structural filler hatches cannot carry it.
          if (region === null) continue;
          const key = hatchAssignmentKey(
            unit.id,
            kind,
            resource,
            bindings.length > 1 ? (binding?.outputSlot ?? ordinal) : 0,
          );
          slots.push({
            unitId: unit.id,
            kind,
            resource,
            region,
            key,
            tier: supportsHatchTier(def, kind)
              ? (settings.hatchTiers?.[key] ?? defaultHatchTier(def, kind, settings))
              : undefined,
          });
        }
      }
      for (const region of req?.regions ?? []) {
        if (!slots.slice(start).some((s) => s.region === region)) {
          const ordinal = slots.length - start;
          const key = hatchAssignmentKey(unit.id, kind, undefined, ordinal);
          slots.push({
            unitId: unit.id,
            kind,
            region,
            key,
            tier: supportsHatchTier(def, kind)
              ? (settings.hatchTiers?.[key] ?? defaultHatchTier(def, kind, settings))
              : undefined,
          });
        }
      }
      // Empty Assembly Line templates keep one input bus per slice, as before. This is a default,
      // not a structural minimum: explicit fluid-output demand may use a later centre instead.
      const minimum =
        ['assembly-line', 'advanced-assembly-line'].includes(def.id) &&
        kind === 'itemIn' &&
        !demand.itemIn?.length &&
        !enabled.includes('fluidOut')
          ? def.size[0]
          : quota(def, kind).target;
      while (slots.length - start < minimum) {
        const ordinal = slots.length - start;
        const key = hatchAssignmentKey(unit.id, kind, undefined, ordinal);
        slots.push({
          unitId: unit.id,
          kind,
          key,
          tier: supportsHatchTier(def, kind)
            ? (settings.hatchTiers?.[key] ?? defaultHatchTier(def, kind, settings))
            : undefined,
        });
      }
    }
  const candidateCache = new WeakMap<Slot, Site[]>();
  const positionCache = new WeakMap<Slot, Set<string>>();
  const candidatesOf = (s: Slot) => {
    let candidates = candidateCache.get(s);
    if (candidates) return candidates;
    candidates = sites.filter(
      (c) =>
        c.unitIds.includes(s.unitId) &&
        c.kinds.has(s.kind) &&
        !avoid?.get(s.kind)?.has(c.pos.join()) &&
        (!s.region || c.regions.get(s.unitId) === s.region) &&
        (c.unitIds.length === 1 || (def.wallshare && def.shareableHatches.includes(s.kind))),
    );
    candidateCache.set(s, candidates);
    positionCache.set(s, new Set(candidates.map((site) => site.pos.join())));
    return candidates;
  };
  // A bipartite matching, not a sum of per-kind counts: overlapping alternatives share physical cells.
  const uncovered = (id: number, indices: readonly number[], occupied: Pick<ReadonlySet<string>, 'has'>) => {
    const cells = (required.get(id) ?? []).filter((cell) => !occupied.has(cell.pos));
    const owner = new Map<number, number>();
    const choices = cells.map((cell) =>
      indices.filter(
        (i) =>
          cell.kinds.includes(slots[i].kind) &&
          (candidatesOf(slots[i]), positionCache.get(slots[i])!.has(cell.pos)),
      ),
    );
    const augment = (cell: number, seen: Set<number>): boolean => {
      for (const i of choices[cell]) {
        if (seen.has(i)) continue;
        seen.add(i);
        const previous = owner.get(i);
        if (previous === undefined || augment(previous, seen)) {
          owner.set(i, cell);
          return true;
        }
      }
      return false;
    };
    cells.forEach((_, i) => augment(i, new Set()));
    const covered = new Set(owner.values());
    return cells.filter((_, i) => !covered.has(i));
  };
  // Resource slots get first choice. Add only the structural fillers still needed by mandatory cells.
  for (const unit of units) {
    if (!required.has(unit.id)) continue;
    for (;;) {
      const indices = slots.flatMap((s, i) => (s.unitId === unit.id ? [i] : []));
      const missing = uncovered(unit.id, indices, new Set());
      const canFill = (kind: HatchKind, pos: string) =>
        enabled.includes(kind) &&
        indices.filter((i) => slots[i].kind === kind).length <
          (def.requiredHatches?.[kind]?.max ?? Infinity) &&
        candidatesOf({ unitId: unit.id, kind, key: '' }).some((site) => site.pos.join() === pos);
      const cell = missing.find((cell) => cell.kinds.some((kind) => canFill(kind, cell.pos)));
      if (!cell) break;
      const kind = cell.kinds.find((kind) => canFill(kind, cell.pos))!;
      const ordinal = slots.filter((s) => s.unitId === unit.id && s.kind === kind).length;
      const key = hatchAssignmentKey(unit.id, kind, undefined, ordinal);
      slots.push({
        unitId: unit.id,
        kind,
        key,
        mandatory: true,
        tier: supportsHatchTier(def, kind)
          ? (settings.hatchTiers?.[key] ?? defaultHatchTier(def, kind, settings))
          : undefined,
      });
    }
  }
  // Demand-inflated minima are not structural prerequisites. Protect only the original minimum
  // and one representative per required region, allowing resource assignments to satisfy them.
  const slotsByUnitKind = new Map<string, number[]>();
  slots.forEach((slot, i) => {
    const key = `${slot.unitId}:${slot.kind}`;
    const indices = slotsByUnitKind.get(key) ?? [];
    indices.push(i);
    slotsByUnitKind.set(key, indices);
  });
  for (const unit of units)
    for (const kind of enabled) {
      const indices = slotsByUnitKind.get(`${unit.id}:${kind}`) ?? [];
      for (const region of structuralDef.requiredHatches?.[kind]?.regions ?? []) {
        const index = indices.find((i) => slots[i].region === region);
        if (index !== undefined) slots[index].mandatory = true;
      }
      const minimum = quota(structuralDef, kind).target;
      let marked = indices.filter((i) => slots[i].mandatory).length;
      for (const i of indices) {
        if (marked >= minimum) break;
        if (!slots[i].mandatory) {
          slots[i].mandatory = true;
          marked++;
        }
      }
    }
  const priority = (slot: Slot) =>
    !slot.mandatory ? 2 : slot.kind === 'energy' || slot.kind === 'maintenance' ? 0 : 1;
  const remaining = new Set(slots.map((_, i) => i));
  const remainingTotals = [0, 0, 0];
  slots.forEach((slot) => remainingTotals[priority(slot)]++);
  let bestTotals = [...remainingTotals];
  const used = new Set<string>();
  const fronts = new Map<string, string>();
  const count = new Map<string, number>();
  let casings = casingAllowance(def, units);
  const placed: SiteHatch[] = [];
  const ordered = hatchOrder(def, units);
  let best: SiteHatch[] = [];
  let bestRemaining = new Set(remaining);
  let visited = 0;
  const candidates = slots.map(candidatesOf);
  const signature = (s: Slot, id = s.unitId) =>
    JSON.stringify([id, s.kind, s.resource ?? null, s.tier ?? null]);
  const bySignature = new Map<string, number[]>();
  const byUnit = new Map<number, number[]>();
  slots.forEach((s, i) => {
    const k = signature(s);
    bySignature.set(k, [...(bySignature.get(k) ?? []), i]);
    byUnit.set(s.unitId, [...(byUnit.get(s.unitId) ?? []), i]);
  });
  // Best-effort requests may already exceed their physical capacity. Do not reject every partial
  // choice in that case; reserve other kinds' capacity only when all initial slots can be matched.
  const capacityChecked = new Set<number>();
  for (const [id, indices] of byUnit) {
    const owner = new Map<string, number>();
    const augment = (i: number, seen: Set<string>): boolean => {
      for (const pos of positionCache.get(slots[i])!) {
        if (seen.has(pos)) continue;
        seen.add(pos);
        const previous = owner.get(pos);
        if (previous === undefined || augment(previous, seen)) {
          owner.set(pos, i);
          return true;
        }
      }
      return false;
    };
    if (indices.every((i) => augment(i, new Set()))) capacityChecked.add(id);
  }
  const capacities = new Map(units.map((unit) => [unit.id, hatchCapacity(def, unit)]));
  const overCapacity = [...byUnit].some(([id, indices]) => indices.length > capacities.get(id)!.capacity);
  const compareRemaining = () => {
    for (const rank of [0, 1, 2]) {
      const difference = remainingTotals[rank] - bestTotals[rank];
      if (difference) return difference;
    }
    return 0;
  };
  const matching = (c: Site, s: Slot, id: number): number | undefined =>
    (bySignature.get(signature(s, id)) ?? []).find((i) => {
      const t = slots[i];
      return remaining.has(i) && (!t.region || c.regions.get(id) === t.region);
    });
  function options(i: number) {
    const s = slots[i];
    const limits = alternativeHatchLimits(def)[s.kind] ?? [];
    return candidates[i]
      .flatMap((c) => {
        if (used.has(c.pos.join())) return [];
        if (!ordered.accepts(s.kind, c.pos, c.unitIds, placed)) return [];
        if (
          c.unitIds.some((id) =>
            limits.some(
              (rule) =>
                rule.anyOf!.reduce((n, kind) => n + (count.get(`${id}:${kind}`) ?? 0), 0) >= rule.max!,
            ),
          )
        )
          return [];
        if (!casings.canReplace(c.pos, c.unitIds)) return [];
        const covered = c.unitIds.map((id) => matching(c, s, id));
        if (covered.some((n) => n === undefined)) return [];
        if (
          c.unitIds.some((id) => {
            if (!required.has(id)) return false;
            const current = (byUnit.get(id) ?? []).filter((n) => remaining.has(n));
            const left = (byUnit.get(id) ?? []).filter((n) => remaining.has(n) && !covered.includes(n));
            const occupied = { has: (pos: string) => pos === c.pos.join() || used.has(pos) };
            // Covering all mandatory cells is insufficient if this choice leaves more assignments
            // of a kind than free physical cells (e.g. a terminal output replacing the last input).
            for (const kind of capacityChecked.has(id) ? new Set(left.map((n) => slots[n].kind)) : []) {
              if (kind === s.kind) continue; // Consuming its own cell cannot increase this deficit.
              const indices = left.filter((n) => slots[n].kind === kind);
              const cells = new Set<string>();
              for (const n of indices)
                for (const p of positionCache.get(slots[n])!) if (!used.has(p)) cells.add(p);
              const after = cells.size - Number(cells.has(c.pos.join()));
              if (Math.max(0, indices.length - after) > Math.max(0, indices.length - cells.size)) return true;
            }
            return uncovered(id, left, occupied).length > uncovered(id, current, used).length;
          })
        )
          return [];
        if (
          c.unitIds.some(
            (id) => (count.get(`${id}:${s.kind}`) ?? 0) >= (def.requiredHatches?.[s.kind]?.max ?? Infinity),
          )
        )
          return [];
        const token = `${s.kind}:${s.resource ?? ''}`;
        return c.faces
          .filter(
            (f) =>
              !c.blocked.get(s.kind)?.has(f.dir) &&
              (!fronts.has(step(c.pos, f.dir).join()) || fronts.get(step(c.pos, f.dir).join()) === token),
          )
          .map((f) => ({ c, f, covered: covered as number[], token }));
      })
      .sort(
        (a, b) =>
          b.c.unitIds.filter((id) => fixed.get(`${id}:${s.kind}`)?.has(b.c.pos.join())).length -
            a.c.unitIds.filter((id) => fixed.get(`${id}:${s.kind}`)?.has(a.c.pos.join())).length ||
          b.covered.length - a.covered.length ||
          Number(b.f.dir === toward[s.kind]) - Number(a.f.dir === toward[s.kind]) ||
          distance(a.c, a.f.dir, s.kind) - distance(b.c, b.f.dir, s.kind) ||
          a.f.rank - b.f.rank ||
          a.c.pos[1] - b.c.pos[1] ||
          a.c.pos[2] - b.c.pos[2] ||
          a.c.pos[0] - b.c.pos[0],
      );
  }
  function distance(c: Site, face: Site['faces'][number]['dir'], kind: HatchKind): number {
    const target = towardPoints?.[kind];
    if (!target) return 0;
    return step(c.pos, face).reduce((n, p, axis) => n + Math.abs(p - target[axis]), 0);
  }
  function search(): boolean {
    if (!remaining.size) return true;
    type Choice = ReturnType<typeof options>[number];
    interface Frame {
      next: number;
      opts: Choice[];
      index: number;
      active?: { choice: Choice; previous: string | undefined };
    }
    function choose(): Frame | undefined {
      let next = -1;
      let opts: Choice[] = [];
      for (const i of remaining) {
        const os = options(i);
        if (!os.length) return;
        if (next < 0 || os.length < opts.length) {
          next = i;
          opts = os;
        }
      }
      return { next, opts, index: 0 };
    }
    const first = choose();
    if (!first) return false;
    const stack: Frame[] = [first];
    while (stack.length && visited < 20_000) {
      const frame = stack[stack.length - 1];
      const slot = slots[frame.next];
      if (frame.active) {
        const {
          choice: { c, f, covered },
          previous,
        } = frame.active;
        const front = step(c.pos, f.dir).join();
        placed.pop();
        used.delete(c.pos.join());
        casings.replace(c.pos, c.unitIds, -1);
        if (previous === undefined) fronts.delete(front);
        else fronts.set(front, previous);
        for (const i of covered) {
          remaining.add(i);
          remainingTotals[priority(slots[i])]++;
          const key = `${slots[i].unitId}:${slot.kind}`;
          count.set(key, count.get(key)! - 1);
        }
        frame.active = undefined;
      }
      if (frame.index === frame.opts.length) {
        stack.pop();
        continue;
      }
      const choice = frame.opts[frame.index++];
      const { c, f, covered, token } = choice;
      visited++;
      const cell = c.pos.join();
      const front = step(c.pos, f.dir).join();
      const previous = fronts.get(front);
      frame.active = { choice, previous };
      used.add(cell);
      fronts.set(front, token);
      casings.replace(c.pos, c.unitIds);
      for (const i of covered) {
        remaining.delete(i);
        remainingTotals[priority(slots[i])]--;
        const k = `${slots[i].unitId}:${slot.kind}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      placed.push({
        kind: slot.kind,
        cell: c.pos,
        face: f.dir,
        unitIds: [...c.unitIds],
        resource: slot.resource,
        tier: slot.tier,
        assignments: covered.map((i) => slots[i].key),
        blocked: [...(c.blocked.get(slot.kind) ?? [])],
      });
      if (compareRemaining() < 0) {
        best = placed.map((h) => ({ ...h }));
        bestRemaining = new Set(remaining);
        bestTotals = [...remainingTotals];
      }
      if (!remaining.size) return true;
      const child = choose();
      if (child) stack.push(child);
    }
    return false;
  }
  // Most structures are solved in one pass. This also keeps the 2000-unit limit stack-safe: no recursive
  // frame per hatch on the ordinary path. Conflicts use an explicit restoring stack at any group size.
  // Keep complete feasible layouts stable. A proven shortfall uses mandatory interfaces first;
  // partial search results are also compared by that priority, never merely by total hatch count.
  const order = [...remaining].sort(
    (a, b) =>
      (overCapacity ? Number(!slots[a].mandatory) - Number(!slots[b].mandatory) : 0) ||
      candidates[a].length - candidates[b].length ||
      a - b,
  );
  for (const i of order) {
    if (!remaining.has(i)) continue;
    const choice = options(i)[0];
    if (!choice) continue;
    const { c, f, covered, token } = choice;
    const slot = slots[i];
    used.add(c.pos.join());
    fronts.set(step(c.pos, f.dir).join(), token);
    casings.replace(c.pos, c.unitIds);
    for (const n of covered) {
      remaining.delete(n);
      remainingTotals[priority(slots[n])]--;
      const k = `${slots[n].unitId}:${slot.kind}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    placed.push({
      kind: slot.kind,
      cell: c.pos,
      face: f.dir,
      unitIds: [...c.unitIds],
      resource: slot.resource,
      tier: slot.tier,
      assignments: covered.map((n) => slots[n].key),
      blocked: [...(c.blocked.get(slot.kind) ?? [])],
    });
  }
  best = placed.map((h) => ({ ...h }));
  bestRemaining = new Set(remaining);
  bestTotals = [...remainingTotals];
  // A request exceeding a shared maximum cannot be completed by moving cells. Per controller take
  // the largest deficit (rules may overlap), then sum controllers whose assignment slots are distinct.
  const limits = alternativeHatchLimits(def);
  const maxRules = [...new Set(Object.values(limits).flat())].filter((rule) =>
    rule.anyOf!.some((kind) => enabled.includes(kind)),
  );
  const unavoidable = maxRules.length
    ? units.reduce(
        (n, unit) =>
          n +
          Math.max(
            0,
            ...maxRules.map(
              (rule) =>
                (byUnit.get(unit.id) ?? []).filter((i) => rule.anyOf!.includes(slots[i].kind)).length -
                rule.max!,
            ),
          ),
        0,
      )
    : 0;
  if (remaining.size > unavoidable && (!overCapacity || [...remaining].some((i) => slots[i].mandatory))) {
    remaining.clear();
    remainingTotals.fill(0);
    slots.forEach((slot, i) => {
      remaining.add(i);
      remainingTotals[priority(slot)]++;
    });
    placed.length = 0;
    used.clear();
    fronts.clear();
    count.clear();
    casings = casingAllowance(def, units);
    search();
  }
  const missingCells = [...required].flatMap(([id, cells]) =>
    cells
      .filter(
        (cell) =>
          cell.kinds.some((kind) => enabled.includes(kind)) &&
          !best.some((h) => h.unitIds.includes(id) && h.cell.join() === cell.pos),
      )
      .map((cell) => ({
        unitId: id,
        kind: cell.kinds.find((kind) => enabled.includes(kind)) ?? cell.kinds[0],
      })),
  );
  const capacityProblems = units.flatMap((unit) => {
    if (
      ![...bestRemaining].some((i) => slots[i].unitId === unit.id) &&
      !missingCells.some((cell) => cell.unitId === unit.id)
    )
      return [];
    const indices = byUnit.get(unit.id) ?? [];
    const breakdown = new Map<HatchKind, number>();
    indices.forEach((i) => breakdown.set(slots[i].kind, (breakdown.get(slots[i].kind) ?? 0) + 1));
    const { hatchable, capacity, retained } = capacities.get(unit.id)!;
    const placed = best.filter((hatch) => hatch.unitIds.includes(unit.id)).length;
    return [
      `Controller ${unit.id}: ${indices.length} hatches required; structure capacity ${capacity} ` +
        `(${hatchable} hatchable casing cells, ${retained} must remain casings). ` +
        `Required: ${[...breakdown].map(([kind, count]) => `${kind} ${count}`).join(', ')}; placed ${placed}. ` +
        (indices.length > capacity
          ? 'Demand exceeds casing capacity.'
          : 'Allowed cells, roles or access prevent the remaining hatches.'),
    ];
  });
  const fixedDeficits = missingCells.filter(
    (cell) => ![...bestRemaining].some((i) => slots[i].unitId === cell.unitId && slots[i].kind === cell.kind),
  );
  const mandatoryDeficits: [number, number] = [0, 0];
  for (const i of bestRemaining) {
    const rank = priority(slots[i]);
    if (rank !== 2) mandatoryDeficits[rank]++;
  }
  for (const cell of fixedDeficits)
    mandatoryDeficits[cell.kind === 'energy' || cell.kind === 'maintenance' ? 0 : 1]++;
  return {
    hatches: best,
    unplacedMandatory: mandatoryDeficits,
    ...(capacityProblems.length ? { capacityProblems } : {}),
    unplaced: [...bestRemaining]
      .map((i) => ({ unitId: slots[i].unitId, kind: slots[i].kind }))
      .concat(fixedDeficits),
  };
}

/** Independent post-placement check of per-controller allowed cells and sides, including shared hatches. */
export function validateResourceHatches(
  def: MultiblockDef,
  units: readonly Unit[],
  hatches: readonly SiteHatch[],
  settings?: HatchSettings,
): string[] {
  const errors: string[] = [];
  const ordered = hatchOrder(def, units);
  for (const h of hatches)
    if (!ordered.accepts(h.kind, h.cell, h.unitIds, hatches))
      errors.push(
        `Controller ${h.unitIds.join(',')}: ${h.kind} violates the RC2 source order; the first Electrode Hatch must carry the operating electrode.`,
      );
  if (
    def.id === 'data-bank' &&
    !settings?.dataBankWireless &&
    hatches.some((h) => h.kind === 'wirelessAssemblyDataOut')
  )
    errors.push(
      'Data Bank wireless recipe transmission is disabled; enable the controller wireless setting.',
    );
  if (
    settings?.structureGlassTier &&
    (!def.selectableGlass || !BOROSILICATE_GLASS_TIERS.includes(settings.structureGlassTier))
  )
    errors.push(
      `Selected structure glass tier ${settings.structureGlassTier} is not supported for ${def.name}.`,
    );
  const glassMinimum = minimumGlassTier(def);
  const actualGlass = structureGlassTier(def);
  if (
    glassMinimum &&
    (!actualGlass || VOLTAGE_TIERS.indexOf(actualGlass) < VOLTAGE_TIERS.indexOf(glassMinimum))
  )
    for (const unit of units)
      errors.push(
        `Controller ${unit.id}: structure glass tier ${actualGlass ?? 'not specified'}; RC2 requires at least ${glassMinimum}.`,
      );
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const cellsByUnit = new Map<number, Map<string, ReturnType<typeof unitCells>[number]>>();
  const cellsOf = (id: number) => {
    let cells = cellsByUnit.get(id);
    if (!cells) {
      const unit = unitsById.get(id);
      cells = new Map(unit ? unitCells(def, unit).map((cell) => [cell.pos.join(), cell]) : []);
      cellsByUnit.set(id, cells);
    }
    return cells;
  };
  const hatchesByUnit = new Map<number, SiteHatch[]>();
  const physical = new Map(hatches.map((hatch) => [hatch.cell.join(), hatch]));
  const physicalCells = new Set<string>();
  for (const hatch of hatches) {
    const cell = hatch.cell.join();
    if (physicalCells.has(cell)) errors.push(`Multiple physical hatches occupy ${cell}.`);
    physicalCells.add(cell);
  }
  for (const hatch of hatches)
    for (const id of hatch.unitIds) {
      const list = hatchesByUnit.get(id) ?? [];
      list.push(hatch);
      hatchesByUnit.set(id, list);
    }
  for (const unit of units)
    for (const cell of cellsOf(unit.id).values()) {
      const kinds = fixedHatchKinds(def, def.legend[cell.char]);
      if (!kinds.length) continue;
      const hatch = physical.get(cell.pos.join());
      if (!hatch || !kinds.includes(hatch.kind) || !hatch.unitIds.includes(unit.id))
        errors.push(
          `Controller ${unit.id}: ${kinds.join(' or ')} is required at ${cell.pos.join()} under RC2.`,
        );
    }
  for (const unit of units)
    for (const kind of def.uniformHatchTiers ?? []) {
      const selected = (hatchesByUnit.get(unit.id) ?? []).filter((h) => h.kind === kind);
      if (
        selected.length > 1 &&
        (selected.some((h) => !h.tier) || new Set(selected.map((h) => h.tier)).size > 1)
      )
        errors.push(
          `Controller ${unit.id}: all ${kind} hatches must have the same specified tier under RC2.`,
        );
    }
  if (def.id === 'manual-transformer') {
    const windings = def.size[1] - 2;
    const direction = settings?.manualTransformerMode === 'down' ? -1 : 1;
    for (const unit of units) {
      const inputs = (hatchesByUnit.get(unit.id) ?? []).filter((h) => h.kind === 'energy');
      const outputs = (hatchesByUnit.get(unit.id) ?? []).filter((h) => h.kind === 'dynamo');
      if (!inputs.length || !outputs.length) continue; // Counts report the absent interface separately.
      const input = inputs[0].tier;
      const output = outputs[0].tier;
      if (
        !input ||
        !output ||
        VOLTAGE_TIERS.indexOf(output) - VOLTAGE_TIERS.indexOf(input) !== direction * windings
      )
        errors.push(
          `Controller ${unit.id}: Manual Transformer needs ${windings} tier steps ${direction < 0 ? 'down' : 'up'} for ${windings} winding layers; energy ${input ?? 'unspecified'}, dynamo ${output ?? 'unspecified'}.`,
        );
    }
  }
  if (def.minimumInputVoltageTier) {
    const minimum = VOLTAGE_TIERS.indexOf(def.minimumInputVoltageTier);
    // GTValues.V and GTUtility.getTier: the tier increases immediately above the preceding
    // nominal voltage. This is a structural check only; no amperage or network power model.
    const precedingVoltage = minimum ? 8 * 4 ** (minimum - 1) : 0;
    for (const unit of units) {
      const inputs = (hatchesByUnit.get(unit.id) ?? []).filter((h) => h.kind === 'energy');
      if (!inputs.length) continue; // The source's hatch-count check reports missing inputs.
      const unknown = inputs.some((h) => !h.tier);
      const voltage = inputs.reduce(
        (sum, h) =>
          sum + (h.tier === 'MAX' ? 2147483640 : h.tier ? 8 * 4 ** VOLTAGE_TIERS.indexOf(h.tier) : 0),
        0,
      );
      if (unknown || voltage <= precedingVoltage)
        errors.push(
          `Controller ${unit.id}: energy input tier ${unknown ? 'not specified' : 'too low'}; RC2 requires ${def.minimumInputVoltageTier} from the sum of input voltages.`,
        );
    }
  }
  for (const unit of units)
    for (const [kind, rule] of Object.entries(def.requiredHatches ?? {})) {
      const selected = (hatchesByUnit.get(unit.id) ?? []).filter((hatch) => hatch.kind === kind);
      if (selected.length < rule.min || selected.length > (rule.max ?? Infinity))
        errors.push(
          `Controller ${unit.id}: ${kind} count ${selected.length}; requires ${rule.min}–${rule.max ?? 'unlimited'}.`,
        );
      for (const region of rule.regions ?? []) {
        if (
          !selected.some((hatch) => {
            const cell = cellsOf(unit.id).get(hatch.cell.join());
            return cell && def.legend[cell.char]?.region === region;
          })
        )
          errors.push(`Controller ${unit.id}: ${kind} is required in region ${region}.`);
      }
    }
  for (const h of hatches)
    for (const id of h.unitIds) {
      if (h.kind === 'dataAccess' && (!h.tier || !hatchTiers(h.kind).includes(h.tier)))
        errors.push(
          `Controller ${id}: Data Access has no ${h.tier ?? 'unspecified'} variant in RC2; choose EV, LuV or UV.`,
        );
      const limits = def.hatchTierLimits?.[h.kind];
      if (limits) {
        const index = h.tier ? VOLTAGE_TIERS.indexOf(h.tier) : -1;
        if (
          index < (limits.min ? VOLTAGE_TIERS.indexOf(limits.min) : 0) ||
          index > (limits.max ? VOLTAGE_TIERS.indexOf(limits.max) : Infinity)
        )
          errors.push(
            `Controller ${id}: ${h.kind} tier ${h.tier ?? 'unspecified'}; RC2 requires ${limits.min ?? 'ULV'}–${limits.max ?? 'MAX'}${limits.reason ? ` (${limits.reason})` : ''}.`,
          );
      }
      const cell = cellsOf(id).get(h.cell.join());
      if (!cell?.hatches?.includes(h.kind))
        errors.push(`Controller ${id}: ${h.kind} at ${h.cell.join()} is not allowed.`);
      if (h.blocked?.includes(h.face)) errors.push(`Controller ${id}: ${h.kind} cannot face ${h.face}.`);
      const unit = unitsById.get(id);
      if (
        cell &&
        unit &&
        def.legend[cell.char]?.disallowFaces?.[h.kind]?.includes(
          rotateDir(h.face, ((4 - unit.rotation) % 4) as Rotation),
        )
      )
        errors.push(`Controller ${id}: ${h.kind} cannot face ${h.face} under the source rules.`);
      if (h.resource && settings) {
        const bindings =
          settings.resourceBindings?.filter((b) => b.kind === h.kind && b.resource === h.resource) ?? [];
        const regions = (bindings.length ? bindings : [undefined]).map((binding) =>
          resourceRegion(def, h.kind, binding),
        );
        if (regions.every((region) => region === null))
          errors.push(`Controller ${id}: choose a structural role or output slot for ${h.resource}.`);
        else if (!regions.includes(undefined) && cell && !regions.includes(def.legend[cell.char]?.region))
          errors.push(
            `Controller ${id}: ${h.resource} must use region ${regions.filter(Boolean).join(' or ')}.`,
          );
      }
    }
  for (const binding of settings?.resourceBindings ?? []) {
    const region = resourceRegion(def, binding.kind, binding);
    if (region === null) {
      errors.push(`Choose a structural role or output slot for ${binding.resource}.`);
      continue;
    }
    if (!region) continue;
    for (const unit of units)
      if (
        !(hatchesByUnit.get(unit.id) ?? []).some((hatch) => {
          const cell = cellsOf(unit.id).get(hatch.cell.join());
          return (
            hatch.kind === binding.kind &&
            hatch.resource === binding.resource &&
            cell &&
            def.legend[cell.char]?.region === region
          );
        })
      )
        errors.push(
          `Controller ${unit.id}: ${binding.resource} needs an assigned ${binding.kind} in region ${region}.`,
        );
  }
  if (hasLayeredFluidOutputs(def)) {
    const seen = new Set<number>();
    for (const binding of settings?.resourceBindings ?? []) {
      if (binding.kind !== 'fluidOut' || binding.outputSlot === undefined) continue;
      if (seen.has(binding.outputSlot))
        errors.push(`Fluid output slot ${binding.outputSlot + 1} is assigned more than once.`);
      seen.add(binding.outputSlot);
    }
  }
  errors.push(...validateCasings(def, units, hatches));
  return errors;
}
