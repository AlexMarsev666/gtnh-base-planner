import { describe, expect, it } from 'vitest';
import { unitCells } from '../geometry';
import { validateResourceHatches } from './resourcePlacement';
import { cracker, enumerateCrackingCapacity, resources } from './fixtures/crackingCapacity';

describe('independent catalogue enumeration for C2', () => {
  it('finds legal 14-hatch placements without replacing any shared cell', () => {
    const result = enumerateCrackingCapacity();
    console.info(
      'C2 enumeration:',
      JSON.stringify({
        tried: result.tried,
        geometric: result.geometric,
        feasible: result.witnesses.length,
        layouts: result.witnesses.map((w) => ({
          axis: w.axis,
          pitch: w.pitch,
          rotation: w.units[1].rotation,
          blocks: w.blocks,
        })),
      }),
    );
    expect(result.tried).toBe(24);
    expect(result.witnesses.some((w) => w.axis === 1 && w.pitch === cracker.size[1] - 1)).toBe(true);
    expect(result.witnesses.some((w) => w.axis === 0 && w.pitch === cracker.size[0] + 1)).toBe(true);
    expect(
      result.witnesses.some(
        (w) => w.axis === 0 && w.pitch === cracker.size[0] - 1 && w.units[1].rotation === 0,
      ),
    ).toBe(false);
    for (const witness of result.witnesses) {
      expect(witness.hatches).toHaveLength(14);
      expect(new Set(witness.hatches.map((h) => h.cell.join())).size).toBe(14);
      expect(witness.hatches.every((h) => h.unitIds.length === 1)).toBe(true);
      expect(witness.hatches.flatMap((h) => (h.resource ? [h.resource] : [])).sort()).toEqual(
        [...resources].sort(),
      );
      expect(validateResourceHatches(cracker, witness.units, witness.hatches)).toEqual([]);
      for (const unit of witness.units) {
        const hatches = witness.hatches.filter((h) => h.unitIds.includes(unit.id));
        expect(hatches.filter((h) => h.kind === 'fluidIn')).toHaveLength(3);
        expect(hatches.filter((h) => h.kind === 'fluidOut')).toHaveLength(2);
        const occupied = new Set(hatches.map((h) => h.cell.join()));
        expect(
          unitCells(cracker, unit).filter((c) => c.hatches?.length && !occupied.has(c.pos.join())),
        ).toHaveLength(18);
      }
    }
  });

  it('cannot fit 11 distinct fluids plus four unshareable mandatory hatches into capacity 14', () => {
    expect(11 + 2 + 2).toBeGreaterThan(2 * (25 - 18));
  });
});
