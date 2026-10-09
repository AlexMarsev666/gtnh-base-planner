import { describe, expect, it } from 'vitest';
import { defaultPlan } from '../state/store';
import { createPipeline } from './pipeline';
import { withIndividualHatchTier, withVoltageTier } from './actions';
import { decodePlan, encodePlan, validatePlanState } from '../share/codec';
import { planFromJson, planToJson } from '../share/persist';
import { hatchKey } from './pipelineKeys';

describe('machine plan voltage and individual hatch tiers', () => {
  it('loads a legacy plan with disabled mandatory interfaces and reports concrete RC2 errors without replacing it', () => {
    const plan = { ...defaultPlan('vacuum-freezer'), count: 1, enabledHatches: [] };
    delete plan.voltageTier;
    const loaded = planFromJson(JSON.stringify(plan));
    expect(loaded.enabledHatches).toEqual([]);
    const built = createPipeline()(loaded, false);
    expect(built.scene).not.toBeNull();
    expect(built.error).toContain('itemIn or fluidIn count 0');
    expect(built.error).toContain('energy count 0');
    expect(loaded).toEqual(plan);
  });
  it('retains unspecified voltage in historical JSON and roundtrips new fields in files and links', async () => {
    const legacy = { ...defaultPlan('vacuum-freezer') };
    delete legacy.voltageTier;
    expect(planFromJson(JSON.stringify(legacy)).voltageTier).toBeUndefined();
    const plan = withIndividualHatchTier(withVoltageTier(legacy, 'HV'), ['[42,"itemIn",null,0]'], 'MV');
    expect(planFromJson(planToJson(plan))).toEqual(plan);
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    expect(() => validatePlanState({ ...plan, hatchTiers: JSON.parse('{"__proto__":"LV"}') })).toThrow(
      'Invalid hatch tier',
    );
  });

  it('updates all assignments of a shared hatch immutably and keys the pipeline on these changes', () => {
    const plan = defaultPlan('vacuum-freezer');
    const next = withIndividualHatchTier(plan, ['a', 'b'], 'MV');
    expect(next.hatchTiers).toEqual({ a: 'MV', b: 'MV' });
    expect(plan.hatchTiers).toBeUndefined();
    expect(withIndividualHatchTier(next, ['a', 'b'], '').hatchTiers).toEqual({});
    expect(hatchKey('layout', ['itemIn'], null, false, plan)).not.toBe(
      hatchKey('layout', ['itemIn'], null, false, next),
    );
  });

  it('uses concrete hatch tiers in the scene and bill of materials and preserves logical overrides after rotation', () => {
    const pipeline = createPipeline();
    const plan = {
      ...defaultPlan('vacuum-freezer'),
      count: 1,
      manualUnits: [{ id: 42, origin: [0, 0, 0] as const, rotation: 0 as const }],
    };
    const built = pipeline(plan, false);
    expect(built.error).toBeNull();
    const input = built.hatches!.hatches.find((h) => h.kind === 'itemIn')!;
    expect(input.tier).toBe('LV');
    const override = withIndividualHatchTier(plan, input.assignments!, 'MV');
    const next = pipeline(
      { ...override, manualUnits: [{ ...plan.manualUnits[0], origin: [10, 3, 9], rotation: 1 }] },
      false,
    );
    expect(next.error).toBeNull();
    const changed = next.hatches!.hatches.find((h) => h.kind === 'itemIn')!;
    expect(changed.tier).toBe('MV');
    expect(changed.assignments).toEqual(input.assignments);
    expect(next.scene!.voxels.find((v) => v.hatchKind === 'itemIn')!.blockId).toBe('gt.hatch.inputBus.MV');
    expect(next.stats!.byBlock['gt.hatch.inputBus.MV']).toBe(1);
    expect(next.stats!.byBlock['gt.hatch.inputBus.LV']).toBeUndefined();
  });

  it('splits shared physical hatches whose logical assignments have different tiers', () => {
    const plan = { ...defaultPlan('vacuum-freezer'), count: 2 };
    const pipeline = createPipeline();
    const initial = pipeline(plan, false);
    const shared = initial.hatches!.hatches.find((h) => h.kind === 'itemIn' && h.unitIds.length > 1)!;
    expect(shared).toBeDefined();
    const edited = withIndividualHatchTier(plan, [shared.assignments![0]], 'HV');
    const built = pipeline(edited, false);
    expect(built.error).toBeNull();
    const inputs = built.hatches!.hatches.filter((h) => h.kind === 'itemIn');
    expect(inputs).toHaveLength(2);
    expect(inputs.map((h) => h.tier).sort()).toEqual(['HV', 'LV']);
    expect(inputs.every((h) => h.unitIds.length === 1)).toBe(true);
  });
});
