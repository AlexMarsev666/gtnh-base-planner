import { TIERS, type Dir, type Rotation, type Tier, type Vec3 } from './core/types';
import { hintedAgainstFaces, localCells, rotateDir, rotateLocal } from './geometry';
import { casingCells } from './hatches/floor';
import { effectiveGlassTier } from './tiers';
import type { HatchKind, MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement } from './plan/types';

/**
 * What the game's structure check (GT `checkMachine`) would object to on each placed unit: a missing mandatory
 * hatch, a casing count under its minimum. The planner still builds such a layout; this only says what is
 * wrong with it. A hatch on a side the legend hints against is only a hint: GT does not check hatch facing.
 */

/**
 * `error`: GT refuses to form the machine. `hint`: it forms, but GT would turn the hatch elsewhere when it
 * places one itself (`LegendEntry.disallowFaces` or outside `allowFaces`), so the layout is not recommended.
 */
export type Severity = 'error' | 'hint';

/** The kinds of problem. A new check adds a member here, its severity below and a branch in `checkValidity`. */
export type ProblemKind =
  /** `requiredHatches.energy.min` not met. */
  | { type: 'missingEnergy'; have: number; min: number }
  /** `requiredHatches.maintenance.min` not met. */
  | { type: 'missingMaintenance'; have: number; min: number }
  /** `requiredHatches` of another kind below its `min` or above its `max`. */
  | { type: 'hatchCount'; kind: HatchKind; have: number; min?: number; max?: number }
  /** A `requiredAny` group with fewer than `min` hatches in all. */
  | { type: 'requiredAny'; kinds: HatchKind[]; have: number; min: number }
  /** Fewer cells of `chars` than the minimum: the hatches stand in the casings GT counts. */
  | { type: 'casings'; chars: string[]; have: number; min: number }
  /** A hatch faces a side its cell's legend entry hints against (`LegendEntry.disallowFaces`, or outside its `allowFaces`). */
  | { type: 'forbiddenFace'; kind: HatchKind; cell: Vec3; face: Dir }
  /** A hatch of a kind in `glassTierLimits.kinds` has a tier above the glass's: GT refuses to form. */
  | { type: 'glassTier'; kind: HatchKind; hatchTier: Tier; glassTier: Tier };

/** One thing wrong with a unit. */
export type ValidityProblem = ProblemKind & { severity: Severity };

/** Problem kinds that are hints (GT forms the machine anyway); every other kind is an error. */
const HINTS: readonly ProblemKind['type'][] = ['forbiddenFace'];

const problem = (p: ProblemKind): ValidityProblem => ({
  ...p,
  severity: HINTS.includes(p.type) ? 'hint' : 'error',
});

/**
 * What the glass tier check needs: the glass tier set on the plan or group (absent: the glass the def draws)
 * and the tier of each hatch by its index in the hatch list.
 */
export interface GlassCheck {
  glassTier?: Tier;
  hatchTierOf: (index: number) => Tier | undefined;
}

/** The problems per unit id; units without any are absent. */
export type UnitValidity = Record<number, ValidityProblem[]>;

/** Per def and rotation: the legend char at each offset from a unit's origin (spaces and air included). */
const offsetChars = new WeakMap<MultiblockDef, Map<string, string>[]>();

function charsAt(def: MultiblockDef, rotation: Rotation): Map<string, string> {
  let byRotation = offsetChars.get(def);
  if (!byRotation) offsetChars.set(def, (byRotation = []));
  return (byRotation[rotation] ??= new Map(
    localCells(def).map((c) => [rotateLocal(def, c.local, rotation).join(), c.char]),
  ));
}

/**
 * Checks every unit against the def. A hatch counts for each unit it serves (`HatchPlacement.unitIds`), and
 * a hatch in a wall shared by units takes a casing from each of them. Pure and deterministic.
 */
export function checkValidity(
  def: MultiblockDef,
  units: readonly Unit[],
  hatches: readonly HatchPlacement[],
  glass?: GlassCheck,
): UnitValidity {
  const out: UnitValidity = {};
  const glassProblems = glass ? glassTierProblems(def, hatches, glass) : new Map<number, ValidityProblem[]>();
  const needCells =
    !!def.minCasings?.length ||
    Object.values(def.legend).some((l) => l.disallowFaces !== undefined || l.allowFaces !== undefined);
  const required = def.requiredHatches ?? {};
  const mins = def.minCasings ?? [];
  // Cells of a unit that count toward each minimum, before hatches replace any: the same for every unit.
  const counted = casingCells(def);
  const byUnit = new Map<number, HatchPlacement[]>();
  for (const h of hatches)
    for (const id of h.unitIds) (byUnit.get(id) ?? byUnit.set(id, []).get(id)!).push(h);
  for (const unit of units) {
    const problems: ValidityProblem[] = [];
    const mine = byUnit.get(unit.id) ?? [];
    const have = (kind: HatchKind): number => mine.filter((h) => h.kind === kind).length;
    for (const kind of Object.keys(required) as HatchKind[]) {
      const req = required[kind]!;
      const n = have(kind);
      if (n < req.min) {
        if (kind === 'energy') problems.push(problem({ type: 'missingEnergy', have: n, min: req.min }));
        else if (kind === 'maintenance')
          problems.push(problem({ type: 'missingMaintenance', have: n, min: req.min }));
        else problems.push(problem({ type: 'hatchCount', kind, have: n, min: req.min }));
      } else if (req.max !== undefined && n > req.max)
        problems.push(problem({ type: 'hatchCount', kind, have: n, max: req.max }));
    }
    for (const group of def.requiredAny ?? []) {
      const n = mine.filter((h) => group.kinds.includes(h.kind)).length;
      if (n < group.min)
        problems.push(problem({ type: 'requiredAny', kinds: [...group.kinds], have: n, min: group.min }));
    }
    if (needCells) {
      const at = charsAt(def, unit.rotation);
      const taken = mins.map(() => 0);
      for (const h of mine) {
        const char = at.get(
          [h.cell[0] - unit.origin[0], h.cell[1] - unit.origin[1], h.cell[2] - unit.origin[2]].join(),
        );
        if (char === undefined) continue;
        mins.forEach((m, i) => m.chars.includes(char) && taken[i]++);
        const dirs = hintedAgainstFaces(def.legend[char], h.kind);
        if (dirs?.some((d) => rotateDir(d, unit.rotation) === h.face))
          problems.push(problem({ type: 'forbiddenFace', kind: h.kind, cell: h.cell, face: h.face }));
      }
      mins.forEach((m, i) => {
        if (counted[i] - taken[i] < m.min)
          problems.push(
            problem({ type: 'casings', chars: [...m.chars], have: counted[i] - taken[i], min: m.min }),
          );
      });
    }
    problems.push(...(glassProblems.get(unit.id) ?? []));
    if (problems.length > 0) out[unit.id] = problems;
  }
  return out;
}

/**
 * Hatches of `glassTierLimits.kinds` above the glass tier, per unit they serve. None when the def has no such
 * limit or the glass tier is unknown.
 */
export function glassTierProblems(
  def: MultiblockDef,
  hatches: readonly HatchPlacement[],
  glass: GlassCheck,
): Map<number, ValidityProblem[]> {
  const out = new Map<number, ValidityProblem[]>();
  const limits = def.glassTierLimits;
  const limit = effectiveGlassTier(def, glass.glassTier);
  if (!limits || !limit) return out;
  hatches.forEach((h, i) => {
    if (!limits.kinds.includes(h.kind)) return;
    const tier = glass.hatchTierOf(i);
    if (!tier || TIERS.indexOf(tier) <= TIERS.indexOf(limit)) return;
    for (const id of h.unitIds)
      (out.get(id) ?? out.set(id, []).get(id)!).push(
        problem({ type: 'glassTier', kind: h.kind, hatchTier: tier, glassTier: limit }),
      );
  });
  return out;
}
