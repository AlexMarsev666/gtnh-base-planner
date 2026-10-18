import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { COILS, coilById } from '../data/coils';
import { requiredBlocks } from '../model/bom';
import { defaultPlan } from '../state/store';
import { emptySite } from '../share/siteCodec';
import { withPlanCoil, withMultiblock } from './actions';
import { createPipeline, planBom } from './pipeline';
import { withGroupAdded, withGroupPatched } from './siteActions';
import { coilChoices } from './validityText';

/** The heating coil of a machine plan: scene, bill of materials, edits. */

const plan = (coil?: string) => ({
  ...defaultPlan('electric-blast-furnace'),
  count: 2,
  ...(coil ? { coil } : {}),
});

describe('machine view with a coil', () => {
  it('draws and counts the chosen coil instead of the drawn one', () => {
    const run = createPipeline();
    const def = getMultiblock('electric-blast-furnace')!;
    const drawn = def.legend[def.coils!.chars[0]].blockId;
    const count = (scene: NonNullable<ReturnType<typeof run>['scene']>, id: string) =>
      scene.voxels.filter((v) => v.blockId === id).length;
    const before = run(plan(), false);
    const after = run(plan('nichrome'), false);
    const nichrome = coilById('nichrome')!.blockId;
    const n = count(before.scene!, drawn);
    expect(n).toBeGreaterThan(0);
    expect(count(after.scene!, drawn)).toBe(0);
    expect(count(after.scene!, nichrome)).toBe(n);
    // Walls stay shared with the same coil on both units: the same layout, the same block total.
    expect(after.stats!.totalBlocks).toBe(before.stats!.totalBlocks);
    const bom = planBom(after.scene!, {});
    expect(bom.blocks.find((r) => r.blockId === nichrome)?.count).toBe(n);
    expect(bom.blocks.some((r) => r.blockId === drawn)).toBe(false);
    expect(requiredBlocks(before.scene!).blocks.find((r) => r.blockId === drawn)?.count).toBe(n);
  });

  it('keeps the memo when the coil does not change, and ignores a coil on a machine without one', () => {
    const run = createPipeline();
    const a = run(plan('kanthal'), false);
    expect(run(plan('kanthal'), false)).toBe(a);
    expect(run(plan('eternal'), false)).not.toBe(a);
    const tower = { ...defaultPlan('distillation-tower') };
    const t = run(tower, false);
    expect(run({ ...tower, coil: 'kanthal' }, false).scene).toBe(t.scene);
  });
});

describe('coil edits', () => {
  it('sets and clears the coil, and returns the same plan when nothing changes', () => {
    const p = plan();
    const a = withPlanCoil(p, 'kanthal');
    expect(a.coil).toBe('kanthal');
    expect(withPlanCoil(a, 'kanthal')).toBe(a);
    expect('coil' in withPlanCoil(a, undefined)).toBe(false);
    expect(withPlanCoil(p, undefined)).toBe(p);
    expect(withPlanCoil(a, 'bedrock')).toBe(a);
  });

  it('is dropped when the multiblock changes', () => {
    expect('coil' in withMultiblock(plan('kanthal'), 'volcanus')).toBe(false);
  });

  it('is a patch of a template group, dropped when its multiblock changes', () => {
    let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
    const id = s.groups[0].id;
    s = withGroupPatched(s, id, { coil: 'kanthal' });
    expect(s.groups[0].coil).toBe('kanthal');
    expect(withGroupPatched(s, id, { count: 3 }).groups[0].coil).toBe('kanthal');
    // An unknown id is ignored.
    expect(withGroupPatched(s, id, { coil: 'bedrock' }).groups[0].coil).toBe('kanthal');
    expect('coil' in withGroupPatched(s, id, { coil: null }).groups[0]).toBe(false);
    expect('coil' in withGroupPatched(s, id, { multiblockId: 'volcanus' }).groups[0]).toBe(false);
  });
});

describe('coil picker', () => {
  it('starts with the drawn coil, then every coil from weakest to strongest', () => {
    const choices = coilChoices(getMultiblock('electric-blast-furnace')!);
    expect(choices[0]).toEqual({ value: '', label: 'Cupronickel Coil Block (drawn)' });
    expect(choices).toHaveLength(COILS.length + 1);
    expect(choices[1]).toEqual({ value: 'cupronickel', label: 'Cupronickel' });
    expect(choices.at(-1)).toEqual({ value: 'eternal', label: 'Eternal' });
    // By heat, not meta: HSS-S (meta 9) sits between HSS-G and Naquadah.
    const labels = choices.map((c) => c.label);
    expect(labels.slice(labels.indexOf('HSS-G'), labels.indexOf('HSS-G') + 3)).toEqual([
      'HSS-G',
      'HSS-S',
      'Naquadah',
    ]);
    expect(coilChoices(getMultiblock('volcanus')!)[0].label).toBe('Cupronickel (drawn)');
  });
});
