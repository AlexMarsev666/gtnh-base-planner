import { describe, expect, it } from 'vitest';
import { requiredBlocks } from '../bom';
import { createSiteBuilder } from './build';
import { JUNCTION_COLOR } from '../colors';
import { dirVec } from '../geometry';
import type { SiteNet } from './buildTypes';
import { buildSiteScene, groupHatchKeys, siteBomTiers } from './siteScene';
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

describe('pipe junctions in front of a hatch several nets end at', () => {
  const ebf = group('ebf', { count: 1, tier: 'MV', enabledHatches: [], origin: [14, 14] });
  const names = ['a', 'b', 'c'];
  const multi = (extra: Partial<SiteState> = {}): SiteState => ({
    ...site([ebf]),
    ports: names.map((n) => ({ id: `p${n}`, dir: 'in' as const, resource: `item:${n}` })),
    links: names.map((n) => ({
      id: `l${n}`,
      from: { port: `p${n}` },
      to: { group: 'ebf' },
      resource: `item:${n}`,
    })),
    resources: {
      'item:a': { kind: 'item', name: 'A', color: '#ff0000' },
      'item:b': { kind: 'item', name: 'B', color: '#00ff00' },
      'item:c': { kind: 'item', name: 'C', color: '#0000ff' },
    },
    ...extra,
  });
  const run = (s: SiteState, isolate?: string) =>
    createSiteBuilder()(s, { pipes: true, cables: false, below: true, isolate });

  it('has one junction in the cell in front of the bus, with the colour of every net', () => {
    const b = run(multi());
    const bus = b.groups[0].hatches.find((h) => h.kind === 'itemIn')!;
    const js = b.scene.junctions!;
    expect(js).toHaveLength(1);
    const v = dirVec(bus.face);
    expect(js[0].cell).toEqual(bus.cell.map((x, i) => x + v[i]));
    expect(js[0].hatch).toEqual(bus.cell);
    expect(js[0].face).toBe(bus.face);
    expect(js[0].kind).toBe(b.scene.pipes![0].kind);
    expect(js[0].colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(js[0].nets).toEqual(b.scene.pipes!.map((n) => n.id));
    expect(js[0].dim).toBeUndefined();
  });

  it('shows the bus marker neutral, not in the colour of one resource', () => {
    const b = run(multi());
    const bus = b.groups[0].hatches.find((h) => h.kind === 'itemIn')!;
    const mark = b.scene.markers!.find((m) => m.pos.join() === bus.cell.join())!;
    expect(mark.color).toBe(JUNCTION_COLOR);
  });

  it('dims a junction only when all of its nets are dimmed', () => {
    expect(run(multi(), 'item:a').scene.junctions![0].dim).toBeUndefined();
    expect(run(multi(), 'fluid:none').scene.junctions![0].dim).toBe(true);
  });

  it('has no junction for a hatch with one net', () => {
    const one = multi({ ports: multi().ports.slice(0, 1), links: multi().links.slice(0, 1) });
    expect(run(one).scene.junctions).toBeUndefined();
  });
});

describe('junctions from synthetic nets', () => {
  const hatchCell: [number, number, number] = [5, 0, 5];
  const res = {
    'item:a': { kind: 'item' as const, name: 'A', color: '#ff0000' },
    'item:b': { kind: 'item' as const, name: 'B', color: '#00ff00' },
    'power:e': { kind: 'power' as const, name: 'E', color: '#ffff00' },
  };
  const net = (id: number, resource: keyof typeof res, face: 'east' | 'west' | null): SiteNet => ({
    id,
    resource,
    kind: res[resource].kind,
    links: [],
    terminals: [{ role: 'sink', group: 'g', hatch: {} as never, cell: hatchCell }],
    route: { attach: [face], paths: [], length: 0, connected: face ? 1 : 0, total: 1 } as never,
  });
  const scene = (nets: SiteNet[]) =>
    buildSiteScene({ ...site([]), resources: res }, [], [], nets, new Set()).junctions;

  it('counts only nets that connected here and reach the hatch through one face', () => {
    expect(scene([net(0, 'item:a', 'east'), net(1, 'item:b', null)])).toBeUndefined();
    expect(scene([net(0, 'item:a', 'east'), net(1, 'item:b', 'west')])).toBeUndefined();
    const js = scene([net(0, 'item:a', 'east'), net(1, 'item:b', 'west'), net(2, 'item:b', 'east')])!;
    expect(js).toHaveLength(1);
    expect(js[0].nets).toEqual([0, 2]);
    expect(js[0].colors).toEqual(['#ff0000', '#00ff00']);
    expect(js[0].face).toBe('east');
  });

  it('makes no junction for cables', () => {
    expect(scene([net(0, 'power:e', 'east'), net(1, 'power:e', 'east')])).toBeUndefined();
  });
});
