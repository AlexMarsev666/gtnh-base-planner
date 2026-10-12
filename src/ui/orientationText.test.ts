import { describe, expect, it } from 'vitest';
import { mirroredDef } from '../model/mirror';
import type { MultiblockDef } from '../model/multiblock/types';
import { mirrorDisabled, unitOrientation } from './orientationText';
import type { PipelineResult } from './pipeline';
import { statsParts } from './statsText';

const def = { variants: [0, 2] } as unknown as MultiblockDef;
const free = {} as MultiblockDef;

describe('mirrorDisabled', () => {
  it('blocks switching on when GT forbids the mirrored build', () => {
    expect(mirrorDisabled(def, false)).toBe(true);
    expect(mirrorDisabled(free, false)).toBe(false);
    expect(mirrorDisabled(undefined, false)).toBe(false);
    expect(mirrorDisabled({ variants: [0, 1] }, false)).toBe(false);
  });
  it('lets an old plan turn it off', () => {
    expect(mirrorDisabled(def, true)).toBe(false);
  });
});

describe('unitOrientation', () => {
  it('is null for a plain unit', () => {
    expect(unitOrientation(free, undefined)).toBeNull();
    expect(unitOrientation(free, 0)).toBeNull();
  });
  it('names the variants', () => {
    expect(unitOrientation(free, 1)).toBe('Mirrored');
    expect(unitOrientation(free, 2)).toBe('Upside down');
    expect(unitOrientation(free, 3)).toBe('Mirrored vertically');
  });
  it('takes the plan mirror into account', () => {
    const base = {
      size: [1, 1, 1],
      layers: [['~']],
      legend: {},
      controller: { pos: [0, 0, 0], facing: 'north' },
    };
    const m = mirroredDef(base as unknown as MultiblockDef);
    expect(unitOrientation(m, undefined)).toBe('Mirrored');
    expect(unitOrientation(m, 1)).toBeNull();
    expect(unitOrientation(m, 2)).toBe('Mirrored vertically');
  });
});

describe('statsParts orientation', () => {
  const base = {
    size: [1, 1, 1],
    layers: [['~']],
    legend: {},
    controller: { pos: [0, 0, 0], facing: 'north' },
  };
  const result = (d: MultiblockDef, variants: (0 | 1 | 2 | 3 | undefined)[]) =>
    ({
      def: d,
      pack: { placed: variants.length, units: variants.map((variant, id) => ({ id, variant })) },
    }) as unknown as PipelineResult;

  it('counts units by absolute orientation', () => {
    const plain = base as unknown as MultiblockDef;
    expect(statsParts(result(plain, [0, undefined]), []).main).not.toContain('1 unit flipped or mirrored');
    expect(statsParts(result(plain, [0, 2, 3]), []).main).toContain('2 units flipped or mirrored');
    // Under the plan mirror a unit with variant 1 is plain again and a plain one is mirrored.
    const m = mirroredDef(plain);
    expect(statsParts(result(m, [0, 1, 2]), []).main).toContain('2 units flipped or mirrored');
  });
  it('adds the orientation of a single selected unit', () => {
    const plain = base as unknown as MultiblockDef;
    const r = result(plain, [0, 2]);
    expect(statsParts(r, [1]).selected).toBe('Unit 2, upside down');
    expect(statsParts(r, [0]).selected).toBe('Unit 1');
    expect(statsParts(r, [0, 1]).selected).toBe('Units 1, 2');
  });
});
