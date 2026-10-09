import { unitCells } from '../geometry';
import type { Vec3 } from '../core/types';
import type { HatchPlacement } from '../plan/types';
import type { MultiblockDef, Unit } from './types';
import { casingRules } from './rules';

/** Reserve each controller's counted casings independently, including on shared physical walls. */
export function casingAllowance(def: MultiblockDef, units: readonly Unit[]) {
  const rules = casingRules(def);
  if (!rules.length) return { canReplace: () => true, replace: () => {} };
  const counters = new Map<string, number>();
  const atCell = new Map<string, Map<number, number[]>>();
  for (const unit of units) {
    const totals = rules.map(() => 0);
    for (const cell of unitCells(def, unit)) {
      if (cell.role !== 'casing') continue;
      const matches = rules.flatMap((rule, i) =>
        cell.blockId && rule.blocks.includes(cell.blockId) && (!rule.hatchableOnly || cell.hatches?.length)
          ? [i]
          : [],
      );
      for (const i of matches) totals[i]++;
      if (matches.length) {
        const controllers = atCell.get(cell.pos.join()) ?? new Map<number, number[]>();
        controllers.set(unit.id, matches);
        atCell.set(cell.pos.join(), controllers);
      }
    }
    totals.forEach((total, i) => counters.set(`${unit.id}:${i}`, total - rules[i].min));
  }
  return {
    canReplace(pos: Vec3, ids: readonly number[]) {
      return ids.every((id) =>
        (atCell.get(pos.join())?.get(id) ?? []).every((i) => (counters.get(`${id}:${i}`) ?? 0) > 0),
      );
    },
    replace(pos: Vec3, ids: readonly number[], delta = 1) {
      for (const id of ids)
        for (const i of atCell.get(pos.join())?.get(id) ?? []) {
          const key = `${id}:${i}`;
          counters.set(key, counters.get(key)! - delta);
        }
    },
  };
}

/** Checks the physical replacement even if a malformed assignment omits a served controller. */
export function validateCasings(
  def: MultiblockDef,
  units: readonly Unit[],
  hatches: readonly HatchPlacement[],
): string[] {
  const occupied = new Set(hatches.map((hatch) => hatch.cell.join()));
  const rules = casingRules(def);
  if (!rules.length) return [];
  const errors: string[] = [];
  for (const unit of units) {
    const cells = unitCells(def, unit);
    for (const rule of rules) {
      const count = cells.filter(
        (cell) =>
          cell.role === 'casing' &&
          cell.blockId &&
          rule.blocks.includes(cell.blockId) &&
          (!rule.hatchableOnly || cell.hatches?.length) &&
          !occupied.has(cell.pos.join()),
      ).length;
      if (count < rule.min)
        errors.push(
          `Controller ${unit.id}: ${count} casings; RC2 requires at least ${rule.min} (${rule.blocks.join(', ')}).`,
        );
    }
  }
  return errors;
}
