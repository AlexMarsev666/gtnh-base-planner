import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { DATA_INTERFACES, DATA_INPUT_KINDS, DATA_OUTPUT_KINDS } from './dataInterfaces';
import { buildGroup } from '../site/group';
import { validateResourceHatches } from '../site/resourcePlacement';
import { validateAlternativeCounts, withRequiredAlternatives } from './rules';
import { unitCells } from '../geometry';
import { placeHatches } from '../hatches/placement';
import { sizedDef } from '../resize';
import { HATCH_KINDS, encodePlan, decodePlan, validatePlanState } from '../../share/codec';
import { BLOCKS } from '../../data/blocks';
import { requiredBlocks } from '../bom';
import type { HatchKind } from './types';
import { emptySite, encodeSite, decodeSite, validateSiteState } from '../../share/siteCodec';
import { withPlanAdded, withGroupPatched, withGroupDuplicated, withGroupRotated } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { arrangeSite } from '../site/arrange';
import { optimizeSite } from '../site/optimize';

describe('RC2 Data Bank and recipe-data interfaces', () => {
  const def = getMultiblock('data-bank')!;
  it('uses the four concrete registrations, including actual UEV wireless tiers', () => {
    expect(Object.values(DATA_INTERFACES).map(({ meta, tier }) => [meta, tier])).toEqual([
      [15442, 7],
      [15443, 7],
      [15446, 10],
      [15447, 10],
    ]);
    expect(HATCH_KINDS.slice(12, 16)).toEqual([
      'assemblyDataIn',
      'assemblyDataOut',
      'wirelessAssemblyDataIn',
      'wirelessAssemblyDataOut',
    ]);
    expect(HATCH_KINDS).toHaveLength(25);
    expect(BLOCKS['gregtech:gt.blockmachines@15447'].name).toContain('(UEV)');
  });
  it('keeps the three core computer casings fixed, with data only on D and power only on C', () => {
    const cells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 });
    expect(cells.filter((c) => c.char === 'A')).toHaveLength(3);
    expect(cells.filter((c) => c.char === 'D')).toHaveLength(15);
    expect(def.legend.A.hatches).toBeUndefined();
    expect(def.legend.C.hatches).toEqual(['energy', 'dynamo', 'maintenance']);
    expect(def.legend.D.hatches).toEqual([...DATA_INPUT_KINDS, ...DATA_OUTPUT_KINDS]);
    expect(def.requiredHatches?.dynamo?.min ?? 0).toBe(0);
    expect(def.requiredHatches?.energy?.min).toBe(1);
  });
  for (const input of DATA_INPUT_KINDS)
    for (const output of DATA_OUTPUT_KINDS)
      it(`accepts ${input} and ${output} without injecting other alternatives`, () => {
        const enabled: HatchKind[] = ['energy', 'maintenance', input, output];
        const settings = { dataBankWireless: output === 'wirelessAssemblyDataOut' };
        const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, settings);
        expect(built.unplaced).toEqual([]);
        expect(built.hatches.map((h) => h.kind).sort()).toEqual([...enabled].sort());
        expect(validateResourceHatches(built.def, built.units, built.hatches, settings)).toEqual([]);
        expect(validateAlternativeCounts(built.def, built.units, built.hatches)).toEqual([]);
        for (const missing of [input, output, 'energy', 'maintenance'] as HatchKind[]) {
          const remaining = built.hatches.filter((h) => h.kind !== missing);
          expect([
            ...validateResourceHatches(built.def, built.units, remaining, {}),
            ...validateAlternativeCounts(built.def, built.units, remaining),
          ]).not.toEqual([]);
        }
        for (const char of ['A', 'C']) {
          const forbidden = unitCells(built.def, built.units[0]).find((c) => c.char === char)!;
          const service = built.hatches.find((h) => h.kind === input)!;
          expect(
            validateResourceHatches(built.def, built.units, [{ ...service, cell: forbidden.pos }], {}).some(
              (e) => e.includes('not allowed'),
            ),
          ).toBe(true);
        }
      });
  it('preserves service choices through files/links and lists concrete materials', async () => {
    const plan = {
      ...defaultPlan(def.id),
      count: 1,
      dataBankWireless: true,
      enabledHatches: [
        'energy',
        'maintenance',
        'wirelessAssemblyDataIn',
        'wirelessAssemblyDataOut',
      ] as HatchKind[],
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(validatePlanState(plan));
    const result = createPipeline()(plan, false, false, true);
    expect(result.error).toBeNull();
    const pipeline = createPipeline();
    expect(pipeline({ ...plan, dataBankWireless: false }, false, false, true).error).toContain(
      'wireless recipe transmission is disabled',
    );
    expect(pipeline(plan, false, false, true).error).toBeNull();
    for (const invalid of [1, 'yes', null])
      expect(() => validatePlanState({ ...plan, dataBankWireless: invalid })).toThrow(/wireless setting/);
    const bom = requiredBlocks(result.scene!);
    for (const meta of [15446, 15447])
      expect(bom.blocks.find((b) => b.blockId === `gregtech:gt.blockmachines@${meta}`)?.count).toBe(1);
    const old = {
      ...plan,
      enabledHatches: ['energy', 'dynamo', 'maintenance'] as HatchKind[],
      voltageTier: undefined,
    };
    expect(createPipeline()(old, false, false, true).error).toContain('dataAccess or assemblyDataIn');
    expect(old.enabledHatches).toEqual(['energy', 'dynamo', 'maintenance']);
  });
  it('keeps controller mode through transfer, site codecs, editing, arrangement and optimizer caches', async () => {
    const plan = {
      ...defaultPlan(def.id),
      count: 1,
      dataBankWireless: true,
      enabledHatches: ['energy', 'maintenance', 'dataAccess', 'wirelessAssemblyDataOut'] as HatchKind[],
    };
    let site = withPlanAdded(emptySite(), plan, [3, 3]);
    const id = site.groups[0].id;
    site = withGroupDuplicated(withGroupRotated(site, id), id, [15, 15]);
    const restored = await decodeSite(await encodeSite(site));
    expect(restored.groups.map((g) => g.dataBankWireless)).toEqual([true, true]);
    const builder = createSiteBuilder();
    expect(
      builder(restored, { pipes: false, cables: false, below: true }).warnings.some(
        (w) => 'message' in w && w.message.includes('wireless recipe transmission is disabled'),
      ),
    ).toBe(false);
    const off = withGroupPatched(restored, id, { dataBankWireless: false });
    expect(
      builder(off, { pipes: false, cables: false, below: true }).warnings.some(
        (w) => 'message' in w && w.message.includes('wireless recipe transmission is disabled'),
      ),
    ).toBe(true);
    expect((await decodeSite(await encodeSite(off))).groups.find((g) => g.id === id)?.dataBankWireless).toBe(
      false,
    );
    const aligned = { ...restored, groups: arrangeSite(restored, () => [5, 3]).groups };
    const optimized = optimizeSite(aligned, builder, {
      budgetMs: 1000,
      iterations: 20,
      seeds: 1,
      refineSteps: 0,
    });
    expect(optimized.site.groups.map((g) => g.dataBankWireless)).toEqual([true, true]);
    for (const invalid of [1, 'true', null])
      expect(() =>
        validateSiteState({
          ...restored,
          groups: restored.groups.map((g) => ({ ...g, dataBankWireless: invalid })),
        }),
      ).toThrow(/wireless setting/);
  });
  for (const id of ['assembly-line', 'advanced-assembly-line']) {
    it(`${id}: no optional data filler, and a combined maximum of one across all receivers`, () => {
      const line = sizedDef(getMultiblock(id)!, 5);
      const enabled = [...line.defaultHatches];
      withRequiredAlternatives(line, enabled);
      expect(enabled.some((k) => DATA_INPUT_KINDS.includes(k))).toBe(false);
      const units = [{ id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const }];
      for (const input of DATA_INPUT_KINDS) {
        const built = placeHatches(line, units, [...line.defaultHatches, input], undefined, { below: true });
        expect(built.unplaced).toEqual([]);
        expect(built.hatches.filter((h) => DATA_INPUT_KINDS.includes(h.kind))).toHaveLength(1);
        expect(validateAlternativeCounts(line, units, built.hatches)).toEqual([]);
      }
      const kinds = [...line.defaultHatches, 'dataAccess', 'assemblyDataIn'] as HatchKind[];
      const classic = placeHatches(line, units, kinds, undefined, { below: true });
      const joint = buildGroup(line, 1, { x: 1, y: 1, z: 1 }, kinds, {}, true, {}, {});
      for (const built of [classic, joint]) {
        expect(built.hatches.filter((h) => DATA_INPUT_KINDS.includes(h.kind))).toHaveLength(1);
        expect(built.unplaced).toHaveLength(1);
        expect(validateAlternativeCounts(line, units, built.hatches)).toEqual([]);
        const two = [
          ...built.hatches,
          {
            ...built.hatches.find((h) => DATA_INPUT_KINDS.includes(h.kind))!,
            kind: 'assemblyDataIn' as const,
          },
        ];
        expect(validateAlternativeCounts(line, units, two).some((e) => e.includes('count 2'))).toBe(true);
      }
    });
  }
});
