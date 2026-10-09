import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { effectiveSize, resizeSteps, sizedDef } from '../resize';
import { buildGroup, defaultGroupHatches } from '../site/group';
import { unitCells } from '../geometry';
import { withStructureGlass } from './glass';
import { validateResourceHatches, hatchAssignmentKey } from '../site/resourcePlacement';
import { emptySite, siteFromJson, siteToJson } from '../../share/siteCodec';
import { withGroupAdded } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { defaultPlan } from '../../state/store';
import { encodePlan, decodePlan, validatePlanState } from '../../share/codec';

describe('source-segmented RC2 Linear Accelerator', () => {
  const raw = getMultiblock('linear-accelerator')!;
  for (const length of [17, 19, 83, 85, 135])
    it(`builds a complete ${length}-block form with exactly two alternative top interfaces`, () => {
      const def = withStructureGlass(sizedDef(raw, length), 'LuV');
      const key = hatchAssignmentKey(0, 'fluidIn', 'coolant');
      const settings = { voltageTier: 'LV' as const, hatchTiers: { [key]: 'IV' as const } };
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        defaultGroupHatches(def),
        { fluidIn: ['coolant'], fluidOut: ['heated-coolant'] },
        true,
        {},
        settings,
      );
      expect(built.size).toEqual([7, 7, length]);
      expect(built.unplaced).toEqual([]);
      expect(built.missing).toEqual([]);
      expect(built.hatches.find((h) => h.resource === 'coolant')).toMatchObject({ tier: 'IV' });
      const fluid = built.hatches.filter((h) => h.kind === 'fluidIn' || h.kind === 'fluidOut');
      expect(fluid.map((h) => h.cell[2]).sort((a, b) => a - b)).toEqual([7, length - 8]);
      expect(fluid.every((h) => h.cell[0] === 3 && h.cell[1] === 6 && h.face === 'up')).toBe(true);
      const cells = unitCells(def, built.units[0]);
      expect(cells.find((c) => c.blockId === 'gregtech:gt.blockmachines@10503')).toMatchObject({
        local: [3, 3, 0],
        facing: 'north',
      });
      expect(cells.find((c) => c.blockId === 'gregtech:gt.blockmachines@10504')).toMatchObject({
        local: [3, 3, length - 1],
        facing: 'south',
      });
      expect(cells.filter((c) => c.role === 'air')).toHaveLength(length - 2);
      expect(validateMultiblockDef(def)).toEqual([]);
      expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
    });
  for (const kind of ['fluidIn', 'fluidOut'] as const)
    it(`can fill both mandatory interfaces with ${kind} without imposing a false opposite-kind minimum`, () => {
      const def = withStructureGlass(sizedDef(raw, 19), 'LuV');
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        [kind, 'maintenance'],
        {},
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.filter((h) => h.kind === kind)).toHaveLength(2);
      expect(built.hatches.some((h) => h.kind === 'energy')).toBe(false);
      expect(validateResourceHatches(def, built.units, built.hatches)).toEqual([]);
    });
  it('keeps the historical nineteen-block default and validates glass independently of power tier', () => {
    expect(effectiveSize(raw, undefined)).toBe(19);
    expect(sizedDef(raw, undefined).size).toEqual([7, 7, 19]);
    expect(resizeSteps(raw.resize!)).toEqual(Array.from({ length: 60 }, (_, i) => 17 + i * 2));
    expect(raw.requiredHatches?.energy).toEqual({ min: 0, max: 2 });
    expect(raw.glassLimitsEnergy).not.toBe(true);
    const def = withStructureGlass(sizedDef(raw, 19), 'LuV');
    const high = buildGroup(
      def,
      1,
      { x: 1, y: 1, z: 1 },
      def.defaultHatches,
      {},
      true,
      {},
      { voltageTier: 'UHV' },
    );
    expect(validateResourceHatches(def, high.units, high.hatches)).toEqual([]);
    expect(
      validateResourceHatches(sizedDef(raw, 19), high.units, high.hatches).some((e) =>
        e.includes('at least LuV'),
      ),
    ).toBe(true);
    const site = withGroupAdded(emptySite(), raw.id);
    site.groups[0].size = 135;
    expect(siteFromJson(siteToJson(site)).groups[0].size).toBe(135);
    delete site.groups[0].size;
    expect(effectiveSize(raw, siteFromJson(siteToJson(site)).groups[0].size)).toBe(19);
  });
  it('round-trips long plans and keeps a game-invalid length readable with a specific warning', async () => {
    const plan = { ...defaultPlan(raw.id), size: 135 };
    expect((await decodePlan(await encodePlan(plan))).size).toBe(135);
    const site = withGroupAdded(emptySite(), raw.id);
    site.groups[0].size = 136;
    const loaded = siteFromJson(siteToJson(site));
    expect(loaded.groups[0].size).toBe(136);
    expect(
      createSiteBuilder()(loaded, { pipes: false, cables: false, below: true }).warnings.some(
        (w) => w.type === 'error' && w.message.includes('Stored size 136 is not supported by RC2'),
      ),
    ).toBe(true);
    const unavailable = { ...plan, multiblockId: 'unavailable-machine' };
    expect((await decodePlan(await encodePlan(unavailable))).size).toBe(135);
    loaded.groups[0].multiblockId = 'unavailable-machine';
    expect(siteFromJson(siteToJson(loaded)).groups[0].size).toBe(136);
    expect(() => validatePlanState({ ...plan, size: 257 })).toThrow(/from 1 to 256/);
  });
});
