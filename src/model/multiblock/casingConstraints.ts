import { unitCells } from '../geometry';
import type { Vec3 } from '../core/types';
import type { HatchPlacement } from '../plan/types';
import type { MultiblockDef, Unit } from './types';
import { casingRules } from './rules';

const capacityCache = new WeakMap<MultiblockDef, { hatchable: number; capacity: number; retained: number }>();

/** Physical hatch capacity, independent of demand and placement. Fixed decoration may satisfy a
 * casing counter; only hatchable cells can consume its remaining allowance. Group identical cell
 * memberships so multiple (possibly overlapping) casing counters are respected together.
 */
export function hatchCapacity(def: MultiblockDef, unit: Unit) {
  const cached = capacityCache.get(def);
  if (cached) return cached;
  const cells = unitCells(def, unit);
  const hatchable = cells.filter((cell) => cell.role === 'casing' && cell.hatches?.length);
  const rules = casingRules(def);
  const matches = (cell: (typeof cells)[number], i: number) =>
    cell.role === 'casing' &&
    !!cell.blockId &&
    rules[i].blocks.includes(cell.blockId) &&
    (!rules[i].hatchableOnly || !!cell.hatches?.length);
  const budgets = rules.map((rule, i) =>
    Math.max(0, cells.filter((cell) => matches(cell, i)).length - rule.min),
  );
  const groups = new Map<string, { count: number; rules: number[] }>();
  for (const cell of hatchable) {
    const indices = rules.flatMap((_, i) => (matches(cell, i) ? [i] : []));
    const key = indices.join(',');
    const group = groups.get(key) ?? { count: 0, rules: indices };
    group.count++;
    groups.set(key, group);
  }
  const list = [...groups.values()];
  let best = 0;
  function search(index: number, total: number) {
    const bound =
      total +
      list
        .slice(index)
        .reduce((sum, group) => sum + Math.min(group.count, ...group.rules.map((i) => budgets[i])), 0);
    if (bound <= best) return;
    if (index === list.length) {
      best = total;
      return;
    }
    const group = list[index];
    const max = Math.min(group.count, ...group.rules.map((i) => budgets[i]));
    for (let count = max; count >= 0; count--) {
      group.rules.forEach((i) => (budgets[i] -= count));
      search(index + 1, total + count);
      group.rules.forEach((i) => (budgets[i] += count));
      if (best === bound) break;
    }
  }
  search(0, 0);
  const result = { hatchable: hatchable.length, capacity: best, retained: hatchable.length - best };
  capacityCache.set(def, result);
  return result;
}

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
    canReplace(pos: Vec3, _ids: readonly number[]) {
      return [...(atCell.get(pos.join())?.keys() ?? [])].every((id) =>
        (atCell.get(pos.join())?.get(id) ?? []).every((i) => (counters.get(`${id}:${i}`) ?? 0) > 0),
      );
    },
    replace(pos: Vec3, _ids: readonly number[], delta = 1) {
      for (const id of atCell.get(pos.join())?.keys() ?? [])
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
