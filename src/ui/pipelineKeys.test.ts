import { describe, expect, it } from 'vitest';
import { DEFAULT_HATCH_COLORS } from '../model/colors';
import type { PlanLimits, Unit } from '../model/multiblock/types';
import { hatchKey, layoutKey, pipesKey, sceneKey, validityKey } from './pipelineKeys';

type LayoutInput = Parameters<typeof layoutKey>[0];
const layoutInput: LayoutInput = {
  defId: 'ebf',
  size: undefined,
  count: 4,
  limits: { x: null, y: 1, z: null } as PlanLimits,
  mirror: false,
  coil: undefined,
  wallshare: undefined,
  manualUnits: undefined,
};
const noTiers = { tier: undefined, hatchTiers: undefined, glassTier: undefined };
const noSharing = { maintenance: false, energy: false };
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
      { ...layoutInput, coil: 'kanthal' },
      { ...layoutInput, coil: 'eternal' },
      { ...layoutInput, wallshare: 'stack' },
      { ...layoutInput, manualUnits: oneUnit },
      { ...layoutInput, manualUnits: [{ ...oneUnit[0], variant: 3 }] },
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
    const h = hatchKey(l, ['energy'], null, false, noSharing);
    expect(hatchKey(l2, ['energy'], null, false, noSharing)).not.toBe(h);
    expect(hatchKey(l, ['energy', 'muffler'], null, false, noSharing)).not.toBe(h);
    expect(hatchKey(l, ['energy'], ['itemIn'], false, noSharing)).not.toBe(h);
    expect(hatchKey(l, ['energy'], null, true, noSharing)).not.toBe(h);
    expect(hatchKey(l, ['energy'], null, false, { maintenance: true, energy: false })).not.toBe(h);
    expect(hatchKey(l, ['energy'], null, false, { maintenance: false, energy: true })).not.toBe(h);
    const p = pipesKey(h, []);
    expect(pipesKey(h, ['itemIn'])).not.toBe(p);
    expect(pipesKey(hatchKey(l2, ['energy'], null, false, noSharing), [])).not.toBe(p);
    const v = validityKey(p, noTiers);
    expect(validityKey(pipesKey(h, ['itemIn']), noTiers)).not.toBe(v);
    expect(validityKey(pipesKey(hatchKey(l2, ['energy'], null, false, noSharing), []), noTiers)).not.toBe(v);
    const s = sceneKey(p, DEFAULT_HATCH_COLORS);
    expect(sceneKey(p, { ...DEFAULT_HATCH_COLORS, itemIn: '#000000' })).not.toBe(s);
    expect(sceneKey(pipesKey(h, ['itemIn']), DEFAULT_HATCH_COLORS)).not.toBe(s);
  });

  it('change the validity key with every tier input', () => {
    const p = pipesKey(hatchKey(layoutKey(layoutInput), ['energy'], null, false, noSharing), []);
    const v = validityKey(p, noTiers);
    const changed = [
      { ...noTiers, tier: 'HV' as const },
      { ...noTiers, hatchTiers: { 'energy:0': 'IV' as const } },
      { ...noTiers, glassTier: 'LuV' as const },
    ].map((t) => validityKey(p, t));
    expect(new Set([v, ...changed]).size).toBe(changed.length + 1);
    // Hatch tiers compare by value, whatever their key order.
    const a = { 'energy:0': 'IV' as const, 'fluidOut:1': 'EV' as const };
    const b = { 'fluidOut:1': 'EV' as const, 'energy:0': 'IV' as const };
    expect(validityKey(p, { ...noTiers, hatchTiers: a })).toBe(validityKey(p, { ...noTiers, hatchTiers: b }));
  });
});
