import { describe, expect, it } from 'vitest';
import { FLOOR_BLOCKS } from '../data/floor';
import { emptySite, validateSiteState } from '../share/siteCodec';
import { withFloor, withGroupAdded, withGroupPatched, withRouting } from './siteActions';

describe('group tiers, mirror, wall sharing, assignments and routing', () => {
  const ebf = () => {
    const s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
    return { s, id: s.groups[0].id };
  };

  it('sets and clears the tier, mirror and wall sharing without moving the group', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { tier: 'HV', mirror: true, wallshare: 'stack' });
    expect(a.groups[0]).toMatchObject({ tier: 'HV', mirror: true, wallshare: 'stack', origin: [3, 3] });
    const b = withGroupPatched(a, id, { tier: null, mirror: false, wallshare: 'auto' });
    expect(b.groups[0]).toEqual(s.groups[0]);
    expect(withGroupPatched(a, id, { tier: 'HV' })).toBe(a);
  });

  it('sets and clears sharing of maintenance and energy hatches', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { shareMaintenance: true, shareEnergy: true });
    expect(a.groups[0]).toMatchObject({ shareMaintenance: true, shareEnergy: true });
    const b = withGroupPatched(a, id, { shareMaintenance: false, shareEnergy: false });
    expect(b.groups[0]).toEqual(s.groups[0]);
  });

  it('drops hatch tiers when mirror, wall sharing or shared hatches really change, not otherwise', () => {
    const { s, id } = ebf();
    const tiered = withGroupPatched(s, id, { hatchTiers: { 'energy:0': 'EV' } });
    for (const patch of [
      { mirror: true },
      { wallshare: 'stack' },
      { shareEnergy: true },
      { shareMaintenance: true },
      { quadFluid: false },
    ] as const)
      expect(withGroupPatched(tiered, id, patch).groups[0].hatchTiers, JSON.stringify(patch)).toBeUndefined();
    for (const patch of [
      { mirror: false },
      { wallshare: 'auto' },
      { shareEnergy: false },
      { quadFluid: true },
    ] as const)
      expect(withGroupPatched(tiered, id, patch).groups[0].hatchTiers, JSON.stringify(patch)).toBeDefined();
    // A patch that sets tiers keeps its own.
    const both = withGroupPatched(tiered, id, { mirror: true, hatchTiers: { 'energy:1': 'IV' } });
    expect(both.groups[0].hatchTiers).toEqual({ 'energy:1': 'IV' });
  });

  it('clears the sharing options when the machine cannot share walls', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { shareEnergy: true, shareMaintenance: true });
    const solo = withGroupPatched(a, id, { multiblockId: 'placeholder' });
    expect(solo.groups[0].multiblockId).toBe('placeholder');
    expect('shareEnergy' in solo.groups[0] || 'shareMaintenance' in solo.groups[0]).toBe(false);
    const other = withGroupPatched(a, id, { multiblockId: 'vacuum-freezer' });
    expect(other.groups[0]).toMatchObject({ shareEnergy: true, shareMaintenance: true });
  });

  it('clears the quadruple-hatch option when the machine takes no fluid inputs', () => {
    const { s, id } = ebf();
    const off = withGroupPatched(s, id, { quadFluid: false });
    expect(off.groups[0].quadFluid).toBe(false);
    expect(withGroupPatched(off, id, { multiblockId: 'vacuum-freezer' }).groups[0].quadFluid).toBe(false);
    expect('quadFluid' in withGroupPatched(off, id, { multiblockId: 'implosion-compressor' }).groups[0]).toBe(
      false,
    );
  });

  it('stores hatch tiers and clears the map when it is empty', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { hatchTiers: { 'energy:0': 'EV' } });
    expect(a.groups[0].hatchTiers).toEqual({ 'energy:0': 'EV' });
    expect(withGroupPatched(a, id, { hatchTiers: {} }).groups[0].hatchTiers).toBeUndefined();
    expect(withGroupPatched(a, id, { hatchTiers: null }).groups[0].hatchTiers).toBeUndefined();
  });

  it('stores resource assignments and drops empty ones', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { assign: { 'item:a': { unit: 'all' }, 'item:b': { zone: 'dot2' } } });
    expect(a.groups[0].assign).toEqual({ 'item:a': { unit: 'all' }, 'item:b': { zone: 'dot2' } });
    const b = withGroupPatched(a, id, { assign: { 'item:a': {}, 'item:b': { zone: 'dot2' } } });
    expect(b.groups[0].assign).toEqual({ 'item:b': { zone: 'dot2' } });
    expect(withGroupPatched(b, id, { assign: {} }).groups[0].assign).toBeUndefined();
    expect(validateSiteState(a)).toBeTruthy();
  });

  it('transformer direction and amperage default to down and 4', () => {
    let s = withGroupAdded(emptySite(), 'single-block', [3, 3]);
    const id = s.groups[0].id;
    s = withGroupPatched(s, id, { machine: 'transformer', tier: 'UEV', step: 'up', amps: 16 });
    expect(s.groups[0]).toMatchObject({ machine: 'transformer', step: 'up', amps: 16, tier: 'UEV' });
    const back = withGroupPatched(s, id, { step: 'down', amps: 4 });
    expect(back.groups[0].step).toBeUndefined();
    expect(back.groups[0].amps).toBeUndefined();
  });

  it('another machine type drops only the transformer settings, keeping the tier', () => {
    let s = withGroupAdded(emptySite(), 'single-block', [3, 3]);
    const id = s.groups[0].id;
    s = withGroupPatched(s, id, { machine: 'transformer', tier: 'HV', step: 'up', amps: 64 });
    s = withGroupPatched(s, id, { machine: 'macerator' });
    expect(s.groups[0].machine).toBe('macerator');
    expect(s.groups[0].tier).toBe('HV');
    expect(s.groups[0].step).toBeUndefined();
    expect(s.groups[0].amps).toBeUndefined();
  });

  it('replacing the multiblock keeps tier, hatch tiers and assignments', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, {
      tier: 'ZPM',
      hatchTiers: { 'energy:0': 'EV' },
      assign: { 'item:a': { unit: 0 } },
    });
    const b = withGroupPatched(a, id, { multiblockId: 'vacuum-freezer' });
    expect(b.groups[0].hatchTiers).toEqual({ 'energy:0': 'EV' });
    expect(b.groups[0].assign).toEqual({ 'item:a': { unit: 0 } });
    expect(b.groups[0].tier).toBe('ZPM');
  });

  it('drops the glass tier on a multiblock switch, and null clears it', () => {
    const { s, id } = ebf();
    const a = withGroupPatched(s, id, { glassTier: 'UV' });
    expect(a.groups[0].glassTier).toBe('UV');
    expect('glassTier' in withGroupPatched(a, id, { multiblockId: 'vacuum-freezer' }).groups[0]).toBe(false);
    expect(withGroupPatched(a, id, { tier: 'HV' }).groups[0].glassTier).toBe('UV');
    expect('glassTier' in withGroupPatched(a, id, { glassTier: null }).groups[0]).toBe(false);
  });

  it('a transformer that becomes another group loses its direction and amperage', () => {
    let s = withGroupAdded(emptySite(), 'single-block', [3, 3]);
    const id = s.groups[0].id;
    s = withGroupPatched(s, id, { machine: 'transformer', tier: 'HV', step: 'up', amps: 64 });
    const multi = withGroupPatched(s, id, { multiblockId: 'electric-blast-furnace' });
    expect(multi.groups[0].step).toBeUndefined();
    expect(multi.groups[0].amps).toBeUndefined();
    expect(multi.groups[0].tier).toBe('HV');
    // The amperage stays chosen after a tier change.
    const low = withGroupPatched(withGroupPatched(s, id, { tier: 'UEV', amps: 16 }), id, { tier: 'HV' });
    expect(low.groups[0].amps).toBe(16);
  });

  it('sets and clears the routing of the template', () => {
    const s = emptySite();
    const neat = withRouting(s, { style: 'neat', depth: 2 });
    expect(neat.routing).toEqual({ style: 'neat', depth: 2 });
    expect(withRouting(neat, { style: 'neat', depth: 2 })).toBe(neat);
    expect('routing' in withRouting(neat, undefined)).toBe(false);
    expect(withRouting(s, undefined)).toBe(s);
  });
});

describe('withFloor', () => {
  it('sets a known floor block, clears it, and ignores unknown ids', () => {
    const s = emptySite();
    const floored = withFloor(s, FLOOR_BLOCKS[0]);
    expect(floored.floor).toBe(FLOOR_BLOCKS[0]);
    expect(withFloor(floored, FLOOR_BLOCKS[0])).toBe(floored);
    expect('floor' in withFloor(floored, undefined)).toBe(false);
    expect(withFloor(s, 'mc.nope')).toBe(s);
  });
});
