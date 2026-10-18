import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { toWorld } from '../geometry';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { sizedDef } from '../resize';
import { placeHatches } from './placement';
import type { HatchRequest, ZonedDef } from './types';
import { resizeZoneCells, withHatchZones } from './zones';

const unit = (id: number, x = 0): Unit => ({ id, origin: [x, 0, 0], rotation: 0 });

const times = (n: number, request: HatchRequest): HatchRequest[] => Array.from({ length: n }, () => request);

/** A 3x1x3 ring of casings around the controller; units 2 apart share one wall column. */
function ring(over: Partial<MultiblockDef> = {}): MultiblockDef {
  return {
    id: 'ring',
    name: 'Ring',
    size: [3, 1, 3],
    layers: [['CCC', 'C~C', 'CCC']],
    legend: { C: { blockId: 'casing', hatches: ['itemIn', 'fluidIn', 'fluidOut', 'energy'] } },
    controller: { pos: [1, 0, 1], facing: 'north', blockId: 'controller' },
    hatchBlocks: { itemIn: 'bus', fluidIn: 'hatch', fluidOut: 'out', energy: 'energy' },
    shareableHatches: ['itemIn', 'fluidIn'],
    defaultHatches: ['energy'],
    wallshare: true,
    ...over,
  };
}

describe('withHatchZones', () => {
  it('gives a hand-made entry its zones and leaves the rest alone', () => {
    const oil = getMultiblock('oil-cracking-unit')!;
    const zoned = withHatchZones(oil);
    expect(Object.keys(zoned.zones!)).toEqual(['dot1', 'dot2', 'dot3']);
    expect(zoned.legend).toBe(oil.legend);
    expect(withHatchZones(oil)).toBe(zoned);
    expect(withHatchZones(zoned)).toBe(zoned);
    const generated = getMultiblock('advanced-assembly-line')!;
    expect(withHatchZones(generated)).toBe(generated);
  });

  const charAt = (def: MultiblockDef, at: string) => {
    const [x, y, z] = at.split(',').map(Number);
    return [...def.layers[y][z]][x];
  };

  it.each([
    ['distillation-tower', 5],
    ['assembly-line', 8],
  ])('maps the cells of %s through its resize to size %i', (id, size) => {
    const base = withHatchZones(getMultiblock(id)!) as ZonedDef;
    const big = withHatchZones(sizedDef(getMultiblock(id)!, size)) as ZonedDef;
    const rule = base.resize!;
    const copies = 1 + (size - rule.min) / (rule.to - rule.from);
    const axis = ['x', 'y', 'z'].indexOf(rule.axis);
    const inSlab = (at: string) => {
      const i = Number(at.split(',')[axis]);
      return i >= rule.from && i < rule.to;
    };
    const slab = Object.keys(base.zoneCells!).filter(inSlab).length;
    expect(Object.keys(big.zoneCells!)).toHaveLength(
      Object.keys(base.zoneCells!).length + (copies - 1) * slab,
    );
    // Every mapped cell is a hatch cell of the resized structure, and a repeated slab cell keeps its zone.
    for (const [at, zone] of Object.entries(big.zoneCells!)) {
      expect(big.legend[charAt(big, at)]?.hatches?.length, at).toBeGreaterThan(0);
      expect(big.zones![zone], at).toBeDefined();
    }
    // Reapplying to the zoned base resized (stale cells) rebuilds them; to a fitting def it is the identity.
    expect(withHatchZones(big)).toBe(big);
    const stale = sizedDef(base, size) as ZonedDef;
    expect(Object.keys(withHatchZones(stale).zoneCells as object)).toHaveLength(
      Object.keys(big.zoneCells!).length,
    );
  });

  it('maps cells past the slab by the inserted length', () => {
    const rule = { axis: 'x', from: 1, to: 2, min: 3, max: 6, default: 3, label: 'length' } as const;
    expect(resizeZoneCells({ '0,0,0': 'a', '1,0,0': 'b', '2,0,1': 'c' }, rule, 5)).toEqual({
      '0,0,0': 'a',
      '1,0,0': 'b',
      '2,0,0': 'b',
      '3,0,0': 'b',
      '4,0,1': 'c',
    });
  });
});

describe('requests with zones', () => {
  // The plain catalog entry: placement applies the zones itself.
  const base = getMultiblock('oil-cracking-unit')!;
  const oil = withHatchZones(base);

  it('puts a hatch only on cells of its zone', () => {
    const u = unit(1);
    const requests: HatchRequest[] = [
      { kind: 'fluidIn', units: 'each', zone: 'dot1', key: 'cracker' },
      { kind: 'fluidIn', units: 'each', zone: 'dot2', key: 'oil' },
      { kind: 'fluidOut', units: 'each', zone: 'dot3', key: 'out' },
    ];
    const r = placeHatches(base, [u], [], undefined, { requests });
    // Energy and maintenance are required (min 1) and were not asked for: only reported.
    expect(r.unplaced).toEqual([
      { unitId: 1, kind: 'maintenance', reason: 'required' },
      { unitId: 1, kind: 'energy', reason: 'required' },
    ]);
    // Rotation 0 and origin 0: world x is the local x. dot1 is the middle column, dot2 the right, dot3 the left.
    const x = (key: string) => r.hatches.find((h) => h.key === key)!.cell[0];
    expect([x('cracker'), x('oil'), x('out')]).toEqual([2, 4, 0]);
    expect(toWorld(oil, u, [2, 0, 0])).toEqual([2, 0, 0]);
  });

  it('reports a request no cell of the zone can take', () => {
    // dot3 is the fluidOut side: it takes no input bus.
    const r = placeHatches(base, [unit(1)], [], undefined, {
      requests: [{ kind: 'itemIn', units: 'each', zone: 'dot3', key: 'k' }],
    });
    expect(r.hatches).toEqual([]);
    expect(r.unplaced[0]).toEqual({ unitId: 1, kind: 'itemIn', key: 'k', reason: 'noCell' });
    expect(r.unplaced.slice(1).every((u) => u.reason === 'required')).toBe(true);
    expect(oil.zones).toBeDefined();
  });
});

describe('zone names that are legend regions', () => {
  it('falls back to the region when the name is not a zone of the def', () => {
    const tower = sizedDef(getMultiblock('distillation-tower')!, 5);
    const r = placeHatches(tower, [unit(1)], [], undefined, {
      requests: [
        { kind: 'fluidOut', units: 'each', zone: 'top', key: 't' },
        { kind: 'fluidOut', units: 'each', zone: 'layer2', key: 'l' },
      ],
    });
    expect(r.unplaced.filter((u) => u.reason === 'noCell')).toEqual([]);
    expect(r.hatches.map((h) => h.key).sort()).toEqual(['l', 't']);
    const missing = r.unplaced
      .filter((u) => u.reason === 'required' && u.kind === 'fluidOut')
      .map((u) => u.region);
    expect(missing).not.toContain('top');
    expect(missing).not.toContain('layer2');
  });
});

describe('capacity', () => {
  it('summarises an over-full unit once, with what to remove', () => {
    const r = placeHatches(ring(), [unit(1)], [], undefined, {
      requests: times(10, { kind: 'itemIn', units: 'each' }),
    });
    expect(r.hatches).toHaveLength(8);
    expect(r.unplaced).toHaveLength(2);
    expect(r.unplaced.every((u) => u.reason === 'capacity')).toBe(true);
    expect(r.capacity).toEqual([{ needed: 10, fits: 8, remove: 2, unitIds: [1] }]);
  });

  it('groups units with the same overload and keeps a shared cell for each', () => {
    const units = [unit(1), unit(2, 2), unit(3, 20)];
    const r = placeHatches(ring(), units, [], undefined, {
      requests: times(9, { kind: 'itemIn', units: 'each' }),
    });
    // Each unit has 8 cells (units 1 and 2 share a wall column): 9 wanted, 8 fit.
    expect(r.capacity).toEqual([{ needed: 9, fits: 8, remove: 1, unitIds: [1, 2, 3] }]);
    for (const u of r.unplaced) expect(u.reason).toBe('capacity');
  });

  it('places mandatory hatches before optional ones, whatever the kind priority', () => {
    const def = ring({ requiredHatches: { fluidOut: { min: 1 } } });
    const requests: HatchRequest[] = [
      ...times(10, { kind: 'itemIn', units: 'each' }),
      { kind: 'fluidOut', units: 'each', key: 'out' },
    ];
    const r = placeHatches(def, [unit(1)], [], undefined, { requests });
    expect(r.hatches.filter((h) => h.kind === 'fluidOut')).toHaveLength(1);
    expect(r.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(7);
    expect(r.unplaced.map((u) => u.kind)).toEqual(['itemIn', 'itemIn', 'itemIn']);
    expect(r.capacity).toEqual([{ needed: 11, fits: 8, remove: 3, unitIds: [1] }]);
  });

  it('says so when even the mandatory hatches do not fit', () => {
    const def = ring({ requiredHatches: { fluidOut: { min: 10 } } });
    const r = placeHatches(def, [unit(1)], [], undefined, {
      requests: times(10, { kind: 'fluidOut', units: 'each' }),
    });
    expect(r.capacity).toEqual([{ needed: 10, fits: 8, remove: 2, unitIds: [1], mandatory: true }]);
    expect(r.hatches).toHaveLength(8);
  });

  it('is absent when everything fits, with or without requests', () => {
    expect(placeHatches(ring(), [unit(1)], ['energy']).capacity).toBeUndefined();
    const requests: HatchRequest[] = [{ kind: 'energy', units: 'each' }];
    expect(placeHatches(ring(), [unit(1)], [], undefined, { requests }).capacity).toBeUndefined();
  });

  it('covers the unplaced hatches of a plain call too', () => {
    const def = ring({ requiredHatches: { energy: { min: 9 } } });
    const r = placeHatches(def, [unit(1)], ['energy']);
    expect(r.unplaced).toHaveLength(1);
    expect(r.capacity).toEqual([{ needed: 9, fits: 8, remove: 1, unitIds: [1], mandatory: true }]);
  });
});

describe('shared hatches and fluids', () => {
  const units = [unit(1), unit(2, 2)];
  const onSharedWall = (h: { cell: readonly number[] }) => h.cell[0] === 2;

  it('serves both units with one block, which counts for each', () => {
    const r = placeHatches(ring(), units, [], undefined, { requests: [{ kind: 'itemIn', units: 'each' }] });
    expect(r.hatches).toHaveLength(1);
    expect(r.hatches[0].unitIds).toEqual([1, 2]);
    expect(onSharedWall(r.hatches[0])).toBe(true);
  });

  it('shares one key between units but never two keys in one block', () => {
    const one = placeHatches(ring(), units, [], undefined, {
      requests: [{ kind: 'fluidIn', units: 'each', key: 'water' }],
    });
    expect(one.hatches).toHaveLength(1);
    expect(one.hatches[0]).toMatchObject({ key: 'water', unitIds: [1, 2] });

    const two = placeHatches(ring(), units, [], undefined, {
      requests: [
        { kind: 'fluidIn', units: [1], key: 'water' },
        { kind: 'fluidIn', units: [2], key: 'lava' },
      ],
    });
    expect(two.unplaced).toEqual([]);
    expect(two.hatches.map((h) => [h.key, h.unitIds])).toEqual([
      ['water', [1]],
      ['lava', [2]],
    ]);
    expect(two.hatches.some(onSharedWall)).toBe(false);

    const both = placeHatches(ring(), units, [], undefined, {
      requests: [
        { kind: 'fluidIn', units: 'each', key: 'water' },
        { kind: 'fluidIn', units: 'each', key: 'lava' },
      ],
    });
    expect(both.hatches.map((h) => h.key).sort()).toEqual(['lava', 'water']);
    expect(new Set(both.hatches.map((h) => h.cell.join())).size).toBe(2);
  });
});

describe('requests that cannot be met', () => {
  it('reports kinds the def has no block for and units that are not placed', () => {
    const r = placeHatches(ring(), [unit(1)], [], undefined, {
      requests: [
        { kind: 'muffler', units: 'each', key: 'm' },
        { kind: 'energy', units: [1, 7] },
        { kind: 'dynamo', units: [9] },
      ],
    });
    expect(r.hatches).toHaveLength(1);
    expect(r.unplaced).toEqual([
      { unitId: 1, kind: 'muffler', key: 'm', reason: 'unsupported' },
      { unitId: 7, kind: 'energy', reason: 'noUnit' },
      { unitId: 9, kind: 'dynamo', reason: 'noUnit' },
    ]);
  });

  it('reports every request when no unit is placed', () => {
    const r = placeHatches(ring(), [], [], undefined, { requests: [{ kind: 'energy', units: [3] }] });
    expect(r.unplaced).toEqual([{ unitId: 3, kind: 'energy', reason: 'noUnit' }]);
  });

  it('reports requirements the requests leave open without adding hatches', () => {
    const def = ring({ requiredHatches: { energy: { min: 2 }, fluidOut: { min: 1 } } });
    const r = placeHatches(def, [unit(1), unit(2, 20)], [], undefined, {
      requests: [
        { kind: 'energy', units: 'each' },
        { kind: 'fluidOut', units: [1] },
      ],
    });
    expect(r.hatches.map((h) => h.kind).sort()).toEqual(['energy', 'energy', 'fluidOut']);
    expect(r.unplaced).toEqual([
      { unitId: 1, kind: 'energy', reason: 'required' },
      { unitId: 2, kind: 'energy', reason: 'required' },
      { unitId: 2, kind: 'fluidOut', reason: 'required' },
    ]);
  });

  it('reports a required region no hatch of the unit is in', () => {
    const def = ring({
      requiredHatches: { energy: { min: 1, regions: ['left', 'right'] } },
      layers: [['LCC', 'L~C', 'LCC']],
      legend: {
        L: { blockId: 'casing', hatches: ['energy'], region: 'left' },
        C: { blockId: 'casing', hatches: ['energy'], region: 'right' },
      },
    });
    const r = placeHatches(def, [unit(1)], [], undefined, { requests: [{ kind: 'energy', units: 'each' }] });
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]).toMatchObject({ kind: 'energy', reason: 'required' });
    expect(['left', 'right']).toContain(r.unplaced[0].region);
  });

  it('blames capacity only for the kind and unit that ran out of cells', () => {
    const def = ring({ legend: { C: { blockId: 'casing', hatches: ['itemIn', 'energy'] } } });
    const r = placeHatches(def, [unit(1)], [], undefined, {
      requests: [...times(9, { kind: 'itemIn', units: 'each' }), { kind: 'fluidIn', units: 'each' }],
    });
    // No cell takes fluidIn at all (not a matter of room), itemIn runs out of cells.
    expect(r.unplaced.filter((u) => u.reason === 'capacity').map((u) => u.kind)).toEqual(['itemIn']);
    expect(r.unplaced.filter((u) => u.kind === 'fluidIn').map((u) => u.reason)).toEqual(['noCell']);
  });
});

describe('one fluid across stages', () => {
  it('lets a later stage of the same key share a cell an earlier one needs', () => {
    // Three units in a row: the middle one has only shared cells to put its fluid hatch on.
    const line = ring({
      size: [3, 1, 1],
      layers: [['A~B']],
      legend: {
        A: { blockId: 'casing', hatches: ['fluidIn'] },
        B: { blockId: 'casing', hatches: ['fluidIn'] },
      },
    });
    const units = [unit(1), unit(2, 2), unit(3, 4)];
    const water = placeHatches(line, units, [], undefined, {
      requests: [
        { kind: 'fluidIn', units: [2], key: 'water' },
        { kind: 'fluidIn', units: [1, 3], key: 'water' },
      ],
    });
    expect(water.unplaced).toEqual([]);
    expect(water.hatches).toHaveLength(2);
    expect(water.hatches[0].unitIds).toEqual([1, 2]);
    const lava = placeHatches(line, units, [], undefined, {
      requests: [
        { kind: 'fluidIn', units: [2], key: 'water' },
        { kind: 'fluidIn', units: [1, 3], key: 'lava' },
      ],
    });
    expect(lava.hatches.some((h) => h.unitIds.length > 1)).toBe(false);
    expect(lava.unplaced.map((u) => [u.unitId, u.reason])).toEqual([[2, 'noCell']]);
  });
});
