import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { unitCells } from '../geometry';
import * as plan from '../plan';
import type { Unit } from '../multiblock/types';
import { buildGroup } from './group';
import { createSiteBuilder } from './build';
import { emptySite } from '../../share/siteCodec';
import { groupDemandBound } from './resourceAllocation';
import { hatchAssignmentKey, placeResourceHatches, validateResourceHatches } from './resourcePlacement';

const def = getMultiblock('oil-cracking-unit')!;
const enabled = ['energy', 'maintenance', 'fluidIn', 'fluidOut'] as const;
const demand = { fluidIn: ['feed-a', 'feed-b', 'hydrogen'], fluidOut: ['out-a', 'out-b'] };
const bindings = [
  { kind: 'fluidIn' as const, resource: 'feed-a', role: 'feed' as const },
  { kind: 'fluidIn' as const, resource: 'feed-b', role: 'feed' as const, unitId: 1 },
  { kind: 'fluidIn' as const, resource: 'hydrogen', role: 'catalyst' as const, unitId: 0 },
];
const settings = { voltageTier: 'HV' as const, resourceBindings: bindings };

afterEach(() => vi.restoreAllMocks());
describe('group resource allocation invariants', () => {
  for (const [name, offset, shared] of [
    ['vertical shared middle', [0, 2, 0], true],
    ['separate machines', [6, 0, 0], false],
  ] as const)
    it(`${name}: reuses one agent for both controllers and honors a manual feed assignment`, () => {
      const units: Unit[] = [
        { id: 0, origin: [0, 0, 0], rotation: 0 },
        { id: 1, origin: offset, rotation: 0 },
      ];
      const result = placeResourceHatches(def, units, enabled, demand, settings, true, {});
      expect(result.unplaced).toEqual([]);
      expect(validateResourceHatches(def, units, result.hatches, settings, demand)).toEqual([]);
      expect(result.hatches.some((h) => h.resource === 'feed-b' && h.unitIds.includes(1))).toBe(true);
      const agents = result.hatches.filter((h) => h.resource === 'hydrogen');
      expect(agents).toHaveLength(shared ? 1 : 2);
      for (const unit of units) expect(agents.some((h) => h.unitIds.includes(unit.id))).toBe(true);
      const occupied = new Set(result.hatches.map((h) => h.cell.join()));
      for (const unit of units)
        expect(
          unitCells(def, unit).filter((c) => c.hatches?.length && !occupied.has(c.pos.join())).length,
        ).toBeGreaterThanOrEqual(18);
      const broken = result.hatches.map((h) => (h.resource === 'feed-b' ? { ...h, resource: 'feed-a' } : h));
      expect(validateResourceHatches(def, units, broken, settings, demand)).toContain(
        'Group: feed-b needs an assigned fluidIn in region side on controller 1.',
      );
      if (shared) {
        const wrongOwner = result.hatches.map((h) =>
          h.resource === 'hydrogen' ? { ...h, unitIds: [0] } : h,
        );
        expect(
          validateResourceHatches(def, units, wrongOwner, settings, demand).some((e) =>
            e.includes('every physical owner'),
          ),
        ).toBe(true);
      }
    });

  it('keeps per-machine power tiers when a structural filler repeats the linked resource', () => {
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [6, 0, 0], rotation: 0 },
    ];
    const powered = { ...demand, energy: ['power'] };
    const options = {
      ...settings,
      resourceBindings: [...bindings, { kind: 'energy' as const, resource: 'power', unitId: 0 }],
      hatchTiers: { [hatchAssignmentKey(1, 'energy', 'power')]: 'EV' as const },
    };
    const result = placeResourceHatches(def, units, enabled, powered, options, true, {});
    expect(result.unplaced).toEqual([]);
    expect(result.hatches.filter((h) => h.kind === 'energy')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: 'power', unitIds: [0], tier: 'HV' }),
        expect.objectContaining({ resource: 'power', unitIds: [1], tier: 'EV' }),
      ]),
    );
    expect(validateResourceHatches(def, units, result.hatches, options, powered)).toEqual([]);
  });

  it('uses separate agent hatches when the two owners require different tiers', () => {
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [0, 2, 0], rotation: 0 },
    ];
    const options = {
      ...settings,
      hatchTiers: { [hatchAssignmentKey(1, 'fluidIn', 'hydrogen')]: 'MV' as const },
    };
    const result = placeResourceHatches(def, units, enabled, demand, options, true, {});
    expect(result.unplaced).toEqual([]);
    const agents = result.hatches.filter((h) => h.resource === 'hydrogen');
    expect(agents).toHaveLength(2);
    expect(agents.every((h) => h.unitIds.length === 1)).toBe(true);
    expect(agents.map((h) => h.tier).sort()).toEqual(['HV', 'MV']);
    expect(validateResourceHatches(def, units, result.hatches, options, demand)).toEqual([]);
  });

  it('does not turn an enabled optional resource interface into a per-controller minimum', () => {
    const furnace = getMultiblock('electric-blast-furnace')!;
    const built = buildGroup(
      furnace,
      2,
      { x: 2, y: 1, z: 1 },
      ['energy', 'maintenance', 'muffler', 'itemIn', 'itemOut'],
      { fluidIn: ['nitrogen'] },
      true,
      {},
      { voltageTier: 'HV' },
    );
    expect(built.unplaced).toEqual([]);
    expect(built.hatches.filter((h) => h.kind === 'fluidIn')).toHaveLength(1);
    expect(
      validateResourceHatches(furnace, built.units, built.hatches, {}, { fluidIn: ['nitrogen'] }),
    ).toEqual([]);
  });

  it('counts a shared resource once even when two machines are explicitly assigned to it', () => {
    const bound = groupDemandBound(
      def,
      2,
      enabled,
      { fluidIn: ['feed-a', 'feed-b', 'hydrogen'], fluidOut: ['out-a', 'out-b'] },
      [...bindings, { kind: 'fluidIn', resource: 'hydrogen', role: 'catalyst', unitId: 1 }],
    );
    expect(bound.needed).toBe(9);
    expect(bound.capacity).toBe(14);
    expect(bound.message).toBeUndefined();
  });

  it('validates group coverage without depending on the placer assignment keys', () => {
    const built = buildGroup(def, 2, { x: null, y: null, z: null }, enabled, demand, true, {}, settings);
    const plain = built.hatches.map((h) => ({ ...h, assignments: undefined }));
    expect(validateResourceHatches(def, built.units, plain, settings, demand)).toEqual([]);
    const absent = plain.map((h) => (h.resource === 'out-b' ? { ...h, resource: undefined } : h));
    expect(validateResourceHatches(def, built.units, absent, settings, demand)).toContain(
      'Group: out-b needs an assigned fluidOut.',
    );
    const energy = plain.find((h) => h.kind === 'energy')!;
    const sharedEnergy = plain.map((h) => (h === energy ? { ...h, unitIds: [0, 1] } : h));
    expect(validateResourceHatches(def, built.units, sharedEnergy, settings, demand).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects the 15-versus-14 lower bound without any alternate-layout search', () => {
    const fluidIn = ['f1', 'f2', 'f3', 'f4', 'a1', 'a2'];
    const tooMuch = { fluidIn, fluidOut: ['p1', 'p2', 'p3', 'p4', 'p5'] };
    const options = {
      resourceBindings: fluidIn.map((resource, i) => ({
        kind: 'fluidIn' as const,
        resource,
        role: i < 4 ? ('feed' as const) : ('catalyst' as const),
      })),
    };
    expect(groupDemandBound(def, 2, enabled, tooMuch, options.resourceBindings)).toMatchObject({
      needed: 15,
      capacity: 14,
    });
    const resolve = vi.spyOn(plan, 'resolveLayout');
    const built = buildGroup(def, 2, { x: null, y: null, z: null }, enabled, tooMuch, true, {}, options);
    expect(resolve).not.toHaveBeenCalled();
    expect(built.capacityProblems).toContainEqual(expect.stringMatching(/15.*14/));
    for (const unit of built.units)
      for (const kind of ['energy', 'maintenance'])
        expect(built.hatches.some((h) => h.kind === kind && h.unitIds.includes(unit.id))).toBe(true);
  });

  it('warns and uses auto for a disappeared machine, preserving the document and restoring its assignment after growth', () => {
    const site = emptySite();
    site.groups = [
      {
        id: 'g',
        multiblockId: def.id,
        count: 1,
        limits: { x: null, y: null, z: null },
        enabledHatches: [...enabled],
        origin: [5, 5],
        rotation: 0,
        resourceBindings: bindings,
      },
    ];
    site.resources = Object.fromEntries(
      [...demand.fluidIn, ...demand.fluidOut].map((resource) => [
        resource,
        { kind: 'fluid', name: resource, color: '#112233' },
      ]),
    );
    site.ports = Object.keys(site.resources).map((resource, i) => ({
      id: 'p' + i,
      resource,
      dir: demand.fluidIn.includes(resource) ? 'in' : 'out',
    }));
    site.links = site.ports.map((p) => ({
      id: 'l' + p.id,
      resource: p.resource,
      from: p.dir === 'in' ? { port: p.id } : { group: 'g' },
      to: p.dir === 'in' ? { group: 'g' } : { port: p.id },
    }));
    const build = createSiteBuilder();
    const smaller = build(site, { pipes: false, cables: false });
    expect(smaller.warnings).toContainEqual(
      expect.objectContaining({ type: 'assignment', message: expect.stringMatching(/Machine 2.*automatic/) }),
    );
    expect(smaller.groups[0].hatches.some((h) => h.resource === 'feed-b')).toBe(true);
    expect(site.groups[0].resourceBindings).toEqual(bindings);
    site.groups[0].count = 2;
    const larger = build(site, { pipes: false, cables: false });
    expect(larger.warnings.filter((w) => w.type === 'assignment')).toEqual([]);
    expect(larger.groups[0].hatches.some((h) => h.resource === 'feed-b' && h.unitIds.includes(1))).toBe(true);
    // Validate local assignments against global ids too, as after site placement/routing.
    expect(
      validateResourceHatches(
        def,
        larger.groups[0].units.map((u) => ({ ...u, id: u.id + 10000 })),
        larger.groups[0].hatches.map((h) => ({ ...h, unitIds: h.unitIds.map((id) => id + 10000) })),
        settings,
        demand,
      ),
    ).toEqual([]);
  });
});
