import { describe, expect, it } from 'vitest';
import { emptySite, validateSiteState } from '../share/siteCodec';
import { withGroupAdded, withGroupPatched, withRouting } from './siteActions';

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
