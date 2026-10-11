import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { mirroredDef } from '../mirror';
import { sizedDef } from '../resize';
import { placeHatches } from './placement';
import type { ZonedDef } from './types';
import { withHatchZones } from './zones';

const cellsOf = (def: unknown) => (withHatchZones(def as ZonedDef) as ZonedDef).zoneCells!;

describe('zones of a mirrored def', () => {
  it('swaps the sides of the Oil Cracking Unit zones', () => {
    const oil = getMultiblock('oil-cracking-unit')!;
    const mirrored = withHatchZones(mirroredDef(oil)) as ZonedDef;
    expect(mirrored.zoneCells!['4,0,0']).toBe('dot3');
    expect(mirrored.zoneCells!['0,0,0']).toBe('dot2');
    expect(mirrored.zoneCells!['2,0,0']).toBe('dot1');
    // The output side (dot3) is now the right one.
    const r = placeHatches(mirroredDef(oil), [{ id: 1, origin: [0, 0, 0], rotation: 0 }], [], undefined, {
      requests: [{ kind: 'fluidOut', units: 'each', zone: 'dot3', key: 'out' }],
    });
    expect(r.hatches.map((h) => h.cell[0])).toEqual([4]);
  });

  it.each([
    ['distillation-tower', 5],
    ['assembly-line', 8],
    ['oil-cracking-unit', undefined],
  ])('gives %s the same zones whichever of sizedDef and mirroredDef comes first (%s)', (id, size) => {
    const def = getMultiblock(id)!;
    const a = mirroredDef(sizedDef(def, size));
    const b = sizedDef(mirroredDef(def), size);
    expect(cellsOf(a)).toEqual(cellsOf(b));
    // And it is the mirror image of the unmirrored zones.
    const plain = cellsOf(sizedDef(def, size));
    const width = sizedDef(def, size).size[0];
    expect(Object.fromEntries(Object.entries(cellsOf(a)).map(([k, v]) => [k, v]))).toEqual(
      Object.fromEntries(
        Object.entries(plain).map(([k, v]) => {
          const [x, ...rest] = k.split(',');
          return [[width - 1 - Number(x), ...rest].join(','), v];
        }),
      ),
    );
  });

  it('mirrors zone cells a zoned def already has', () => {
    const zoned = withHatchZones(getMultiblock('oil-cracking-unit')!) as ZonedDef;
    const mirrored = mirroredDef(zoned) as ZonedDef;
    expect(mirrored.zoneCells).toEqual(cellsOf(mirroredDef(getMultiblock('oil-cracking-unit')!)));
    expect(withHatchZones(mirrored)).toBe(mirrored);
  });
});
