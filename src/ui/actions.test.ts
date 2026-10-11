import { describe, expect, it } from 'vitest';
import { defaultPlan } from '../state/store';
import {
  withCount,
  withDefaultColors,
  withDefaultHatchTiers,
  withHatchColor,
  withHatchTier,
  withHatchToggled,
  withLimit,
  withMirror,
  withMultiblock,
  withSize,
  withTier,
  withWallshare,
} from './actions';
import { samePlan } from './session';

describe('plan transforms', () => {
  it('sets a size only on resizable multiblocks, snapped, and drops it when switching', () => {
    const dt = defaultPlan('distillation-tower');
    expect(withSize(dt, 5)).toBe(dt); // the default
    expect(withSize(dt, 8).size).toBe(8);
    expect(withSize(dt, 99).size).toBe(12);
    const coke = defaultPlan();
    expect(withSize(coke, 8)).toBe(coke);
    expect(withMultiblock(withSize(dt, 8), 'coke-oven').size).toBeUndefined();
  });

  it('clamps the count and drops a manual layout', () => {
    const p = {
      ...defaultPlan(),
      manualUnits: [{ id: 0, origin: [0, 0, 0] as const, rotation: 0 as const }],
    };
    const next = withCount(p, 5000);
    expect(next.count).toBe(2000);
    expect(next.manualUnits).toBeUndefined();
    expect(p.manualUnits).toHaveLength(1);
  });

  it('returns the same plan when nothing changes', () => {
    const p = defaultPlan();
    expect(withCount(p, p.count)).toBe(p);
    expect(withLimit(p, 'x', null)).toBe(p);
    expect(withMultiblock(p, p.multiblockId)).toBe(p);
    expect(withMultiblock(p, 'no-such-multiblock')).toBe(p);
    expect(withDefaultColors(p)).toBe(p);
  });

  it('sets one limit axis and drops a manual layout', () => {
    const p = withLimit(defaultPlan(), 'y', 15);
    expect(p.limits).toEqual({ x: null, y: 15, z: null });
    const manual = { ...p, manualUnits: [{ id: 0, origin: [0, 0, 0] as const, rotation: 0 as const }] };
    expect(withLimit(manual, 'x', 9).manualUnits).toBeUndefined();
  });

  it('toggles hatches', () => {
    const p = defaultPlan();
    const off = withHatchToggled(p, 'itemIn');
    expect(off.enabledHatches).not.toContain('itemIn');
    expect(withHatchToggled(off, 'itemIn').enabledHatches).toContain('itemIn');
  });

  it('accepts only #rrggbb colours', () => {
    const p = defaultPlan();
    expect(withHatchColor(p, 'itemIn', '#ABCDEF').colors.itemIn).toBe('#abcdef');
    expect(withHatchColor(p, 'itemIn', 'red')).toBe(p);
    expect(withDefaultColors(withHatchColor(p, 'itemIn', '#000000')).colors).toEqual({});
  });
});

describe('samePlan', () => {
  it('ignores key order and undefined fields', () => {
    const a = defaultPlan();
    const { v, ...rest } = a;
    const b = { ...rest, manualUnits: undefined, v };
    expect(samePlan(a, b)).toBe(true);
    expect(samePlan(a, { ...a, count: a.count + 1 })).toBe(false);
  });
});

describe('tier, mirror and wall sharing transforms', () => {
  const manual = { id: 0, origin: [0, 0, 0] as const, rotation: 0 as const };

  it('sets and clears the machine tier', () => {
    const p = defaultPlan('electric-blast-furnace');
    const hv = withTier(p, 'HV');
    expect(hv.tier).toBe('HV');
    expect(withTier(hv, 'HV')).toBe(hv);
    expect('tier' in withTier(hv, undefined)).toBe(false);
    expect(withTier(p, undefined)).toBe(p);
  });

  it('sets a hatch tier by key and drops the map when it is empty', () => {
    const p = defaultPlan();
    const one = withHatchTier(p, 'itemIn:0', 'EV');
    expect(one.hatchTiers).toEqual({ 'itemIn:0': 'EV' });
    expect(withHatchTier(one, 'itemIn:0', 'EV')).toBe(one);
    expect(withHatchTier(withHatchTier(one, 'fluidIn:1', 'LV'), 'itemIn:0', undefined).hatchTiers).toEqual({
      'fluidIn:1': 'LV',
    });
    expect('hatchTiers' in withHatchTier(one, 'itemIn:0', undefined)).toBe(false);
    expect(withDefaultHatchTiers(p)).toBe(p);
    expect('hatchTiers' in withDefaultHatchTiers(one)).toBe(false);
  });

  it('mirror and wall sharing re-pack, so a manual layout is dropped; auto and off clear them', () => {
    const p = { ...defaultPlan(), manualUnits: [manual] };
    const mirrored = withMirror(p, true);
    expect(mirrored.mirror).toBe(true);
    expect(mirrored.manualUnits).toBeUndefined();
    expect(withMirror(mirrored, true)).toBe(mirrored);
    expect('mirror' in withMirror(mirrored, false)).toBe(false);
    expect(withMirror(defaultPlan(), false).mirror).toBeUndefined();
    const stacked = withWallshare(p, 'stack');
    expect(stacked.wallshare).toBe('stack');
    expect(stacked.manualUnits).toBeUndefined();
    expect(withWallshare(stacked, 'stack')).toBe(stacked);
    expect('wallshare' in withWallshare(stacked, 'auto')).toBe(false);
    expect(withWallshare(defaultPlan(), 'auto').wallshare).toBeUndefined();
  });

  it('switching multiblock drops hatch tiers but keeps the machine tier, allowed or not', () => {
    const p = withHatchTier(withTier(defaultPlan('electric-blast-furnace'), 'ZPM'), 'itemIn:0', 'EV');
    const ok = withMultiblock(p, 'assembly-line');
    expect(ok.tier).toBe('ZPM');
    expect(ok.hatchTiers).toBeUndefined();
    const low = withMultiblock(withTier(defaultPlan('electric-blast-furnace'), 'LV'), 'assembly-line');
    expect(low.tier).toBe('LV'); // the Assembly Line wants LuV; Settings shows "(not allowed)"
    const steam = withMultiblock(p, 'coke-oven');
    expect(steam.tier).toBe('ZPM');
  });
});

describe('hatch tiers and layout changes', () => {
  const tiered = withHatchTier(defaultPlan('electric-blast-furnace'), 'itemIn:0', 'EV');

  it('drop when the count, size, limits, mirror, wall sharing or hatch kinds change', () => {
    expect(withCount(tiered, 9).hatchTiers).toBeUndefined();
    expect(withLimit(tiered, 'x', 3).hatchTiers).toBeUndefined();
    expect(withMirror(tiered, true).hatchTiers).toBeUndefined();
    expect(withWallshare(tiered, 'stack').hatchTiers).toBeUndefined();
    expect(withHatchToggled(tiered, 'muffler').hatchTiers).toBeUndefined();
    const dt = withHatchTier(defaultPlan('distillation-tower'), 'itemIn:0', 'EV');
    expect(withSize(dt, 8).hatchTiers).toBeUndefined();
  });

  it('stay when nothing changes', () => {
    expect(withCount(tiered, tiered.count)).toBe(tiered);
    expect(withMirror(tiered, false)).toBe(tiered);
  });
});
