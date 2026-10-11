import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ID, SINGLE_BLOCK_ID, getSiteDef } from '../data/generic';
import { SINGLE_MACHINES } from '../data/single-machines';
import type { SiteWarning } from '../model/site/buildTypes';
import {
  ampOptions,
  groupHatchRows,
  groupResources,
  groupTiers,
  hasStructure,
  matchMachines,
  routingView,
  splitWarnings,
  tierChoices,
  unitChoices,
  unitValue,
  zoneChoices,
} from './siteInspect';

describe('routing block', () => {
  it('shows the legacy routing with an offer to go neat at least one layer deep', () => {
    const off = routingView({}, false);
    expect(off).toEqual({
      routing: { style: 'classic', depth: 0 },
      legacy: true,
      neatOffer: { style: 'neat', depth: 1 },
    });
    expect(routingView({}, true).routing.depth).toBe(1);
  });

  it("shows the site's own routing, with no offer, and keeps a deeper depth", () => {
    const v = routingView({ routing: { style: 'classic', depth: 3 } }, false);
    expect(v.legacy).toBe(false);
    expect(v.routing).toEqual({ style: 'classic', depth: 3 });
    expect(v.neatOffer).toEqual({ style: 'neat', depth: 3 });
  });
});

describe('group machine options', () => {
  it('lists the tiers of a multiblock, none for a steam machine', () => {
    const ebf = getSiteDef('electric-blast-furnace')!;
    expect(groupTiers({}, ebf)).toContain('HV');
    expect(groupTiers({}, getSiteDef('coke-oven')!)).toEqual([]);
    expect(groupTiers({}, undefined)).toEqual([]);
  });

  it('single blocks take the tiers of their machine type', () => {
    const single = getSiteDef(SINGLE_BLOCK_ID)!;
    const m = SINGLE_MACHINES.find((x) => x.tiers[0] !== 'ULV' || x.tiers[1] !== 'MAX')!;
    const tiers = groupTiers({ machine: m.id }, single);
    expect(tiers[0]).toBe(m.tiers[0]);
    expect(tiers.at(-1)).toBe(m.tiers[1]);
  });

  it('keeps a tier that is not allowed in the list, marked', () => {
    const labels = { any: 'Any', notAllowed: '(not allowed)' };
    expect(tierChoices(['HV', 'EV'], 'EV', labels).map((o) => o.label)).toEqual(['Any', 'HV', 'EV']);
    const odd = tierChoices(['HV', 'EV'], 'LV', labels);
    expect(odd.at(-1)).toEqual({ value: 'LV', label: 'LV (not allowed)' });
    expect(tierChoices(['HV'], undefined, labels)).toHaveLength(2);
  });

  it('mirror and wall sharing are for real multiblocks only', () => {
    expect(hasStructure(getSiteDef('electric-blast-furnace'))).toBe(true);
    expect(hasStructure(getSiteDef(SINGLE_BLOCK_ID))).toBe(false);
    expect(hasStructure(getSiteDef(PLACEHOLDER_ID))).toBe(false);
    expect(hasStructure(undefined)).toBe(false);
  });

  it('disables Hi-Amp below UEV only when a tier is set', () => {
    expect(ampOptions('HV')).toEqual([
      { amps: 4, disabled: false },
      { amps: 16, disabled: true },
      { amps: 64, disabled: false },
    ]);
    expect(ampOptions('UEV').every((o) => !o.disabled)).toBe(true);
    expect(ampOptions(undefined).every((o) => !o.disabled)).toBe(true);
  });

  it('searches machine types by name or planner name', () => {
    expect(matchMachines('').length).toBe(SINGLE_MACHINES.length);
    const m = SINGLE_MACHINES[0];
    expect(matchMachines(m.name.toUpperCase()).map((x) => x.id)).toContain(m.id);
    expect(matchMachines('zzzz-no-such-machine')).toEqual([]);
  });
});

describe('resources of a group', () => {
  it('offers Auto, All units and one choice per unit', () => {
    const c = unitChoices(3);
    expect(c.map((x) => x.value)).toEqual(['', 'all', '0', '1', '2']);
    expect(c[1].unit).toBe('all');
    expect(unitValue(undefined)).toBe('');
    expect(unitValue({ unit: 'all' })).toBe('all');
    expect(unitValue({ unit: 0 })).toBe('0');
    expect(unitValue({ zone: 'dot1' })).toBe('');
  });

  it('lists the demanded resources by kind', () => {
    expect(groupResources({ itemIn: ['item:a', 'item:b'], fluidOut: ['fluid:x'] })).toEqual([
      { kind: 'itemIn', resource: 'item:a' },
      { kind: 'itemIn', resource: 'item:b' },
      { kind: 'fluidOut', resource: 'fluid:x' },
    ]);
    expect(groupResources({})).toEqual([]);
  });

  it('lists the zones that take a kind, then the legend regions, and keeps a chosen zone', () => {
    const def = getSiteDef('distillation-tower')!;
    const zones = zoneChoices(def, 'fluidOut');
    expect(zones.length).toBeGreaterThan(0);
    expect(new Set(zones.map((z) => z.value)).size).toBe(zones.length);
    expect(zoneChoices(def, 'fluidOut', 'gone').at(-1)).toEqual({ value: 'gone', label: 'gone' });
  });

  it('keys group hatches by ordinal, or by resource and unit', () => {
    const rows = groupHatchRows(
      [
        { kind: 'energy', unitIds: [10] },
        { kind: 'energy', unitIds: [11] },
        { kind: 'itemIn', resource: 'item:a', unitIds: [10] },
        { kind: 'itemIn', resource: 'item:a', unitIds: [11] },
        { kind: 'fluidIn', resource: 'fluid:w', unitIds: [10, 11] },
        { kind: 'maintenance', unitIds: [10] },
      ],
      [10, 11],
    );
    expect(rows.map((r) => r.key)).toEqual([
      'energy:0',
      'energy:1',
      'itemIn:item:a:0',
      'itemIn:item:a:1',
      'fluidIn:fluid:w:shared',
    ]);
  });
});

describe('warnings', () => {
  it('counts an unknown voltage as information, not a problem', () => {
    const w: SiteWarning[] = [
      { type: 'powerUnknownTier', resource: 'power:eu' },
      { type: 'outside', group: 'g1' },
    ];
    const { problems, info } = splitWarnings(w);
    expect(problems.map((x) => x.type)).toEqual(['outside']);
    expect(info.map((x) => x.type)).toEqual(['powerUnknownTier']);
  });
});
