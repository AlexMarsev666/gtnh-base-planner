import { describe, expect, it } from 'vitest';
import { requiredBlocks } from '../bom';
import { createSiteBuilder } from './build';
import { groupHatchKeys, siteBomTiers } from './siteScene';
import type { SiteGroup, SiteState } from './types';

function group(id: string, extra: Partial<SiteGroup> = {}): SiteGroup {
  return {
    id,
    multiblockId: 'electric-blast-furnace',
    count: 2,
    limits: { x: null, y: 1, z: null },
    enabledHatches: ['energy', 'maintenance', 'muffler'],
    origin: [3, 3],
    rotation: 0,
    ...extra,
  };
}

function site(groups: SiteGroup[]): SiteState {
  return {
    v: 1,
    kind: 'site',
    size: [40, 30],
    corridor: 2,
    groups,
    links: [],
    ports: [],
    resources: {},
    colors: {},
  };
}

const build = (s: SiteState) => createSiteBuilder()(s, { pipes: false, cables: false });
const rowsOf = (b: ReturnType<typeof build>, tiers?: ReturnType<typeof siteBomTiers>) =>
  requiredBlocks(b.scene, undefined, tiers).blocks.map((r) => [r.label, r.count, r.tier ?? null]);

describe('site hatch keys', () => {
  it('number kinds without a resource and give the others resource and unit, or shared', () => {
    expect(
      groupHatchKeys(
        [
          { kind: 'energy', unitIds: [4] },
          { kind: 'energy', unitIds: [5] },
          { kind: 'itemIn', resource: 'item:a', unitIds: [5] },
          { kind: 'fluidIn', resource: 'fluid:w', unitIds: [4, 5] },
        ],
        [4, 5],
      ),
    ).toEqual(['energy:0', 'energy:1', 'itemIn:item:a:1', 'fluidIn:fluid:w:shared']);
  });
});

describe('site bill of materials with tiers', () => {
  it('has no tiers for an untiered template, so its list is unchanged', () => {
    const b = build(site([group('g1'), group('g2', { origin: [20, 3] })]));
    expect(siteBomTiers(b.groups)).toBeUndefined();
  });

  it('tiers the energy hatches of the group that has a tier, and only those', () => {
    const plain = build(site([group('g1'), group('g2', { origin: [20, 3] })]));
    const tiered = build(site([group('g1', { tier: 'HV' }), group('g2', { origin: [20, 3] })]));
    const tiers = siteBomTiers(tiered.groups);
    expect(tiers).toBeDefined();
    const rows = rowsOf(tiered, tiers);
    const energy = rows.filter(([label]) => String(label).includes('(HV)'));
    expect(energy.length).toBeGreaterThan(0);
    // Same blocks in total; only the energy hatches of g1 are told apart from g2's.
    const total = (r: typeof rows) => r.reduce((n, x) => n + Number(x[1]), 0);
    expect(total(rows)).toBe(total(rowsOf(plain)));
  });

  it('a hatch tier of its own overrides the group tier', () => {
    const s = site([group('g1', { tier: 'HV', hatchTiers: { 'energy:0': 'EV' } })]);
    const b = build(s);
    const rows = rowsOf(b, siteBomTiers(b.groups));
    expect(rows.some(([label]) => String(label).includes('(EV)'))).toBe(true);
    expect(rows.some(([label]) => String(label).includes('(HV)'))).toBe(true);
  });
});
