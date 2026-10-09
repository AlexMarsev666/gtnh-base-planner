import { toWorld } from '../geometry';
import type { HatchKind, MultiblockDef, Unit } from './types';
import type { HatchPlacement } from '../plan/types';
import type { Vec3 } from '../core/types';

/** Cache per placement: ordering is in source coordinates, never the rotated world's axes. */
export function hatchOrder(def: MultiblockDef, units: readonly Unit[]) {
  const rules = (def.orderedHatchKinds ?? []).map((rule) => ({
    ...rule,
    ranks: new Map(
      units.map((unit) => [
        unit.id,
        new Map(rule.order.map((pos, rank) => [toWorld(def, unit, pos).join(), rank])),
      ]),
    ),
  }));
  const accepts = (kind: HatchKind, cell: Vec3, ids: readonly number[], placed: readonly HatchPlacement[]) =>
    rules.every((rule) =>
      ids.every((id) => {
        if (kind !== rule.first && kind !== rule.later) return true;
        const ranks = rule.ranks.get(id)!;
        if (!ranks) return false;
        const rank = ranks.get(cell.join());
        if (rank === undefined) return false;
        return placed.every((h) => {
          if (!h.unitIds.includes(id)) return true;
          const other = ranks.get(h.cell.join());
          if (kind === rule.first && h.kind === rule.later) return other !== undefined && rank < other;
          if (kind === rule.later && h.kind === rule.first) return other !== undefined && rank > other;
          return true;
        });
      }),
    );
  return { accepts };
}
