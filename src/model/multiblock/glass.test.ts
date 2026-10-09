import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { blockInfo } from '../../data/blocks';
import { defaultPlan } from '../../state/store';
import {
  BOROSILICATE_GLASS_TIERS,
  borosilicateTier,
  glassBlockTier,
  minimumGlassTier,
  structureGlassTier,
  withStructureGlass,
} from './glass';
import { REVIEWED_GLASS_ENERGY_RULES } from './structureAdapters';
import { validateResourceHatches } from '../site/resourcePlacement';
import { unitCells } from '../geometry';
import { createPipeline } from '../../ui/pipeline';
import { createSiteBuilder } from '../site/build';
import { requiredBlocks } from '../bom';
import { withGroupAdded, withGroupDuplicated, withGroupPatched, withPlanAdded } from '../../ui/siteActions';
import { withMultiblock } from '../../ui/actions';
import { decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { decodeSite, emptySite, encodeSite, validateSiteState } from '../../share/siteCodec';
import type { VoltageTier } from '../tiers';

describe('selected RC2 structure glass', () => {
  it('provides the eleven actual canonical metas from HV to UXV with registered material names', () => {
    expect(BOROSILICATE_GLASS_TIERS).toEqual([
      'HV',
      'EV',
      'IV',
      'LuV',
      'ZPM',
      'UV',
      'UHV',
      'UEV',
      'UIV',
      'UMV',
      'UXV',
    ]);
    for (const [meta, tier] of BOROSILICATE_GLASS_TIERS.entries()) {
      expect(borosilicateTier(`bartworks:BW_TieredGlass@${meta}`)).toBe(meta + 3);
      expect(blockInfo(`bartworks:BW_TieredGlass@${meta}`).name).toBe(`Borosilicate Glass (${tier})`);
    }
  });
  for (const id of Object.keys(REVIEWED_GLASS_ENERGY_RULES)) {
    it(`${id}: upgrades only glass cells, raises the energy limit and rejects a higher hatch`, () => {
      const original = getMultiblock(id)!;
      const before = JSON.stringify(original);
      const def = withStructureGlass(original, 'IV');
      expect(withStructureGlass(original, 'IV')).toBe(def);
      expect(def.size).toEqual(original.size);
      expect(def.layers).toBe(original.layers);
      for (const [char, cell] of Object.entries(original.legend)) {
        if (glassBlockTier(cell.blockId) !== undefined)
          expect(def.legend[char].blockId).toBe('bartworks:BW_TieredGlass@2');
        else expect(def.legend[char]).toBe(cell);
      }
      const unit = { id: 17, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const };
      const slot = unitCells(def, unit).find((c) => c.hatches?.includes('energy'))!;
      const input = {
        kind: 'energy' as const,
        cell: slot.pos,
        face: 'north' as const,
        unitIds: [17],
        tier: 'IV' as VoltageTier,
      };
      const errors = (tier: VoltageTier) =>
        validateResourceHatches(def, [unit], [{ ...input, tier }], { structureGlassTier: 'IV' }).filter((e) =>
          e.includes('structure glass tier'),
        );
      expect(errors('IV')).toEqual([]);
      expect(errors('LuV')).toHaveLength(1);
      expect(errors('LuV')[0]).toContain('structure glass tier IV');
      expect(JSON.stringify(original)).toBe(before);
    });
  }
  it('invalidates machine and worker caches, updates material lists, and retains individual hatch assignments', () => {
    const plan = { ...defaultPlan('algae-farm'), count: 1, voltageTier: 'EV' as const };
    const run = createPipeline();
    const old = run(plan, false);
    expect(old.error).toContain('structure glass tier HV');
    const selected = { ...plan, structureGlassTier: 'EV' as const };
    const good = run(selected, false);
    expect(good.error).toBeNull();
    expect(good.hatches?.hatches.map((h) => h.assignments)).toEqual(
      old.hatches?.hatches.map((h) => h.assignments),
    );
    expect(requiredBlocks(good.scene!).blocks.some((b) => b.blockId === 'bartworks:BW_TieredGlass@1')).toBe(
      true,
    );
    expect(requiredBlocks(good.scene!).blocks.some((b) => b.blockId === 'bartworks:BW_TieredGlass@0')).toBe(
      false,
    );
    const site = withPlanAdded(emptySite(), selected);
    const build = createSiteBuilder();
    expect(build(site, { pipes: false, cables: false }).warnings).toEqual([]);
    const lowered = withGroupPatched(site, site.groups[0].id, { structureGlassTier: 'HV' });
    expect(
      build(lowered, { pipes: false, cables: false }).warnings.some(
        (w) => w.type === 'error' && w.message.includes('structure glass tier HV'),
      ),
    ).toBe(true);
    expect(site.groups[0].structureGlassTier).toBe('EV');
  });
  it('preserves glass selection in machine/site links and duplication, and keeps unsupported saved settings visible', async () => {
    const plan = { ...defaultPlan('algae-farm'), structureGlassTier: 'UMV' as const };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    const site = withPlanAdded(emptySite(), plan);
    expect(await decodeSite(await encodeSite(site))).toEqual(validateSiteState(site));
    expect(withGroupDuplicated(site, site.groups[0].id, [20, 20]).groups[1].structureGlassTier).toBe('UMV');
    const unsupported = validatePlanState({ ...plan, structureGlassTier: 'MAX' });
    const snapshot = JSON.stringify(unsupported);
    expect(createPipeline()(unsupported, false).error).toContain(
      'Selected structure glass tier MAX is not supported',
    );
    expect(JSON.stringify(unsupported)).toBe(snapshot);
    expect(() => validatePlanState({ ...plan, structureGlassTier: 'new-tier' })).toThrow(
      'Invalid structure glass tier',
    );
    expect(withStructureGlass(getMultiblock('electric-blast-furnace')!, 'IV')).toBe(
      getMultiblock('electric-blast-furnace'),
    );
  });
});

describe('RC2 minimum glass without an energy cap', () => {
  // Independent checkMachine constants, rather than expectations read from the adapter registry.
  for (const [id, minimum] of [
    ['component-assembly-line', 'UV'],
    ['precise-auto-assembler-mt-3662', 'EV'],
    ['target-chamber', 'LuV'],
    ['tfft', 'EV'],
  ] as const) {
    it(`${id}: defaults to the required glass and permits higher standard energy`, () => {
      const def = getMultiblock(id)!;
      expect(minimumGlassTier(def)).toBe(minimum);
      expect(def.glassLimitsEnergy).toBeUndefined();
      const plan = { ...defaultPlan(id), count: 1, voltageTier: 'UHV' as const };
      expect(plan.structureGlassTier).toBe(minimum);
      const run = createPipeline();
      expect(run(plan, false).error).toBeNull();
      expect(run({ ...plan, structureGlassTier: 'HV' }, false).error).toContain(
        `structure glass tier HV; RC2 requires at least ${minimum}`,
      );
      const selected = withStructureGlass(def, minimum);
      expect(structureGlassTier(selected)).toBe(minimum);
      expect(selected.hatchTierLimits?.energy?.max).toBeUndefined();
      const group = withGroupAdded(emptySite(), id).groups[0];
      expect(group.structureGlassTier).toBe(minimum);
      expect(withMultiblock(defaultPlan(), id).structureGlassTier).toBe(minimum);
      const initial = withGroupAdded(emptySite(), 'algae-farm');
      expect(
        withGroupPatched(initial, initial.groups[0].id, { multiblockId: id }).groups[0].structureGlassTier,
      ).toBe(minimum);
    });

    it(`${id}: retains legacy glass through decoding, transfer and duplication with a precise error`, async () => {
      const old = { ...defaultPlan(id), count: 1 };
      delete old.structureGlassTier;
      const loaded = validatePlanState(JSON.parse(JSON.stringify(old)));
      expect(loaded.structureGlassTier).toBeUndefined();
      expect(await decodePlan(await encodePlan(loaded))).toEqual(loaded);
      const site = withPlanAdded(emptySite(), loaded);
      expect(site.groups[0].structureGlassTier).toBeUndefined();
      const copy = withGroupDuplicated(site, site.groups[0].id, [100, 100]);
      expect(copy.groups[1].structureGlassTier).toBeUndefined();
      const saved = JSON.stringify(copy);
      const warnings = createSiteBuilder()(copy, { pipes: false, cables: false }).warnings;
      expect(
        warnings.filter((w) => w.type === 'error' && w.message.includes(`RC2 requires at least ${minimum}`)),
      ).toHaveLength(2);
      expect(JSON.stringify(copy)).toBe(saved);
      expect(withMultiblock(defaultPlan(id), 'algae-farm').structureGlassTier).toBeUndefined();
    });
  }

  it('TFFT skips the minimum only for zero-cost T10 fields, including mixed and unused legend cases', () => {
    const def = getMultiblock('tfft')!;
    const legend = Object.fromEntries(
      Object.entries(def.legend).map(([char, cell]) => [
        char,
        /^kekztech:kekztech_tfftstoragefield_block@[1-9]$/.test(cell.blockId)
          ? { ...cell, blockId: 'kekztech:kekztech_tfftstoragefield_block@10' }
          : cell,
      ]),
    );
    const zeroCost = { ...def, legend };
    expect(minimumGlassTier(zeroCost)).toBeUndefined();
    const unit = { id: 1, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const };
    const errors = (candidate: typeof def) =>
      validateResourceHatches(candidate, [unit], []).filter((e) => e.includes('structure glass tier'));
    expect(errors(zeroCost)).toEqual([]);
    const storage = Object.keys(legend).find((char) =>
      legend[char].blockId.endsWith('storagefield_block@10'),
    )!;
    const mixed = {
      ...zeroCost,
      legend: {
        ...legend,
        [storage]: { ...legend[storage], blockId: 'kekztech:kekztech_tfftstoragefield_block@9' },
      },
    };
    expect(minimumGlassTier(mixed)).toBe('EV');
    expect(errors(mixed)).toHaveLength(1);
    const unused = {
      ...zeroCost,
      legend: { ...legend, unused: { blockId: 'kekztech:kekztech_tfftstoragefield_block@1' } },
    };
    expect(minimumGlassTier(unused)).toBeUndefined();
  });
});
