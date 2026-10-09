import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { buildGroup } from '../site/group';
import { unitCells } from '../geometry';
import { validateResourceHatches } from '../site/resourcePlacement';
import { GODFORGE_MODULE_HATCH_SOURCE, GODFORGE_MODULE_IDS } from './structureAdapters';
import type { HatchKind } from './types';

const kinds: HatchKind[] = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'energy',
  'dynamo',
  'maintenance',
  'muffler',
];
describe('RC2 Godforge module front disc interfaces', () => {
  for (const id of GODFORGE_MODULE_IDS) {
    const def = getMultiblock(id)!;
    it(`${id}: allows the eight standard interfaces only on the twenty front cells`, () => {
      expect(GODFORGE_MODULE_HATCH_SOURCE).toContain('a3e1e11241a814c9fa0dd0973d5699548428f689');
      const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, kinds, {}, true, {}, { voltageTier: 'LV' });
      expect(built.unplaced).toEqual([]);
      expect(built.hatches).toHaveLength(8);
      expect(validateResourceHatches(def, built.units, built.hatches, {})).toEqual([]);
      const cells = unitCells(def, built.units[0]);
      const allowed = cells.filter((c) => c.hatches?.length);
      expect(allowed).toHaveLength(20);
      expect(allowed.every((c) => c.local[2] === 0)).toBe(true);
      const rear = cells.find((c) => c.local[2] === 1 && c.blockId === 'tectech:gt.godforgecasing@0')!;
      expect(rear.hatches).toBeUndefined();
      const misplaced = built.hatches.map((h, i) => (i === 0 ? { ...h, cell: rear.pos } : h));
      expect(validateResourceHatches(def, built.units, misplaced, {}).length).toBeGreaterThan(0);
    });
    it(`${id}: applies Exoticizer output requirements without adding energy or maintenance requirements`, () => {
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        def.defaultHatches,
        {},
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced).toEqual([]);
      expect(validateResourceHatches(def, built.units, built.hatches, {})).toEqual([]);
      expect(built.hatches.map((h) => h.kind).sort()).toEqual(
        id === 'heliofusion-exoticizer' ? ['fluidOut', 'itemOut'] : [],
      );
      if (id === 'heliofusion-exoticizer')
        for (const kind of ['itemOut', 'fluidOut'] as const) {
          expect(
            validateResourceHatches(
              def,
              built.units,
              built.hatches.filter((h) => h.kind !== kind),
              {},
            ).some((e) => e.includes(`${kind} count 0`)),
          ).toBe(true);
        }
    });
  }
});
