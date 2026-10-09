import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { ARC_ELECTRODES, ARC_HATCHES } from './arcFurnace';
import { buildGroup } from '../site/group';
import { placeHatches } from '../hatches/placement';
import { hatchKindFor } from '../site/demand';
import { validateResourceHatches } from '../site/resourcePlacement';
import { validateAlternativeCounts } from './rules';
import { rotateDir, toWorld } from '../geometry';
import { supportsHatchTier } from '../hatches/tiers';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { requiredBlocks, ioClass } from '../bom';
import { HATCH_KINDS, decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { emptySite, decodeSite, encodeSite } from '../../share/siteCodec';
import { withPlanAdded, withGroupDuplicated, withGroupRotated } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { hatchAssignmentKey } from '../hatches/assignments';
import type { HatchKind, Unit } from './types';
import { hatchOrder } from './hatchOrder';

describe('RC2 Industrial Arc Furnace electrode adders', () => {
  const def = getMultiblock('industrial-arc-furnace')!;
  it('keeps historical kind bits and concrete fixed IV registrations', () => {
    expect(HATCH_KINDS.slice(16, 19)).toEqual(['electrodeIn', 'electrodeBus', 'electrodeDetector']);
    expect(ARC_HATCHES.electrode).toMatchObject({ meta: 14203, tier: 'IV' });
    expect(ARC_HATCHES.detector).toMatchObject({ meta: 14204, tier: 'IV' });
    expect(validateMultiblockDef(def)).toEqual([]);
    expect(def.requiredHatches?.electrodeIn).toEqual({ min: 1, max: 1 });
    expect(def.requiredHatches?.electrodeBus?.max).toBeUndefined();
    expect(def.requiredHatches?.maintenance?.max).toBeUndefined();
    for (const kind of ['electrodeIn', 'electrodeBus', 'electrodeDetector'] as HatchKind[])
      expect(supportsHatchTier(def, kind)).toBe(false);
    expect(ioClass('electrodeIn')).toBe('item');
    expect(ioClass('electrodeBus')).toBe('item');
    expect(ioClass('electrodeDetector')).toBeNull();
  });
  it('binds all fourteen exact item IDs and requires an explicit choice for unknown inputs', () => {
    const item = { kind: 'item' as const, name: 'Graphite electrode', color: '#abcdef' };
    expect(ARC_ELECTRODES).toHaveLength(14);
    expect(hatchKindFor('in', 'electrode', item, def)).toBeNull();
    for (const { gameId } of ARC_ELECTRODES) {
      expect(hatchKindFor('in', 'input', { ...item, gameId }, def)).toBe('electrodeIn');
      expect(
        hatchKindFor('in', 'input', { ...item, gameId }, def, [{ resource: 'input', kind: 'electrodeBus' }]),
      ).toBe('electrodeBus');
      expect(
        hatchKindFor('in', 'input', { ...item, gameId }, def, [{ resource: 'input', kind: 'itemIn' }]),
      ).toBe('itemIn');
    }
    for (const gameId of [
      'minecraft:stone@0',
      'kubatech:arc_furnace_electrode@14',
      'kubatech:arc_furnace_electrode@-1',
    ]) {
      expect(hatchKindFor('in', 'input', { ...item, gameId }, def)).toBe('itemIn');
      expect(
        hatchKindFor('in', 'input', { ...item, gameId }, def, [{ resource: 'input', kind: 'electrodeIn' }]),
      ).toBeNull();
    }
    expect(hatchKindFor('in', 'input', item, def, [{ resource: 'input', kind: 'electrodeIn' }])).toBe(
      'electrodeIn',
    );
    expect(hatchKindFor('in', 'input', item, def, [{ resource: 'input', kind: 'itemIn' }])).toBe('itemIn');
  });
  it('counts additional physical electrode hatches as inputs, while the dedicated hatch alone is insufficient', () => {
    const enabled: HatchKind[] = ['energy', 'maintenance', 'itemOut', 'electrodeIn', 'electrodeBus'];
    const built = buildGroup(
      def,
      1,
      { x: 1, y: 1, z: 1 },
      enabled,
      { electrodeBus: ['reserve1', 'reserve2'] },
      true,
      {},
      { voltageTier: 'LV' },
    );
    expect(built.unplaced).toEqual([]);
    expect(built.missing).toEqual([]);
    expect(built.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(0);
    expect(built.hatches.filter((h) => h.kind === 'electrodeBus')).toHaveLength(2);
    expect(validateAlternativeCounts(built.def, built.units, built.hatches)).toEqual([]);
    expect(
      validateAlternativeCounts(
        built.def,
        built.units,
        built.hatches.filter((h) => h.kind !== 'electrodeBus'),
      ),
    ).toEqual([expect.stringContaining('checkHasAnyInput')]);
  });
  it('checks source order for every controller of a shared physical hatch', () => {
    const ordered = {
      ...def,
      size: [3, 1, 1] as [number, number, number],
      orderedHatchKinds: [
        {
          first: 'electrodeIn' as const,
          later: 'electrodeBus' as const,
          order: [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
          ] as [number, number, number][],
        },
      ],
    };
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [0, 0, 0], rotation: 2 },
    ];
    const primary = [
      {
        kind: 'electrodeIn' as const,
        cell: [0, 0, 0] as [number, number, number],
        unitIds: [0],
        face: 'north' as const,
      },
      {
        kind: 'electrodeIn' as const,
        cell: [2, 0, 0] as [number, number, number],
        unitIds: [1],
        face: 'south' as const,
      },
    ];
    const order = hatchOrder(ordered, units);
    expect(order.accepts('electrodeBus', [1, 0, 0], [0, 1], primary)).toBe(true);
    expect(
      order.accepts('electrodeBus', [1, 0, 0], [0, 1], [primary[0], { ...primary[1], cell: [0, 0, 0] }]),
    ).toBe(false);
    expect(order.accepts('electrodeBus', [1, 0, 0], [2], primary)).toBe(false);
  });
  it('preserves source order on both placement paths and every rotation, and rejects switched resource positions', () => {
    const enabled = [...def.defaultHatches, 'electrodeBus', 'electrodeDetector'] as HatchKind[];
    const built = buildGroup(
      def,
      1,
      { x: 1, y: 1, z: 1 },
      enabled,
      { electrodeIn: ['working'], electrodeBus: ['spare1', 'spare2'] },
      true,
      {},
      { voltageTier: 'IV' },
    );
    expect(built.unplaced).toEqual([]);
    expect(validateResourceHatches(built.def, built.units, built.hatches)).toEqual([]);
    const working = built.hatches.find((h) => h.kind === 'electrodeIn')!;
    const spare = built.hatches.find((h) => h.kind === 'electrodeBus')!;
    const switched = built.hatches.map((h) =>
      h === working ? { ...h, cell: spare.cell } : h === spare ? { ...h, cell: working.cell } : h,
    );
    expect(validateResourceHatches(built.def, built.units, switched)).toContainEqual(
      expect.stringContaining('source order'),
    );
    for (const rotation of [0, 1, 2, 3] as const) {
      const unit: Unit = { id: 0, origin: [20, 8, 30], rotation };
      const hatches = placeHatches(def, [unit], enabled, undefined, { below: true }).hatches;
      expect(validateResourceHatches(def, [unit], hatches)).toEqual([]);
      const transformed = built.hatches.map((h) => ({
        ...h,
        cell: toWorld(def, unit, h.cell),
        face: rotateDir(h.face, rotation),
      }));
      expect(validateResourceHatches(def, [unit], transformed)).toEqual([]);
    }
  });
  it('reports an old plan missing its dedicated hatch without silently altering historical choices', async () => {
    const plan = {
      ...defaultPlan(def.id),
      count: 1,
      enabledHatches: def.defaultHatches.filter((k) => k !== 'electrodeIn'),
    };
    const restored = await decodePlan(await encodePlan(validatePlanState(plan)));
    expect(restored.enabledHatches).toEqual(plan.enabledHatches);
    expect(createPipeline()(restored, false, false, true).error).toContain('electrodeIn');
    const complete = createPipeline()(
      {
        ...defaultPlan(def.id),
        count: 1,
        enabledHatches: [...def.defaultHatches, 'electrodeBus', 'electrodeDetector'],
      },
      false,
      false,
      true,
    );
    expect(complete.error).toBeNull();
    const bom = requiredBlocks(complete.scene!);
    expect(bom.blocks.find((b) => b.blockId === 'gregtech:gt.blockmachines@14203')).toMatchObject({
      count: 2,
      anyTier: false,
    });
    expect(bom.blocks.find((b) => b.blockId === 'gregtech:gt.blockmachines@14204')).toMatchObject({
      count: 1,
      anyTier: false,
    });
  });
  it('retains manual item roles, ordinary bus tiers and links across codecs, rotations and duplication', async () => {
    let site = withPlanAdded(emptySite(), { ...defaultPlan(def.id), count: 1, voltageTier: 'LV' }, [8, 8]);
    site.size = [64, 64];
    const id = site.groups[0].id;
    site.groups[0].resourceBindings = [
      { kind: 'electrodeIn', resource: 'working' },
      { kind: 'electrodeBus', resource: 'reserve' },
      { kind: 'itemIn', resource: 'ore' },
    ];
    site.groups[0].hatchTiers = { [hatchAssignmentKey(0, 'itemIn', 'ore')]: 'MV' };
    site.resources = Object.fromEntries(
      ['working', 'reserve', 'ore'].map((key) => [key, { kind: 'item', name: key, color: '#abcdef' }]),
    );
    site.ports = ['working', 'reserve', 'ore'].map((resource, i) => ({
      id: resource,
      dir: 'in',
      resource,
      pos: [0, 6 + i * 6],
    }));
    site.links = ['working', 'reserve', 'ore'].map((resource) => ({
      id: resource,
      resource,
      from: { port: resource },
      to: { group: id },
    }));
    for (let n = 0; n < 4; n++) {
      site = await decodeSite(await encodeSite(withGroupRotated(site, id)));
      const built = createSiteBuilder()(site, { pipes: true, cables: false, below: true });
      expect(built.warnings).toEqual([]);
      expect(built.groups[0].hatches.find((h) => h.kind === 'electrodeIn')?.resource).toBe('working');
      expect(built.groups[0].hatches.find((h) => h.kind === 'electrodeBus')?.resource).toBe('reserve');
      expect(built.groups[0].hatches.find((h) => h.kind === 'itemIn')?.tier).toBe('MV');
    }
    const duplicate = withGroupDuplicated(site, id, [34, 8]).groups[1];
    expect(duplicate.resourceBindings).toEqual(site.groups[0].resourceBindings);
    expect(duplicate.hatchTiers).toEqual(site.groups[0].hatchTiers);
    expect(site.links.map((l) => l.id)).toEqual(['working', 'reserve', 'ore']);
  });
});
