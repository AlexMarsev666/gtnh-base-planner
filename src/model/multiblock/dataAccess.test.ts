import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { BLOCKS } from '../../data/blocks';
import { DATA_ACCESS_HATCHES, hatchTiers } from '../../data/single-machines';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { withPlanAdded, withGroupPatched, withGroupRotated, withGroupDuplicated } from '../../ui/siteActions';
import { buildGroup } from '../site/group';
import { sizedDef } from '../resize';
import { unitCells } from '../geometry';
import { createSiteBuilder } from '../site/build';
import { arrangeSite } from '../site/arrange';
import { optimizeSite } from '../site/optimize';
import { emptySite, encodeSite, decodeSite } from '../../share/siteCodec';
import { encodePlan, decodePlan, HATCH_KINDS, validatePlanState } from '../../share/codec';
import { requiredBlocks } from '../bom';
import { ROUTED_KINDS } from '../routing/kinds';
import { hatchAssignmentKey, validateResourceHatches } from '../site/resourcePlacement';
import { defaultHatchTier } from '../hatches/tiers';
import type { VoltageTier } from '../tiers';

describe('registered optional Data Access', () => {
  it('registers only the three actual RC2 variants and appends a non-routed wire kind', () => {
    expect(DATA_ACCESS_HATCHES.map((v) => [v.meta, v.tier])).toEqual([
      [145, 4],
      [146, 6],
      [147, 8],
    ]);
    expect(hatchTiers('dataAccess')).toEqual(['EV', 'LuV', 'UV']);
    expect(HATCH_KINDS.indexOf('dataAccess')).toBe(11);
    expect(ROUTED_KINDS).not.toContain('dataAccess');
    expect(BLOCKS['gt.hatch.dataAccess.IV']).toBeUndefined();
    expect(BLOCKS['gt.hatch.dataAccess.ZPM']).toBeUndefined();
    expect(BLOCKS['gt.hatch.dataAccess.LuV'].name).toBe('Advanced Data Access Hatch (LuV)');
  });
  for (const id of ['assembly-line', 'advanced-assembly-line']) {
    it(`${id}: remains optional, with one service interface outside FIRST`, () => {
      const def = sizedDef(getMultiblock(id)!, 5);
      const units = [{ id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const }];
      expect(defaultHatchTier(def, 'dataAccess', { voltageTier: 'UHV' })).toBe('EV');
      expect(defaultHatchTier(def, 'dataAccess', {})).toBe('EV');
      const plain = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, true, {}, {});
      expect(validateResourceHatches(def, plain.units, plain.hatches, {})).toEqual([]);
      expect(plain.hatches.some((h) => h.kind === 'dataAccess')).toBe(false);
      const enabled = [...def.defaultHatches, 'dataAccess' as const];
      for (const tier of ['EV', 'LuV', 'UV'] as VoltageTier[]) {
        const settings = { hatchTiers: { [hatchAssignmentKey(0, 'dataAccess')]: tier } };
        const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, settings);
        const data = built.hatches.filter((h) => h.kind === 'dataAccess');
        expect(built.unplaced).toEqual([]);
        expect(data).toHaveLength(1);
        expect(data[0].tier).toBe(tier);
        expect(data[0].cell[0]).toBeLessThan(def.controller.pos[0]);
        expect(validateResourceHatches(def, units, built.hatches, settings)).toEqual([]);
        const invalid = [{ ...data[0], tier: 'IV' as const }];
        expect(
          validateResourceHatches(def, units, invalid, {}).some((e) => e.includes('no IV variant')),
        ).toBe(true);
        const first = { ...data[0], cell: [4, 2, 2] as [number, number, number] };
        expect(
          validateResourceHatches(def, units, [first], {}).some(
            (e) => e.includes('dataAccess') && e.includes('not allowed'),
          ),
        ).toBe(true);
        const extra = unitCells(def, units[0]).find(
          (c) => c.char === 'd' && c.pos.join() !== data[0].cell.join(),
        )!;
        expect(
          validateResourceHatches(def, units, [...built.hatches, { ...data[0], cell: extra.pos }], {}).some(
            (e) => e.includes('dataAccess count 2'),
          ),
        ).toBe(true);
      }
    });
    it(`${id}: preserves service tier through plan/site codecs, rotation, duplication and resize`, async () => {
      const key = hatchAssignmentKey(0, 'dataAccess');
      const plan = {
        ...defaultPlan(id),
        count: 1,
        size: 5,
        enabledHatches: [...getMultiblock(id)!.defaultHatches, 'dataAccess' as const],
        voltageTier: undefined,
        hatchTiers: { [key]: 'UV' as const },
      };
      const pipeline = createPipeline();
      const built = pipeline(plan, false, false, true);
      expect(built.error).toBeNull();
      expect(
        requiredBlocks(built.scene!).blocks.find((b) => b.blockId === 'gt.hatch.dataAccess.UV')?.count,
      ).toBe(1);
      expect(await decodePlan(await encodePlan(plan))).toEqual(validatePlanState(plan));
      const initial = withPlanAdded(emptySite(), plan, [3, 3]);
      const group = initial.groups[0];
      const rotated = withGroupRotated(initial, group.id);
      const resized = withGroupPatched(rotated, group.id, { size: 16 });
      const duplicate = withGroupDuplicated(resized, group.id, [50, 50]);
      const roundtrip = await decodeSite(await encodeSite(duplicate));
      const result = createSiteBuilder()(roundtrip, { pipes: false, cables: false, below: true });
      for (const pg of result.groups)
        expect(pg.hatches.filter((h) => h.kind === 'dataAccess').map((h) => h.tier)).toEqual(['UV']);
      expect(roundtrip.groups.every((g) => g.hatchTiers?.[key] === 'UV')).toBe(true);
      const aligned = arrangeSite(roundtrip, () => [16, 3]);
      const arrangedSite = { ...roundtrip, groups: aligned.groups };
      const optimized = optimizeSite(arrangedSite, createSiteBuilder(), {
        iterations: 20,
        seeds: 1,
        refineSteps: 0,
        budgetMs: 1000,
        below: true,
      });
      const afterSearch = createSiteBuilder()(optimized.site, { pipes: false, cables: false, below: true });
      for (const pg of afterSearch.groups)
        expect(pg.hatches.filter((h) => h.kind === 'dataAccess').map((h) => h.tier)).toEqual(['UV']);
      const defaultTier = pipeline({ ...plan, hatchTiers: undefined }, false, false, true);
      expect(defaultTier.hatches!.hatches.find((h) => h.kind === 'dataAccess')).toMatchObject({
        tier: 'EV',
        assignments: [key],
      });
    });
  }
});
