import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { defaultPlan } from '../../state/store';
import { defaultGroupHatches, buildGroup } from '../site/group';
import { hatchKindFor } from '../site/demand';
import { createSiteBuilder } from '../site/build';
import { validateResourceHatches } from '../site/resourcePlacement';
import { supportsHatchTier } from '../hatches/tiers';
import { minimumCasings } from './rules';
import { encodePlan, decodePlan, HATCH_KINDS } from '../../share/codec';
import { validateSiteState, encodeSite, decodeSite } from '../../share/siteCodec';
import type { SiteState } from '../site/types';
import { requiredBlocks, ioClass } from '../bom';
import { unitCells } from '../geometry';
import { validateCasings } from './casingConstraints';

describe('RC2 locked fluid interfaces', () => {
  for (const [id, kind, fluid, meta, casings] of [
    ['cryogenic-freezer', 'cryotheumIn', 'cryotheum', 967, 46],
    ['volcanus', 'pyrotheumIn', 'pyrotheum', 968, 6],
  ] as const) {
    const def = getMultiblock(id)!;
    it(`${id}: places its concrete fixed-tier interface separately from ordinary input`, () => {
      expect(validateMultiblockDef(def)).toEqual([]);
      expect(def.hatchBlocks[kind]).toBe(`gregtech:gt.blockmachines@${meta}`);
      expect(def.requiredHatches?.[kind]).toEqual({ min: 1 });
      expect(minimumCasings(def)).toBe(casings);
      expect(supportsHatchTier(def, kind)).toBe(false);
      expect(ioClass(kind)).toBe('fluid');
      expect(defaultPlan(id).enabledHatches).toContain(kind);
      expect(defaultGroupHatches(def)).toContain(kind);
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        def.defaultHatches,
        {},
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.filter((h) => h.kind === kind)).toHaveLength(1);
      expect(built.hatches.some((h) => h.kind === 'itemIn' || h.kind === 'fluidIn')).toBe(true);
      expect(validateResourceHatches(built.def, built.units, built.hatches)).toEqual([]);
      const absent = built.hatches.filter((h) => h.kind !== kind);
      expect(
        validateResourceHatches(built.def, built.units, absent).some((e) => e.includes(`${kind} count 0`)),
      ).toBe(true);
    });
    it(`${id}: uses exact IDs, requires unknown resources to be assigned and rejects a known wrong fluid`, () => {
      const unknown = { kind: 'fluid' as const, name: 'Gelid Cryotheum', color: '#abcdef' };
      expect(hatchKindFor('in', 'coolant', unknown, def)).toBeNull();
      expect(hatchKindFor('in', 'coolant', { ...unknown, gameId: fluid }, def)).toBe(kind);
      expect(hatchKindFor('in', 'coolant', unknown, def, [{ kind, resource: 'coolant' }])).toBe(kind);
      expect(
        hatchKindFor('in', 'coolant', { ...unknown, gameId: 'water' }, def, [{ kind, resource: 'coolant' }]),
      ).toBeNull();
      expect(hatchKindFor('in', 'coolant', unknown, def, [{ kind: 'fluidIn', resource: 'coolant' }])).toBe(
        'fluidIn',
      );
      expect(hatchKindFor('in', 'coolant', { ...unknown, gameId: 'water' }, def)).toBe('fluidIn');
    });
    it(`${id}: reserves counted casings even when demand exceeds every legal replacement`, () => {
      const demand = { fluidIn: Array.from({ length: 100 }, (_, i) => `feed-${i}`) };
      // Group demand no longer changes the source minima; exercise the resource placer itself.
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        [...def.defaultHatches, 'fluidIn'],
        demand,
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced.length).toBeGreaterThan(0);
      expect(validateCasings(built.def, built.units, built.hatches)).toEqual([]);
      const remaining = unitCells(built.def, built.units[0]).find(
        (cell) =>
          cell.hatches?.includes('fluidIn') && !built.hatches.some((h) => h.cell.join() === cell.pos.join()),
      )!;
      expect(
        validateCasings(built.def, built.units, [
          ...built.hatches,
          {
            cell: remaining.pos,
            kind: 'fluidIn',
            face: 'north',
            unitIds: [built.units[0].id],
          },
        ]),
      ).not.toEqual([]);
    });
    it(`${id}: leaves an old saved hatch list intact and diagnoses the missing special interface`, () => {
      const enabled = def.defaultHatches.filter((k) => k !== kind);
      const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, { voltageTier: 'LV' });
      expect(built.hatches.some((h) => h.kind === kind)).toBe(false);
      expect(
        validateResourceHatches(built.def, built.units, built.hatches).some((e) =>
          e.includes(`${kind} count 0`),
        ),
      ).toBe(true);
      if (id === 'cryogenic-freezer')
        expect(unitCells(def, built.units[0]).some((c) => c.role === 'air')).toBe(false);
    });
    it(`${id}: routes dedicated and recipe inputs separately, retaining assignments through both codecs`, async () => {
      const site: SiteState = {
        v: 2,
        kind: 'site',
        name: id,
        size: [24, 24],
        corridor: 2,
        colors: {},
        groups: [
          {
            id: 'machine',
            multiblockId: id,
            count: 1,
            origin: [8, 8],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            enabledHatches: defaultGroupHatches(def),
            voltageTier: 'LV',
            resourceBindings: [
              { kind, resource: 'coolant' },
              { kind: 'fluidIn', resource: 'feed' },
            ],
          },
        ],
        resources: {
          coolant: { kind: 'fluid', name: 'Custom coolant', color: '#abcdef' },
          feed: { kind: 'fluid', name: 'Recipe feed', color: '#123456' },
        },
        ports: [
          { id: 'coolant-port', dir: 'in', resource: 'coolant', pos: [0, 5] },
          { id: 'feed-port', dir: 'in', resource: 'feed', pos: [0, 15] },
        ],
        links: [
          {
            id: 'coolant-link',
            resource: 'coolant',
            from: { port: 'coolant-port' },
            to: { group: 'machine' },
          },
          { id: 'feed-link', resource: 'feed', from: { port: 'feed-port' }, to: { group: 'machine' } },
        ],
      };
      const builder = createSiteBuilder();
      const built = builder(site, { pipes: true, cables: false, below: true });
      expect(built.warnings).toEqual([]);
      expect(built.nets).toHaveLength(2);
      expect(built.nets.every((n) => n.terminals.length === 2 && n.route?.connected === n.route?.total)).toBe(
        true,
      );
      expect(built.groups[0].hatches.find((h) => h.resource === 'coolant')?.kind).toBe(kind);
      expect(built.groups[0].hatches.find((h) => h.resource === 'feed')?.kind).toBe('fluidIn');
      const bom = requiredBlocks(built.scene!);
      expect(bom.blocks.find((row) => row.blockId === def.hatchBlocks[kind])).toMatchObject({
        count: 1,
        anyTier: false,
      });
      const normalized = validateSiteState(site);
      expect(await decodeSite(await encodeSite(normalized))).toEqual(normalized);
      const plan = { ...defaultPlan(id), colors: { [kind]: '#abcdef' } };
      expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    });
  }
  it('appends new share bits without changing any historical hatch mask', async () => {
    expect(HATCH_KINDS.slice(0, 9)).toEqual([
      'itemIn',
      'itemOut',
      'fluidIn',
      'fluidOut',
      'energy',
      'dynamo',
      'maintenance',
      'muffler',
      'steamIn',
    ]);
    const plan = {
      ...defaultPlan('volcanus'),
      enabledHatches: ['pyrotheumIn' as const],
      colors: { pyrotheumIn: '#aabbcc' },
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
  });
});
