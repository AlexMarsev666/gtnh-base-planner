import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { validateMultiblockDef } from '../data/validate';
import { localCells } from './geometry';
import { effectiveSize, resizeSteps, sizedDef } from './resize';
import type { MultiblockDef } from './multiblock/types';

const dt = getMultiblock('distillation-tower')!;

/** 5 long along x: controller slice, one repeating slice (region), end slice. */
const line: MultiblockDef = {
  id: 'line',
  name: 'Line',
  size: [3, 1, 2],
  layers: [['~sE', 'CsE']],
  legend: {
    C: { blockId: 'gt.casing.solidSteel' },
    s: { blockId: 'gt.casing.solidSteel', hatches: ['itemIn'], region: 'slice' },
    E: { blockId: 'gt.casing.solidSteel', hatches: ['itemOut'] },
  },
  controller: { pos: [0, 0, 0], facing: 'north', blockId: 'gt.controller' },
  hatchBlocks: { itemIn: 'gt.hatch.inputBus', itemOut: 'gt.hatch.outputBus' },
  shareableHatches: [],
  requiredHatches: { itemIn: { min: 1, max: 1, regions: ['slice'] }, itemOut: { min: 1 } },
  defaultHatches: ['itemIn', 'itemOut'],
  wallshare: false,
  resize: { axis: 'x', from: 1, to: 2, min: 3, max: 6, default: 4, label: 'length' },
};

describe('sizedDef', () => {
  for (const [axis, size, layers] of [
    ['x', [2, 1, 1], [['~E']]],
    ['y', [1, 2, 1], [['~'], ['E']]],
    ['z', [1, 1, 2], [['~', 'E']]],
  ] as const)
    it(`inserts source-defined sections along ${axis} without copying the end piece`, () => {
      const def: MultiblockDef = {
        ...line,
        size: [...size],
        layers: layers.map((rows) => [...rows]),
        legend: { E: { blockId: 'gt.casing.solidSteel' }, S: { blockId: 'gt.casing.grate' } },
        hatchBlocks: {},
        requiredHatches: {},
        defaultHatches: [],
        resize: {
          axis,
          from: 1,
          to: 2,
          min: 2,
          max: 4,
          default: 3,
          label: 'length',
          section: { size: [1, 1, 1], layers: [['S']] },
        },
      };
      expect(sizedDef(def, 2)).toBe(def);
      const grown = sizedDef(def, 4);
      const cells = localCells(grown);
      expect(cells.filter((c) => c.char === 'S')).toHaveLength(2);
      expect(cells.filter((c) => c.char === 'E')).toHaveLength(1);
      expect(cells.find((c) => c.char === 'E')!.local[{ x: 0, y: 1, z: 2 }[axis]]).toBe(3);
      expect(validateMultiblockDef(grown)).toEqual([]);
      const invalid = {
        ...def,
        resize: { ...def.resize!, section: { size: [1, 1, 1] as [number, number, number], layers: [['~']] } },
      };
      expect(validateMultiblockDef(invalid).some((e) => e.includes('section layers'))).toBe(true);
    });
  it('returns the stored def at its smallest size and for fixed-size multiblocks', () => {
    expect(sizedDef(dt, 3)).toBe(dt);
    const coke = getMultiblock('coke-oven')!;
    expect(sizedDef(coke, 7)).toBe(coke);
  });

  it('is memoised per size', () => {
    expect(sizedDef(dt, 7)).toBe(sizedDef(dt, 7));
    expect(sizedDef(dt, 7)).not.toBe(sizedDef(dt, 8));
  });

  it('snaps sizes into range', () => {
    expect(effectiveSize(dt, undefined)).toBe(5);
    expect(effectiveSize(dt, 1)).toBe(3);
    expect(effectiveSize(dt, 40)).toBe(12);
    expect(effectiveSize(getMultiblock('coke-oven')!, 5)).toBeUndefined();
    expect(resizeSteps(dt.resize!)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('repeats the slab, numbers its regions and grows the requirement', () => {
    const d = sizedDef(line, 6);
    expect(d.size).toEqual([6, 1, 2]);
    expect(d.layers[0][0].length).toBe(6);
    expect(d.layers[0][0][0]).toBe('~');
    expect(d.layers[0][0][5]).toBe('E');
    const regions = [1, 2, 3, 4].map((x) => d.legend[d.layers[0][0][x]].region);
    expect(regions).toEqual(['slice1', 'slice2', 'slice3', 'slice4']);
    // Both rows of one slab copy share its region.
    expect(d.layers[0][1][2]).toBe(d.layers[0][0][2]);
    expect(d.requiredHatches?.itemIn).toEqual({
      min: 4,
      max: 4,
      regions: ['slice1', 'slice2', 'slice3', 'slice4'],
    });
    expect(d.requiredHatches?.itemOut).toEqual({ min: 1 });
    expect(validateMultiblockDef(d)).toEqual([]);
  });

  it('moves a controller that lies past the slab', () => {
    const flipped: MultiblockDef = {
      ...line,
      layers: [['Es~', 'EsC']],
      controller: { ...line.controller, pos: [2, 0, 0] },
    };
    const d = sizedDef(flipped, 5);
    expect(d.controller.pos).toEqual([4, 0, 0]);
    expect(
      localCells(d)
        .filter((c) => c.role === 'controller')
        .map((c) => c.local),
    ).toEqual([[4, 0, 0]]);
  });

  it('builds a valid Distillation Tower at every height', () => {
    for (const h of resizeSteps(dt.resize!)) {
      const d = sizedDef(dt, h);
      expect(d.size[1]).toBe(h);
      expect(validateMultiblockDef(d)).toEqual([]);
      expect(d.requiredHatches?.fluidOut?.regions).toHaveLength(h - 1);
      expect(d.requiredHatches?.fluidOut?.min).toBe(h - 1);
    }
  });
});
