import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { unitCells } from '../geometry';
import { sizedDef } from '../resize';
import { buildGroup } from '../site/group';
import { withAssemblyGrowth } from './circuitAssemblyLine';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { decodeSite, encodeSite, emptySite, validateSiteState } from '../../share/siteCodec';
import { withGroupDuplicated, withGroupPatched, withGroupRotated, withPlanAdded } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { arrangeSite } from '../site/arrange';
import { optimizeSite } from '../site/optimize';
import { hatchAssignmentKey } from '../hatches/assignments';

describe('pinned Circuit Assembly Line', () => {
  const raw = getMultiblock('circuit-assembly-line')!;
  it('does not reflect prepared definition copies twice, and can restore the original direction', () => {
    const left = sizedDef(raw, 7);
    const right = withAssemblyGrowth(left, 'right');
    expect(withAssemblyGrowth({ ...right }, 'right').layers).toEqual(right.layers);
    expect(withAssemblyGrowth({ ...right }, 'left').layers).toEqual(left.layers);
    expect(withAssemblyGrowth({ ...right }, 'left').minimumStructureGlassTier).toBe('EV');
  });
  for (const growth of ['left', 'right'] as const)
    for (let length = 2; length <= 7; length++)
      it(`${growth} length ${length}: complete terminal bus, mandatory first input and one energy hatch`, () => {
        const def = withAssemblyGrowth(sizedDef(raw, length), growth);
        const built = buildGroup(
          def,
          1,
          { x: 1, y: 1, z: 1 },
          raw.defaultHatches,
          {},
          true,
          {},
          { voltageTier: 'LV', assemblyGrowth: growth },
        );
        expect(built.unplaced).toEqual([]);
        expect(built.hatches.filter((h) => h.kind === 'itemOut')).toHaveLength(1);
        expect(built.hatches.filter((h) => h.kind === 'energy')).toHaveLength(1);
        const input = built.hatches.find((h) => h.kind === 'itemIn')!;
        const output = built.hatches.find((h) => h.kind === 'itemOut')!;
        const cells = unitCells(built.def, built.units[0]);
        expect(cells.find((c) => c.pos.join() === input.cell.join())?.char).toBe('i');
        expect(cells.find((c) => c.pos.join() === output.cell.join())?.char).toBe('o');
        expect(Math.abs(output.cell[0] - input.cell[0])).toBe(length - 1);
        expect(built.def.controller.pos[0]).toBe(growth === 'left' ? length - 1 : 0);
      });
  it('preserves legacy glass and implicit length, with an error only on the source branch that checks EV', () => {
    expect(raw.resize?.default).toBe(2);
    const plan = { ...defaultPlan(raw.id), count: 1 };
    expect(plan.structureGlassTier).toBe('EV');
    const pipeline = createPipeline();
    expect(pipeline(plan, false, false, true).error).toBeNull();
    const legacy = { ...plan, structureGlassTier: undefined };
    expect(pipeline(legacy, false, false, true).error).toContain('EV');
    expect(pipeline({ ...legacy, assemblyGrowth: 'right' }, false, false, true).error).toBeNull();
    expect(pipeline({ ...legacy, assemblyGrowth: 'left' }, false, false, true).error).toContain('EV');
    expect(legacy.structureGlassTier).toBeUndefined();
  });
  it('keeps direction in files/links, transfer, rotation, duplication, arrangement and optimizer caches', async () => {
    const plan = {
      ...defaultPlan(raw.id),
      count: 1,
      size: 7,
      assemblyGrowth: 'right' as const,
      hatchTiers: { [hatchAssignmentKey(0, 'itemOut')]: 'MV' as const },
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(validatePlanState(plan));
    let site = withPlanAdded(emptySite(), plan, [2, 2]);
    const id = site.groups[0].id;
    site = withGroupDuplicated(withGroupRotated(site, id), id, [15, 15]);
    const restored = await decodeSite(await encodeSite(site));
    expect(restored.groups.map((g) => g.assemblyGrowth)).toEqual(['right', 'right']);
    const builder = createSiteBuilder();
    const off = withGroupPatched(restored, id, { assemblyGrowth: 'left' });
    expect(
      builder(restored, { pipes: false, cables: false, below: true }).groups[0].def?.controller.pos[0],
    ).toBe(0);
    expect(builder(off, { pipes: false, cables: false, below: true }).groups[0].def?.controller.pos[0]).toBe(
      6,
    );
    for (const state of [restored, off])
      expect(
        builder(state, { pipes: false, cables: false, below: true }).groups[0].hatches.find(
          (h) => h.kind === 'itemOut',
        )?.tier,
      ).toBe('MV');
    const aligned = { ...restored, groups: arrangeSite(restored, () => [7, 3]).groups };
    expect(
      optimizeSite(aligned, builder, {
        budgetMs: 1000,
        iterations: 20,
        seeds: 1,
        refineSteps: 0,
      }).site.groups.map((g) => g.assemblyGrowth),
    ).toEqual(['right', 'right']);
    for (const invalid of [true, 1, null, 'up']) {
      expect(() => validatePlanState({ ...plan, assemblyGrowth: invalid })).toThrow(/growth direction/);
      expect(() =>
        validateSiteState({
          ...restored,
          groups: restored.groups.map((g) => ({ ...g, assemblyGrowth: invalid })),
        }),
      ).toThrow(/growth direction/);
    }
  });
});
