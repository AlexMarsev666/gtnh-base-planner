import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { buildGroup } from '../site/group';
import { unitCells } from '../geometry';
import { validateCasings } from './casingConstraints';
import { validateResourceHatches } from '../site/resourcePlacement';
import { withSteamFrame } from './steamWaterPump';
import { hatchKindFor } from '../site/demand';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { decodeSite, encodeSite, emptySite, validateSiteState } from '../../share/siteCodec';
import { withGroupDuplicated, withGroupPatched, withGroupRotated, withPlanAdded } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { arrangeSite } from '../site/arrange';
import { optimizeSite } from '../site/optimize';
import { hatchAssignmentKey } from '../hatches/assignments';
import { supportsHatchTier } from '../hatches/tiers';
import { requiredBlocks } from '../bom';

describe('pinned Water Pump', () => {
  const raw = getMultiblock('water-pump')!;
  for (const [frame, meta] of [
    ['bronze', 300],
    ['steel', 305],
  ] as const)
    it(`${frame}: exactly one fixed Steam Hatch, one output and nine counted casings`, () => {
      const built = buildGroup(
        raw,
        1,
        { x: 1, y: 1, z: 1 },
        raw.defaultHatches,
        {},
        true,
        {},
        { steamFrameTier: frame, voltageTier: 'MV' },
      );
      expect(validateMultiblockDef(built.def)).toEqual([]);
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.map((h) => h.kind).sort()).toEqual(['fluidOut', 'steamIn']);
      expect(supportsHatchTier(built.def, 'steamIn')).toBe(false);
      expect(built.def.hatchBlocks.steamIn).toBe('gregtech:gt.blockmachines@31040');
      expect(built.hatches.find((h) => h.kind === 'fluidOut')?.tier).toBe('MV');
      const cells = unitCells(built.def, built.units[0]);
      expect(cells.filter((c) => c.char === 'A').map((c) => c.blockId)).toEqual(
        Array(10).fill(`gregtech:gt.blockframes@${meta}`),
      );
      expect(cells.filter((c) => c.char === 'C')).toHaveLength(11);
      expect(validateCasings(built.def, built.units, built.hatches)).toEqual([]);
      expect(validateResourceHatches(built.def, built.units, built.hatches)).toEqual([]);
      const scene = createPipeline()(
        { ...defaultPlan(raw.id), count: 1, steamFrameTier: frame, voltageTier: 'MV' },
        false,
        false,
        true,
      ).scene!;
      const bom = requiredBlocks(scene);
      expect(bom.blocks.find((row) => row.blockId === 'gregtech:gt.blockmachines@31040')).toMatchObject({
        count: 1,
        anyTier: false,
      });
      expect(bom.blocks.find((row) => row.blockId === `gregtech:gt.blockframes@${meta}`)?.count).toBe(10);
      expect(bom.blocks.find((row) => row.blockId === 'gregtech:gt.blockcasings9@2')?.count).toBe(9);
      expect(bom.blocks.find((row) => row.blockId === 'gt.hatch.outputHatch.MV')?.count).toBe(1);
      const spare = cells.find(
        (c) => c.char === 'C' && !built.hatches.some((h) => h.cell.join() === c.pos.join()),
      )!;
      expect(
        validateCasings(built.def, built.units, [
          ...built.hatches,
          { cell: spare.pos, kind: 'fluidOut', face: 'north', unitIds: [0] },
        ]),
      ).not.toEqual([]);
      expect(withSteamFrame({ ...built.def }, frame).legend.A.blockId).toBe(
        `gregtech:gt.blockframes@${meta}`,
      );
      expect(withSteamFrame(built.def, frame === 'steel' ? 'bronze' : 'steel').legend.A.blockId).not.toBe(
        built.def.legend.A.blockId,
      );
    });
  it('requires exact Steam/Water IDs or explicit roles, even if labels say steam or water', () => {
    const fluid = { kind: 'fluid' as const, name: 'Steam Water', color: '#abcdef' };
    expect(hatchKindFor('in', 'steam', fluid, raw)).toBeNull();
    expect(hatchKindFor('out', 'water', fluid, raw)).toBeNull();
    expect(hatchKindFor('in', 'feed', { ...fluid, gameId: 'steam' }, raw)).toBe('steamIn');
    expect(hatchKindFor('out', 'product', { ...fluid, gameId: 'water' }, raw)).toBe('fluidOut');
    expect(hatchKindFor('in', 'feed', fluid, raw, [{ resource: 'feed', kind: 'steamIn' }])).toBe('steamIn');
    expect(
      hatchKindFor('out', 'product', fluid, raw, [{ resource: 'product', kind: 'fluidOut', role: 'water' }]),
    ).toBe('fluidOut');
    for (const gameId of ['water', 'lava', 'superheatedsteam'])
      expect(hatchKindFor('in', 'steam', { ...fluid, gameId }, raw)).toBeNull();
    expect(hatchKindFor('in', 'feed', fluid, raw, [{ resource: 'feed', kind: 'fluidIn' }])).toBeNull();
    expect(
      hatchKindFor('out', 'product', { ...fluid, gameId: 'lava' }, raw, [
        { resource: 'product', kind: 'fluidOut', role: 'water' },
      ]),
    ).toBeNull();
  });
  it('keeps historical hatch selection and reports a missing steam interface', () => {
    const plan = { ...defaultPlan(raw.id), count: 1, enabledHatches: ['fluidOut' as const] };
    const validated = validatePlanState(plan);
    expect(validated.enabledHatches).toEqual(['fluidOut']);
    expect(validated.steamFrameTier).toBeUndefined();
    expect(createPipeline()(validated, false, false, true).error).toContain('steamIn');
    expect(validated.enabledHatches).toEqual(['fluidOut']);
  });
  it('preserves unsupported fluid links after loading and exporting instead of assigning a fictitious input', async () => {
    const site = withPlanAdded(emptySite(), { ...defaultPlan(raw.id), count: 1 }, [8, 8]);
    site.size = [32, 32];
    const id = site.groups[0].id;
    site.resources = { wrong: { kind: 'fluid', name: 'Steam', color: '#abcdef', gameId: 'lava' } };
    site.ports = [{ id: 'in', dir: 'in', resource: 'wrong', pos: [0, 6] }];
    site.links = [{ id: 'legacy-feed', resource: 'wrong', from: { port: 'in' }, to: { group: id } }];
    site.groups[0].resourceBindings = [{ resource: 'wrong', kind: 'steamIn' }];
    const restored = await decodeSite(await encodeSite(site));
    const built = createSiteBuilder()(restored, { pipes: true, cables: false, below: true });
    expect(built.warnings).toContainEqual({ type: 'unsupported', group: id, resource: 'wrong' });
    expect(restored.links).toEqual(site.links);
    expect(restored.groups[0].resourceBindings).toEqual(site.groups[0].resourceBindings);
    expect(built.groups[0].demand.steamIn).toBeUndefined();
  });
  it('preserves frame and output tier through codecs, transfer, edits, layout and optimizer caches', async () => {
    const plan = {
      ...defaultPlan(raw.id),
      count: 1,
      steamFrameTier: 'steel' as const,
      hatchTiers: { [hatchAssignmentKey(0, 'fluidOut')]: 'HV' as const },
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(validatePlanState(plan));
    const pipeline = createPipeline();
    expect(pipeline(plan, false, false, true).def?.legend.A.blockId).toBe('gregtech:gt.blockframes@305');
    expect(pipeline({ ...plan, steamFrameTier: 'bronze' }, false, false, true).def?.legend.A.blockId).toBe(
      'gregtech:gt.blockframes@300',
    );
    let site = withPlanAdded(emptySite(), plan, [2, 2]);
    const id = site.groups[0].id;
    site = withGroupDuplicated(withGroupRotated(site, id), id, [15, 15]);
    const restored = await decodeSite(await encodeSite(site));
    const builder = createSiteBuilder();
    const options = { pipes: false, cables: false, below: true };
    expect(builder(restored, options).groups[0].def?.legend.A.blockId).toBe('gregtech:gt.blockframes@305');
    const bronze = withGroupPatched(restored, id, { steamFrameTier: 'bronze' });
    expect(builder(bronze, options).groups[0].def?.legend.A.blockId).toBe('gregtech:gt.blockframes@300');
    for (const state of [restored, bronze])
      expect(builder(state, options).groups[0].hatches.find((h) => h.kind === 'fluidOut')?.tier).toBe('HV');
    const aligned = { ...restored, groups: arrangeSite(restored, () => [3, 4]).groups };
    expect(
      optimizeSite(aligned, builder, {
        budgetMs: 1000,
        iterations: 20,
        seeds: 1,
        refineSteps: 0,
      }).site.groups.map((g) => g.steamFrameTier),
    ).toEqual(['steel', 'steel']);
    for (const invalid of [true, 1, null, 'gold']) {
      expect(() => validatePlanState({ ...plan, steamFrameTier: invalid })).toThrow(/frame material/);
      expect(() =>
        validateSiteState({
          ...restored,
          groups: restored.groups.map((g) => ({ ...g, steamFrameTier: invalid })),
        }),
      ).toThrow(/frame material/);
    }
  });
});
