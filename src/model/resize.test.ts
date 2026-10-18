import { createHash } from 'node:crypto';
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

describe('regions a requirement does not count', () => {
  it('keep their name in every slab copy (a hatch zone covers them all)', () => {
    const def: MultiblockDef = { ...line, requiredHatches: { itemOut: { min: 1 } } };
    const d = sizedDef(def, 6);
    const regions = [1, 2, 3, 4].map((x) => d.legend[d.layers[0][0][x]].region);
    expect(regions).toEqual(['slice', 'slice', 'slice', 'slice']);
    expect(Object.keys(d.legend)).toEqual(Object.keys(def.legend));
  });

  it('leaves the hand-made resizable entries as they were (counted regions are still numbered)', () => {
    // sha256 prefix of the JSON of every size of each entry, taken with the numbering of every slab region.
    const digest = (id: string) => {
      const d = getMultiblock(id)!;
      return createHash('sha256')
        .update(JSON.stringify(resizeSteps(d.resize!).map((n) => sizedDef(d, n))))
        .digest('hex')
        .slice(0, 16);
    };
    expect(digest('assembly-line')).toBe('af8fad7d74956255');
    expect(digest('distillation-tower')).toBe('054a1efbe2dbca35');
  });
});

describe('requirements with perSlab', () => {
  const withPerSlab = (): MultiblockDef => ({
    ...line,
    requiredHatches: { itemIn: { min: 2, max: 2, perSlab: 1 }, itemOut: { min: 1 } },
  });

  it('grow by perSlab for every added slab, min and max alike, and the sized def states them plainly', () => {
    const d = sizedDef(withPerSlab(), 6); // three more slabs
    expect(d.requiredHatches?.itemIn).toEqual({ min: 5, max: 5 });
    expect(d.requiredHatches?.itemOut).toEqual({ min: 1 });
    expect(sizedDef(withPerSlab(), 3)).toEqual(withPerSlab());
  });

  it('adds to the one per numbered region', () => {
    const def: MultiblockDef = {
      ...line,
      requiredHatches: { itemIn: { min: 1, max: 1, regions: ['slice'], perSlab: 1 } },
    };
    const d = sizedDef(def, 5); // two more slabs: regions 1 -> 3, plus two from perSlab
    expect(d.requiredHatches?.itemIn).toMatchObject({ min: 5, max: 5 });
    expect(d.requiredHatches?.itemIn?.regions).toHaveLength(3);
  });

  it('is only valid on a resizable def, and a whole number >= 1', () => {
    expect(validateMultiblockDef(withPerSlab())).toEqual([]);
    const fixed = { ...withPerSlab(), resize: undefined };
    expect(validateMultiblockDef(fixed).join()).toMatch(/perSlab/);
    const zero = { ...withPerSlab(), requiredHatches: { itemIn: { min: 2, perSlab: 0 } } };
    expect(validateMultiblockDef(zero).join()).toMatch(/perSlab/);
  });
});
