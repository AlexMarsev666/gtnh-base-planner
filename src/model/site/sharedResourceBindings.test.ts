import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { emptySite, siteFromJson, siteToJson, encodeSite, decodeSite } from '../../share/siteCodec';
import { loadStoredSite, saveStoredSite } from '../../share/sitePersist';
import { placeResourceHatches, validateResourceHatches } from './resourcePlacement';
import { manualDemandProblems } from './resourceAllocation';
import { hatchCapacity } from '../multiblock/casingConstraints';
import { buildGroup } from './group';
import { createSiteBuilder } from './build';
import { withGroupDuplicated } from '../../ui/siteActions';
import { emptyHistory, recorded, undone, redone } from '../../ui/siteHistory';
import { arrangeHere } from '../../ui/siteArrange';
import type { ResourceBinding } from './types';
import type { Unit } from '../multiblock/types';

const def = getMultiblock('oil-cracking-unit')!;
const enabled = ['energy', 'maintenance', 'fluidIn', 'fluidOut'] as const;
const demand = { fluidIn: ['feed-a', 'feed-b', 'agent'], fluidOut: ['out-a', 'out-b'] };
const bindings: ResourceBinding[] = [
  { kind: 'fluidIn', resource: 'feed-a', role: 'feed' },
  { kind: 'fluidIn', resource: 'feed-b', role: 'feed' },
  { kind: 'fluidIn', resource: 'agent', role: 'catalyst', unitIds: [0, 1] },
];
const settings = { voltageTier: 'HV' as const, resourceBindings: bindings };

describe('one physical hatch explicitly serving multiple machines', () => {
  it('uses one common agent hatch and consumes both capacities', () => {
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [0, 2, 0], rotation: 0 },
    ];
    const placed = placeResourceHatches(def, units, enabled, demand, settings, true, {});
    expect(placed.unplaced).toEqual([]);
    const agents = placed.hatches.filter((h) => h.resource === 'agent');
    expect(agents).toHaveLength(1);
    expect(agents[0].unitIds).toEqual([0, 1]);
    for (const unit of units)
      expect(placed.hatches.filter((h) => h.unitIds.includes(unit.id)).length).toBeLessThanOrEqual(
        hatchCapacity(def, unit).capacity,
      );
    expect(validateResourceHatches(def, units, placed.hatches, settings, demand)).toEqual([]);
    const separate = placeResourceHatches(
      def,
      [units[0], { ...units[1], origin: [6, 0, 0] }],
      enabled,
      demand,
      settings,
      true,
      {},
    );
    expect(separate.unplaced.length).toBeGreaterThan(0);
    // Separate copies cannot silently satisfy an explicitly requested common physical hatch.
    expect(
      validateResourceHatches(
        def,
        units,
        agents.map((h) => ({ ...h, unitIds: [0] })),
        settings,
        demand,
      ).some((message) => message.includes('in one shared hatch')),
    ).toBe(true);
  });

  it('counts explicit shared demand against each owner before placement', () => {
    const fluidIn = Array.from({ length: 6 }, (_, i) => `fluid-${i}`);
    const bs: ResourceBinding[] = fluidIn.map((resource, i) => ({
      kind: 'fluidIn',
      resource,
      role: i === 0 ? 'catalyst' : 'feed',
      unitIds: [0, 1],
    }));
    const problems = manualDemandProblems(def, 2, enabled, { fluidIn }, bs);
    expect(problems.map((p) => [p.unitId, p.fluids, p.capacity])).toEqual([
      [0, 6, 7],
      [1, 6, 7],
    ]);
    expect(problems.every((p) => p.excess > 0)).toBe(true);
  });

  it('selects a compatible layout for a shared agent without unit mirroring', () => {
    const group = buildGroup(def, 2, { x: null, y: null, z: null }, enabled, demand, true, {}, settings);
    expect(group.unplaced).toEqual([]);
    expect(group.hatches.filter((h) => h.resource === 'agent')).toHaveLength(1);
    expect(validateResourceHatches(group.def, group.units, group.hatches, settings, demand)).toEqual([]);
  });

  it('preserves shared owners, roles and tiers through Arrange and Optimize', () => {
    const site = emptySite();
    site.groups = [
      {
        id: 'g',
        multiblockId: def.id,
        count: 2,
        limits: { x: null, y: null, z: null },
        enabledHatches: [...enabled],
        origin: [8, 8],
        rotation: 0,
        ...settings,
        hatchTiers: { fluidIn: 'EV' },
      },
    ];
    for (const resource of [...demand.fluidIn, ...demand.fluidOut]) {
      const input = demand.fluidIn.includes(resource);
      const i = site.ports.length;
      site.resources[resource] = { kind: 'fluid', name: resource, color: '#123456' };
      site.ports.push({ id: `p${i}`, resource, dir: input ? 'in' : 'out', pos: [input ? 0 : 59, 4 + i * 3] });
      site.links.push({
        id: `l${i}`,
        resource,
        from: input ? { port: `p${i}` } : { group: 'g' },
        to: input ? { group: 'g' } : { port: `p${i}` },
      });
    }
    const builder = createSiteBuilder();
    for (const optimize of [false, true]) {
      const result = arrangeHere(site, true, builder, optimize, {
        now: () => 0,
        iterations: 4,
        seeds: 1,
        seedOffset: 19,
        refineRuns: 1,
        refineSteps: 4,
      });
      expect(result.site.groups[0]).toMatchObject(settings);
      expect(result.site.groups[0].hatchTiers).toEqual(site.groups[0].hatchTiers);
      const built = builder(result.site, { pipes: true, cables: true, below: true });
      expect(built.warnings.filter((w) => w.type !== 'unrouted')).toEqual([]);
      expect(built.groups[0].hatches.filter((h) => h.resource === 'agent')).toHaveLength(1);
    }
  });

  it('retains shared IDs through codecs, storage, duplicate and history; stale owners warn', async () => {
    const site = emptySite();
    site.groups = [
      {
        id: 'g',
        multiblockId: def.id,
        count: 2,
        limits: { x: null, y: null, z: null },
        enabledHatches: [...enabled],
        origin: [8, 8],
        rotation: 0,
        ...settings,
      },
    ];
    site.resources = { agent: { kind: 'fluid', name: 'Agent', color: '#123456' } };
    site.groups[0].resourceBindings = [bindings[2]];
    const expected = [{ ...bindings[2] }];
    expect(siteFromJson(siteToJson(site)).groups[0].resourceBindings).toEqual(expected);
    expect((await decodeSite(await encodeSite(site))).groups[0].resourceBindings).toEqual(expected);
    const map = new Map<string, string>();
    const storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    expect(saveStoredSite(site, storage)).toBe(true);
    expect(loadStoredSite(storage)!.groups[0].resourceBindings).toEqual(expected);
    const copy = withGroupDuplicated(site, 'g', [40, 40]);
    expect(copy.groups[1].resourceBindings).toEqual(expected);
    expect(copy.groups[1].resourceBindings![0].unitIds).not.toBe(site.groups[0].resourceBindings![0].unitIds);
    const smaller = { ...site, groups: [{ ...site.groups[0], count: 1 }] };
    const history = recorded(emptyHistory<typeof site>(), site, null, 1);
    const back = undone(history, smaller)!;
    expect(back.value.groups[0].resourceBindings).toEqual(expected);
    expect(redone(back.history, back.value)!.value.groups[0].resourceBindings).toEqual(expected);
    expect(createSiteBuilder()(smaller, { pipes: false, cables: false }).warnings).toContainEqual(
      expect.objectContaining({
        type: 'assignment',
        message: expect.stringMatching(/Machine 2.*shared owner/),
      }),
    );
    for (const invalid of [[0], [0, 0], [-1, 1]]) {
      site.groups[0].resourceBindings![0] = { ...bindings[2], unitIds: invalid };
      expect(() => siteFromJson(siteToJson(site))).toThrow();
    }
    site.groups[0].resourceBindings![0] = { ...bindings[2], unitId: 0 };
    expect(() => siteFromJson(siteToJson(site))).toThrow();
  });
});
