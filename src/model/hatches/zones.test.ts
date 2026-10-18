import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { mirroredDef } from '../mirror';
import { sizedDef } from '../resize';
import { placeHatches } from './placement';
import type { ZonedDef } from './types';
import zonesFile from '../../data/hatch-zones.generated.json';
import { withHatchZones, zoneTakesKind } from './zones';

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

describe('zoneTakesKind', () => {
  const oil = getMultiblock('oil-cracking-unit')!;

  it('reads a named zone by its kinds', () => {
    expect(zoneTakesKind(oil, 'dot3', 'fluidOut')).toBe(true);
    expect(zoneTakesKind(oil, 'dot3', 'fluidIn')).toBe(false);
  });

  it('falls back to the legend regions: a region takes what its casings take', () => {
    expect(zoneTakesKind(oil, 'side', 'fluidIn')).toBe(true);
    expect(zoneTakesKind(oil, 'side', 'fluidOut')).toBe(false);
    expect(zoneTakesKind(oil, 'middle', 'itemIn')).toBe(true);
  });

  it('takes nothing for a name that is no zone and no region', () => {
    expect(zoneTakesKind(oil, 'nowhere', 'fluidIn')).toBe(false);
  });

  it('answers the same for a mirrored def', () => {
    const mirrored = mirroredDef(oil);
    for (const kind of ['fluidIn', 'fluidOut', 'itemIn', 'energy'] as const)
      for (const zone of ['dot1', 'dot2', 'dot3', 'side', 'middle', 'nowhere'])
        expect(zoneTakesKind(mirrored, zone, kind)).toBe(zoneTakesKind(oil, zone, kind));
  });
});

describe('hatch zone data', () => {
  it('lists, per zone, only kinds that some legend char of its cells allows', () => {
    const file = zonesFile as Record<
      string,
      { zones: Record<string, { kinds: string[] }>; cells: Record<string, string> }
    >;
    const bad: string[] = [];
    for (const [id, entry] of Object.entries(file)) {
      const def = getMultiblock(id);
      if (!def) continue;
      for (const [zone, z] of Object.entries(entry.zones)) {
        const chars = new Set<string>();
        for (const [at, name] of Object.entries(entry.cells)) {
          if (name !== zone) continue;
          const [x, y, zz] = at.split(',').map(Number);
          const ch = def.layers[y]?.[zz]?.[x];
          if (ch !== undefined) chars.add(ch);
        }
        for (const kind of z.kinds)
          if (![...chars].some((c) => def.legend[c]?.hatches?.includes(kind as never)))
            bad.push(`${id} ${zone} ${kind}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
