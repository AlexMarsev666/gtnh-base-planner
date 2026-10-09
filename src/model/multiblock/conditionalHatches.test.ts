import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { validateResourceHatches } from '../site/resourcePlacement';
import { unitCells } from '../geometry';

describe('RC2 conditional XL turbine and splitter hatches', () => {
  for (const [id, kind, min, max] of [
    ['xl-turbo-steam-turbine', 'fluidOut', 1, undefined],
    ['xl-turbo-hp-steam-turbine', 'fluidOut', 1, undefined],
    ['xl-turbo-sc-steam-turbine', 'fluidOut', 1, undefined],
    ['xl-turbo-plasma-turbine', 'fluidOut', 1, undefined],
    ['xl-turbo-gas-turbine', 'muffler', 4, 4],
    ['superconductive-strand-splitter', 'fluidIn', 1, 1],
  ] as const) {
    it(`${id}: satisfies its conditional count and diagnoses missing or excess interfaces`, () => {
      const def = getMultiblock(id)!;
      expect(def.requiredHatches?.[kind]).toEqual({ min, ...(max ? { max } : {}) });
      const plan = { ...defaultPlan(id), count: 1 };
      expect(plan.enabledHatches).toContain(kind);
      const built = createPipeline()(plan, false);
      expect(built.error).toBeNull();
      const units = built.pack!.units;
      const placed = built.hatches!.hatches;
      expect(placed.filter((h) => h.kind === kind)).toHaveLength(min);
      const reduced = placed.filter((h) => h !== placed.find((candidate) => candidate.kind === kind));
      expect(
        validateResourceHatches(def, units, reduced).some((e) => e.includes(`${kind} count ${min - 1}`)),
      ).toBe(true);
      if (max) {
        const occupied = new Set(placed.map((h) => h.cell.join()));
        const slot = unitCells(def, units[0]).find(
          (c) => c.hatches?.includes(kind) && !occupied.has(c.pos.join()),
        )!;
        const extra = { ...placed.find((h) => h.kind === kind)!, cell: slot.pos };
        expect(
          validateResourceHatches(def, units, [...placed, extra]).some((e) =>
            e.includes(`${kind} count ${max + 1}`),
          ),
        ).toBe(true);
      }
      if (id === 'xl-turbo-gas-turbine') {
        expect(def.hatchBlocks.fluidOut).toBeUndefined();
        expect(plan.enabledHatches).not.toContain('fluidOut');
      }
      if (id.startsWith('xl-turbo')) expect(def.requiredHatches?.fluidIn?.min).toBe(1);
    });
  }
});
