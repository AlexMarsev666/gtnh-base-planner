import type { HatchKind, MultiblockDef } from '../multiblock/types';
import { HATCH_PRIORITY } from './constants';
import { anyMins, quota } from './quota';
import type { HatchRequest, UnplacedHatch } from './types';
import type { Wanted } from './capacity';

/** Turning an explicit request list into the order hatches are placed in. */

/** Kinds that carry one fluid: a block of these serves one `HatchRequest.key`. */
export const FLUID_KINDS: readonly HatchKind[] = ['fluidIn', 'fluidOut', 'steamIn'];

/** One hatch to place for a set of units. */
export interface Stage {
  kind: HatchKind;
  units: ReadonlySet<number>;
  zone?: string;
  key?: string;
  keys?: string[];
  /** Units for which it is among the first `requiredHatches[kind].min` requests naming them. */
  mandatoryFor: ReadonlySet<number>;
  /** `mandatoryFor` is not empty: placed before every optional stage. */
  mandatory: boolean;
}

/** The `requiredHatches[kind].min` of a def, 0 when unset. */
export function minOf(def: MultiblockDef, kind: HatchKind): number {
  const min = def.requiredHatches?.[kind]?.min;
  return Number.isFinite(min) ? Math.max(0, Math.floor(min!)) : 0;
}

/**
 * The requests as stages in placement order: mandatory ones first (a request is mandatory when it is among
 * the first `min` of its kind that name one of its units, in the order given), then the rest, each group by `HATCH_PRIORITY`, then in the order given. What cannot become
 * a stage comes back as `rejected`: a kind not in `kinds` (the def has no such hatch) is `unsupported` for
 * each unit named, a unit id that is not placed is `noUnit`.
 */
export function stagesOf(
  def: MultiblockDef,
  requests: readonly HatchRequest[],
  unitIds: readonly number[],
  kinds: readonly HatchKind[],
): { stages: Stage[]; rejected: UnplacedHatch[] } {
  const known = new Set(unitIds);
  const rejected: UnplacedHatch[] = [];
  const reject = (r: HatchRequest, unitId: number, reason: 'unsupported' | 'noUnit') =>
    rejected.push({ unitId, kind: r.kind, ...(r.key !== undefined ? { key: r.key } : {}), reason });
  /** Requests of a kind seen so far per unit. */
  const seen = new Map<HatchKind, Map<number, number>>();
  /** Requests of each `requiredAny` group seen so far per unit. */
  const anySeen = new Map<number, Map<number, number>>();
  const stages: Stage[] = [];
  for (const r of requests) {
    const named = r.units === 'each' ? unitIds : [...new Set(r.units)].sort((a, b) => a - b);
    if (!kinds.includes(r.kind)) {
      for (const id of named) reject(r, id, known.has(id) ? 'unsupported' : 'noUnit');
      continue;
    }
    const units = new Set(named.filter((id) => known.has(id)));
    for (const id of named) if (!known.has(id)) reject(r, id, 'noUnit');
    if (units.size === 0) continue;
    const perUnit = seen.get(r.kind) ?? seen.set(r.kind, new Map()).get(r.kind)!;
    const mandatoryFor = new Set<number>();
    for (const id of units) {
      const n = perUnit.get(id) ?? 0;
      perUnit.set(id, n + 1);
      if (n < minOf(def, r.kind)) mandatoryFor.add(id);
      // The first `min` requests of a `requiredAny` group count as required too.
      (def.requiredAny ?? []).forEach((g, gi) => {
        if (!g.kinds.includes(r.kind)) return;
        const per = anySeen.get(gi) ?? anySeen.set(gi, new Map()).get(gi)!;
        const m = per.get(id) ?? 0;
        per.set(id, m + 1);
        if (m < g.min) mandatoryFor.add(id);
      });
    }
    const stage: Stage = { kind: r.kind, units, mandatoryFor, mandatory: mandatoryFor.size > 0 };
    if (r.zone !== undefined) stage.zone = r.zone;
    if (r.key !== undefined) stage.key = r.key;
    if (r.keys !== undefined) stage.keys = r.keys;
    stages.push(stage);
  }
  const rank = (s: Stage) => (s.mandatory ? 0 : HATCH_PRIORITY.length) + HATCH_PRIORITY.indexOf(s.kind);
  return {
    stages: stages
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .map(({ s }) => s),
    rejected,
  };
}

/**
 * Requirements the requests leave open: per unit and kind with a `requiredHatches` entry, one `required`
 * entry for each hatch short of `min`, less the `explained` ones: a missing required region is reported
 * on its own (with its `region`), so it is not counted again as a shortfall of `min`. Nothing is added to
 * the requests; this only reports.
 */
export function shortOfMin(
  def: MultiblockDef,
  unitIds: readonly number[],
  stages: readonly Stage[],
  explained: (unitId: number, kind: HatchKind) => number = () => 0,
): UnplacedHatch[] {
  const out: UnplacedHatch[] = [];
  for (const kind of HATCH_PRIORITY) {
    const min = minOf(def, kind);
    if (min === 0 || def.hatchBlocks?.[kind] === undefined) continue;
    for (const unitId of unitIds) {
      const have = stages.filter((s) => s.kind === kind && s.units.has(unitId)).length;
      for (let n = have + explained(unitId, kind); n < min; n++)
        out.push({ unitId, kind, reason: 'required' });
    }
  }
  return out;
}

/**
 * `requiredAny` groups the requests leave short: per unit and group, one `required` entry (of the group's
 * first kind the def has a hatch block for) for each hatch short of `min`. Only reports.
 */
export function shortOfAny(
  def: MultiblockDef,
  unitIds: readonly number[],
  stages: readonly Stage[],
): UnplacedHatch[] {
  const out: UnplacedHatch[] = [];
  for (const group of def.requiredAny ?? []) {
    const kind = group.kinds.find((k) => def.hatchBlocks?.[k] !== undefined);
    if (kind === undefined) continue;
    for (const unitId of unitIds) {
      const have = stages.filter((s) => group.kinds.includes(s.kind) && s.units.has(unitId)).length;
      for (let n = have; n < group.min; n++) out.push({ unitId, kind, reason: 'required' });
    }
  }
  return out;
}

/** Per unit, the hatches the stages want of it, in stage order (mandatory first). */
export function wantedOfStages(stages: readonly Stage[]): Map<number, Wanted[]> {
  const out = new Map<number, Wanted[]>();
  for (const s of stages)
    for (const id of [...s.units].sort((a, b) => a - b)) {
      const w: Wanted = { kind: s.kind, mandatory: s.mandatoryFor.has(id) };
      if (s.zone !== undefined) w.zone = s.zone;
      (out.get(id) ?? out.set(id, []).get(id)!).push(w);
    }
  return out;
}

/** The hatches every unit wants without requests (`quota` target of each kind), mandatory ones first. */
export function wantedOfKinds(def: MultiblockDef, kinds: readonly HatchKind[]): Wanted[] {
  const mandatory: Wanted[] = [];
  const optional: Wanted[] = [];
  const any = anyMins(def, kinds);
  for (const kind of kinds) {
    const { target } = quota(def, kind, any.get(kind));
    const must = Math.min(Math.max(minOf(def, kind), any.get(kind) ?? 0), target);
    for (let n = 0; n < target; n++) (n < must ? mandatory : optional).push({ kind, mandatory: n < must });
  }
  return [...mandatory, ...optional];
}
