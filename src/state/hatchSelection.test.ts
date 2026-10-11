import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { siteGroup, siteHatch } from './site';
import { defaultPlan, plan, selectedHatch } from './store';

describe('hatch selection', () => {
  it('keeps the picked group hatch only while its group is selected', () => {
    siteGroup.set('a');
    siteHatch.set({ group: 'a', key: 'energy:0', cell: [0, 0, 0] });
    siteGroup.set('a');
    expect(get(siteHatch)).toEqual({ group: 'a', key: 'energy:0', cell: [0, 0, 0] });
    siteGroup.set('b');
    expect(get(siteHatch)).toBeNull();
  });

  it('drops the picked machine hatch when another multiblock is chosen', () => {
    plan.set(defaultPlan('electric-blast-furnace'));
    selectedHatch.set({ key: 'energy:0', cell: [0, 0, 0] });
    plan.update((p) => ({ ...p, count: 2 }));
    expect(get(selectedHatch)?.key).toBe('energy:0');
    plan.set(defaultPlan('oil-cracking-unit'));
    expect(get(selectedHatch)).toBeNull();
  });
});
