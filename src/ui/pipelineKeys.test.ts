import { describe, expect, it } from 'vitest';
import { DEFAULT_HATCH_COLORS } from '../model/colors';
import type { PlanLimits, Unit } from '../model/multiblock/types';
import { hatchKey, layoutKey, pipesKey, sceneKey } from './pipelineKeys';

type LayoutInput = Parameters<typeof layoutKey>[0];
const layoutInput: LayoutInput = {
  defId: 'ebf',
  size: undefined,
  count: 4,
  limits: { x: null, y: 1, z: null } as PlanLimits,
  mirror: false,
  wallshare: undefined,
  manualUnits: undefined,
};
const oneUnit: Unit[] = [{ id: 0, origin: [0, 0, 0], rotation: 0 }];

describe('pipeline keys', () => {
  it('change the layout key with every packing input', () => {
    const base = layoutKey(layoutInput);
    const changed = (<LayoutInput[]>[
      { ...layoutInput, defId: 'vf' },
      { ...layoutInput, size: 5 },
      { ...layoutInput, count: 5 },
      { ...layoutInput, limits: { x: 2, y: 1, z: null } },
      { ...layoutInput, limits: { x: null, y: 2, z: null } },
      { ...layoutInput, limits: { x: null, y: 1, z: 2 } },
      { ...layoutInput, mirror: true },
      { ...layoutInput, wallshare: 'stack' },
      { ...layoutInput, manualUnits: oneUnit },
    ]).map((i) => layoutKey(i));
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
    // Limits compare by value, whatever their key order.
    // 'auto' is the same as no preference.
    expect(layoutKey({ ...layoutInput, wallshare: 'auto' })).toBe(base);
    expect(layoutKey({ ...layoutInput, limits: { z: null, y: 1, x: null } })).toBe(base);
  });

  it('carry every upstream key along', () => {
    const l = layoutKey(layoutInput);
    const l2 = layoutKey({ ...layoutInput, count: 5 });
    const h = hatchKey(l, ['energy'], null, false);
    expect(hatchKey(l2, ['energy'], null, false)).not.toBe(h);
    expect(hatchKey(l, ['energy', 'muffler'], null, false)).not.toBe(h);
    expect(hatchKey(l, ['energy'], ['itemIn'], false)).not.toBe(h);
    expect(hatchKey(l, ['energy'], null, true)).not.toBe(h);
    const p = pipesKey(h, []);
    expect(pipesKey(h, ['itemIn'])).not.toBe(p);
    expect(pipesKey(hatchKey(l2, ['energy'], null, false), [])).not.toBe(p);
    const s = sceneKey(p, DEFAULT_HATCH_COLORS);
    expect(sceneKey(p, { ...DEFAULT_HATCH_COLORS, itemIn: '#000000' })).not.toBe(s);
    expect(sceneKey(pipesKey(h, ['itemIn']), DEFAULT_HATCH_COLORS)).not.toBe(s);
  });
});
