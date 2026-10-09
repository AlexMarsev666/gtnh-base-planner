import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { defaultPlan } from '../../state/store';
import { sizedDef } from '../resize';
import { unitCells } from '../geometry';
import { buildGroup } from '../site/group';
import { createSiteBuilder } from '../site/build';
import { validateResourceHatches } from '../site/resourcePlacement';
import { VOLTAGE_TIERS } from '../tiers';
import { createPipeline } from '../../ui/pipeline';
import { withPlanAdded, withGroupDuplicated } from '../../ui/siteActions';
import { decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { emptySite, decodeSite, encodeSite, validateSiteState } from '../../share/siteCodec';

// Source: MTEManualTrafo.checkMachine/checkProcessing at RC2 commit a3e1e11241a814c9fa0dd0973d5699548428f689.
// Native loop checks 1–8 winding layers; circuit 0 increases, circuit 1 decreases by that layer count.
describe('RC2 Manual Transformer direct modes', () => {
  const raw = getMultiblock('manual-transformer')!;
  for (const mode of ['up', 'down'] as const)
    for (const windings of [1, 2, 3, 4, 5, 6, 7, 8]) {
      it(`${mode}: ${windings} winding layers determine output tier, base inputs and top outputs`, () => {
        const def = sizedDef(raw, windings + 2);
        const settings = {
          voltageTier: mode === 'up' ? ('LV' as const) : ('UEV' as const),
          manualTransformerMode: mode,
        };
        const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, true, {}, settings);
        expect(built.unplaced).toEqual([]);
        expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
        const energy = built.hatches.find((h) => h.kind === 'energy')!;
        const dynamo = built.hatches.find((h) => h.kind === 'dynamo')!;
        expect(energy.cell[1]).toBe(0);
        expect(dynamo.cell[1]).toBe(windings + 1);
        expect(energy.tier).toBe(settings.voltageTier);
        expect(dynamo.tier).toBe(
          VOLTAGE_TIERS[VOLTAGE_TIERS.indexOf(settings.voltageTier) + (mode === 'up' ? windings : -windings)],
        );
        const cells = unitCells(def, built.units[0]);
        expect(cells.filter((c) => c.blockId === 'bartworks:BW_Machinery_Casings@1')).toHaveLength(
          windings * 8,
        );
        expect(cells.filter((c) => c.blockId === 'bartworks:BW_Machinery_Casings@0')).toHaveLength(windings);
        for (const tier of ['ULV', 'HV'] as const) {
          const bad = built.hatches.map((h) => (h.kind === 'dynamo' ? { ...h, tier } : h));
          if (tier === dynamo.tier) continue;
          expect(
            validateResourceHatches(def, built.units, bad, settings).some((e) =>
              e.includes(`needs ${windings} tier steps ${mode}`),
            ),
          ).toBe(true);
        }
      });
    }

  it('does not clamp an impossible step-down or alter legacy unspecified tiers', () => {
    const def = sizedDef(raw, 10);
    const settings = { voltageTier: 'LV' as const, manualTransformerMode: 'down' as const };
    const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, true, {}, settings);
    expect(built.hatches.find((h) => h.kind === 'dynamo')?.tier).toBeUndefined();
    expect(
      validateResourceHatches(def, built.units, built.hatches, settings).some((e) =>
        e.includes('needs 8 tier steps down'),
      ),
    ).toBe(true);
    const legacy = { ...defaultPlan(raw.id), count: 1, voltageTier: undefined };
    const snapshot = JSON.stringify(legacy);
    const result = createPipeline()(legacy, false, false);
    expect(result.error).toContain('energy unspecified, dynamo unspecified');
    expect(JSON.stringify(legacy)).toBe(snapshot);
    expect(result.hatches!.hatches.every((h) => !h.tier)).toBe(true);
  });

  it('keeps individual dynamo overrides and invalidates both pipeline caches on direction changes', () => {
    const plan = { ...defaultPlan(raw.id), count: 1, voltageTier: 'HV' as const };
    const run = createPipeline();
    const up = run(plan, false);
    expect(up.error).toBeNull();
    const output = up.hatches!.hatches.find((h) => h.kind === 'dynamo')!;
    expect(output.tier).toBe('EV');
    const down = run({ ...plan, manualTransformerMode: 'down' }, false);
    expect(down.error).toBeNull();
    expect(down.hatches!.hatches.find((h) => h.kind === 'dynamo')?.tier).toBe('MV');
    const overridden = { ...plan, hatchTiers: { [output.assignments![0]]: 'HV' as const } };
    const bad = run(overridden, false);
    expect(bad.hatches!.hatches.find((h) => h.kind === 'dynamo')?.tier).toBe('HV');
    expect(bad.error).toContain('needs 1 tier steps up');
    const site = withPlanAdded(emptySite(), plan);
    const buildSite = createSiteBuilder();
    expect(
      buildSite(site, { pipes: false, cables: false }).groups[0].hatches.find((h) => h.kind === 'dynamo')
        ?.tier,
    ).toBe('EV');
    expect(
      buildSite(
        { ...site, groups: [{ ...site.groups[0], manualTransformerMode: 'down' }] },
        { pipes: false, cables: false },
      ).groups[0].hatches.find((h) => h.kind === 'dynamo')?.tier,
    ).toBe('MV');
  });

  it('preserves direction and height in machine/site links, conversion and duplication; refuses disabled tapped modes', async () => {
    const plan = {
      ...defaultPlan(raw.id),
      voltageTier: 'UEV' as const,
      size: 10,
      manualTransformerMode: 'down' as const,
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    const site = withPlanAdded(emptySite(), plan);
    expect(site.groups[0]).toMatchObject({ size: 10, manualTransformerMode: 'down' });
    expect(await decodeSite(await encodeSite(site))).toEqual(validateSiteState(site));
    expect(withGroupDuplicated(site, site.groups[0].id, [16, 16]).groups[1].manualTransformerMode).toBe(
      'down',
    );
    expect(() => validatePlanState({ ...plan, manualTransformerMode: 'tapped-up' })).toThrow(
      'Invalid Manual Transformer mode',
    );
    expect(() =>
      validateSiteState({ ...site, groups: [{ ...site.groups[0], manualTransformerMode: 2 }] }),
    ).toThrow('Invalid Manual Transformer mode');
  });

  it('separates input/output power networks at the converted multiblock and retains incompatible links', () => {
    const plan = {
      ...defaultPlan(raw.id),
      count: 1,
      size: 4,
      voltageTier: 'HV' as const,
      manualTransformerMode: 'down' as const,
    };
    const site = withPlanAdded(emptySite(), plan, [8, 8]);
    const transformer = site.groups[0];
    const source = {
      ...transformer,
      id: 'source',
      multiblockId: 'single-block',
      size: undefined,
      origin: [3, 8] as [number, number],
      enabledHatches: [],
      voltageTier: 'HV' as const,
    };
    const sink = { ...source, id: 'sink', origin: [16, 8] as [number, number], voltageTier: 'LV' as const };
    const linked = {
      ...site,
      groups: [source, transformer, sink],
      resources: { eu: { kind: 'power' as const, name: 'EU', color: '#123456' } },
      links: [
        { id: 'before', resource: 'eu', from: { group: 'source' }, to: { group: transformer.id } },
        { id: 'after', resource: 'eu', from: { group: transformer.id }, to: { group: 'sink' } },
      ],
    };
    const build = createSiteBuilder();
    const good = build(linked, { pipes: false, cables: true, below: true });
    expect(good.nets.map((n) => n.links)).toEqual([['before'], ['after']]);
    expect(good.warnings).toEqual([]);
    expect(good.nets.map((n) => new Set(n.terminals.map((t) => t.hatch?.tier)))).toEqual([
      new Set(['HV']),
      new Set(['LV']),
    ]);
    const badSite = { ...linked, groups: [source, transformer, { ...sink, voltageTier: 'MV' as const }] };
    const bad = build(badSite, { pipes: false, cables: true, below: true });
    expect(bad.nets.map((n) => n.links)).toEqual([['before'], ['after']]);
    expect(bad.warnings.some((w) => w.type === 'error' && w.code === 'electrical')).toBe(true);
    expect(badSite.links).toEqual(linked.links);
  });
});
