import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { buildGroup } from '../site/group';
import { sizedDef } from '../resize';
import { placeResourceHatches, validateResourceHatches } from '../site/resourcePlacement';
import type { HatchKind } from './types';
import source from '../../data/assembly-line.rc2.generated.json';

describe('source-reviewed Assembly Line termination', () => {
  for (const [id, defaultLength] of [
    ['assembly-line', 16],
    ['advanced-assembly-line', 5],
  ] as const) {
    it(`${id} preserves old implicit sizes and source piece identity`, () => {
      const def = getMultiblock(id)!;
      expect(sizedDef(def, undefined).size).toEqual([defaultLength, 4, 3]);
      expect(def.resize).toMatchObject({ min: 2, max: 16, default: defaultLength });
      expect(source.sources[id === 'assembly-line' ? 0 : 1].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.segments.first.layers[0]).toEqual(['b', 'i', 'b']);
      expect(source.segments.later.layers[0]).toEqual(['b', 'I', 'b']);
    });
    for (const length of [2, 3, 5, 16]) {
      it(`${id} ${length}: fills the full line and restricts outputs to the final section`, () => {
        const def = sizedDef(getMultiblock(id)!, length);
        const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, true);
        expect(built.unplaced).toEqual([]);
        expect(built.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(length);
        expect(validateResourceHatches(def, built.units, built.hatches, {})).toEqual([]);
        const out = built.hatches.find((h) => h.kind === 'itemOut')!;
        if (length === 2) expect([0, 1]).toContain(out.cell[0]);
        else expect(out.cell[0]).toBe(0);
        const early = { ...out, cell: [1, 0, 0] as [number, number, number] };
        const errors = validateResourceHatches(
          def,
          built.units,
          [...built.hatches.filter((h) => h !== out), early],
          {},
        );
        expect(errors.some((e) => e.includes('itemOut'))).toBe(length !== 2);
      });
    }
    it(`${id} two slices: accepts four outputs including FIRST while retaining maintenance`, () => {
      const def = sizedDef(getMultiblock(id)!, 2);
      const units = [{ id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const }];
      const built = placeResourceHatches(
        def,
        units,
        ['itemIn', 'itemOut', 'energy', 'maintenance'],
        { itemIn: ['feed'], itemOut: ['a', 'b', 'c', 'd'] },
        {},
        true,
        {},
      );
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.filter((h) => h.kind === 'itemOut')).toHaveLength(4);
      expect(validateResourceHatches(def, units, built.hatches, {})).toEqual([]);
      expect(def.requiredHatches?.itemOut?.max).toBe(4);
      expect(sizedDef(getMultiblock(id)!, 3).requiredHatches?.itemOut?.max).toBe(3);
    });
    it(`${id} uses a legal centre output when the two terminal side cells are reserved`, () => {
      const def = sizedDef(getMultiblock(id)!, 5);
      const kinds: HatchKind[] = ['itemIn', 'itemOut', 'fluidOut', 'energy', 'maintenance'];
      const units = [{ id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const }];
      const built = placeResourceHatches(
        def,
        units,
        kinds,
        { itemIn: ['iron', 'copper', 'gold', 'tin'] },
        {},
        true,
        {},
        new Map([['itemOut', new Set(['0,0,0', '0,0,2'])]]),
      );
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(4);
      expect(built.hatches.find((h) => h.kind === 'itemOut')?.cell).toEqual([0, 0, 1]);
      expect(validateResourceHatches(def, units, built.hatches, {})).toEqual([]);
    });
  }
});
