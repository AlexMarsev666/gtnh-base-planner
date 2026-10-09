import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { hatchTiers } from '../../data/single-machines';
import { COMPUTATION_HATCHES, COMPUTATION_INPUTS, COMPUTATION_OUTPUTS } from './computation';
import { buildGroup } from '../site/group';
import { validateResourceHatches } from '../site/resourcePlacement';
import { validateAlternativeCounts } from './rules';
import { sizedDef, resizeSteps } from '../resize';
import { unitCells } from '../geometry';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { requiredBlocks } from '../bom';
import { HATCH_KINDS, decodePlan, encodePlan, validatePlanState } from '../../share/codec';
import { emptySite, decodeSite, encodeSite } from '../../share/siteCodec';
import { withPlanAdded, withGroupDuplicated, withGroupRotated } from '../../ui/siteActions';
import { createSiteBuilder } from '../site/build';
import { hatchAssignmentKey } from '../hatches/assignments';
import type { HatchKind } from './types';
import textures from '../../render/textures.json';

describe('RC2 computational interfaces and exact TecTech pieces', () => {
  const ids = [
    'dyson-swarm',
    'quantum-computer',
    'weighted-network-switch-with-qos',
    'static-network-switch-with-qos',
  ];
  it('appends historical kind bits and uses only the actual registered variants and textures', () => {
    expect(HATCH_KINDS.slice(19)).toEqual([
      'computationIn',
      'computationOut',
      'wirelessComputationIn',
      'wirelessComputationOut',
      'uncertainty',
      'computerRack',
    ]);
    expect(Object.values(COMPUTATION_HATCHES).map((v) => v.map(({ meta, tier }) => [meta, tier]))).toEqual([
      [[15440, 7]],
      [[15441, 7]],
      [[15445, 12]],
      [[15444, 12]],
      [
        [15430, 5],
        [15431, 7],
      ],
      [[15450, 8]],
    ]);
    expect(hatchTiers('uncertainty')).toEqual(['IV', 'ZPM']);
    for (const variants of Object.values(COMPUTATION_HATCHES))
      for (const { meta } of variants)
        expect(textures.blocks).toHaveProperty(`gregtech:gt.blockmachines@${meta}`);
  });
  for (const id of ids)
    it(`${id}: validates new defaults but keeps old missing service selections`, () => {
      const def = getMultiblock(id)!;
      expect(validateMultiblockDef(def)).toEqual([]);
      const state = { ...defaultPlan(id), count: 1 };
      const result = createPipeline()(state, false, false, true);
      expect(result.error).toBeNull();
      const legacy = {
        ...state,
        enabledHatches: state.enabledHatches.filter((k) => !HATCH_KINDS.slice(19).includes(k)),
      };
      const before = [...legacy.enabledHatches];
      expect(createPipeline()(legacy, false, false, true).error).not.toBeNull();
      expect(legacy.enabledHatches).toEqual(before);
    });
  it('keeps Dyson computational command cells distinct from the identical fixed command casing', () => {
    const def = getMultiblock('dyson-swarm')!;
    expect(def.legend.R.blockId).toBe(def.legend.C.blockId);
    expect(def.legend.R.hatches).toEqual(COMPUTATION_INPUTS);
    expect(def.legend.C.hatches).toBeUndefined();
    for (const input of COMPUTATION_INPUTS) {
      const enabled = def.defaultHatches.map((k) => (k === 'computationIn' ? input : k));
      const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, {});
      expect(built.unplaced).toEqual([]);
      expect(validateAlternativeCounts(def, built.units, built.hatches)).toEqual([]);
      const fixed = unitCells(def, built.units[0]).find((c) => c.char === 'C')!;
      const data = built.hatches.find((h) => h.kind === input)!;
      expect(
        validateResourceHatches(
          def,
          built.units,
          [...built.hatches.filter((h) => h !== data), { ...data, cell: fixed.pos }],
          {},
        ).some((e) => e.includes('not allowed')),
      ).toBe(true);
    }
  });
  it('uses all checker lengths and reserves Quantum end caps for casings', () => {
    for (const [id, min, max] of [
      ['quantum-computer', 4, 16],
      ['static-network-switch-with-qos', 2, 18],
    ] as const) {
      const raw = getMultiblock(id)!;
      expect(resizeSteps(raw.resize!)).toEqual(Array.from({ length: max - min + 1 }, (_, i) => min + i));
      for (const length of resizeSteps(raw.resize!)) {
        const def = sizedDef(raw, length);
        const enabled = def.defaultHatches.filter(
          (k) => id !== 'quantum-computer' || length > 4 || k !== 'computerRack',
        );
        const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, {});
        expect(built.unplaced).toEqual([]);
        expect(validateResourceHatches(def, built.units, built.hatches, {})).toEqual([]);
        expect(validateAlternativeCounts(def, built.units, built.hatches)).toEqual([]);
        expect(def.size[2]).toBe(length);
        expect(validateMultiblockDef(def)).toEqual([]);
        if (id === 'quantum-computer') {
          const cells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 });
          const rackSites = cells.filter((c) => def.legend[c.char]?.hatches?.includes('computerRack'));
          expect(rackSites).toHaveLength(2 * (length - 4));
          expect(rackSites.every((c) => c.pos[2] >= 2 && c.pos[2] < length - 2)).toBe(true);
          expect(def.requiredHatches?.uncertainty).toEqual({ min: 1 });
          expect(def.requiredHatches?.computerRack).toBeUndefined();
        } else {
          expect(def.requiredHatches?.maintenance).toBeUndefined();
          expect(def.requiredHatches?.dynamo).toBeUndefined();
        }
      }
    }
  });
  for (const id of ['weighted-network-switch-with-qos', 'static-network-switch-with-qos'])
    for (const input of COMPUTATION_INPUTS)
      for (const output of COMPUTATION_OUTPUTS)
        it(`${id}: ${input}/${output} remain alternatives and fail when required services are removed`, () => {
          const def = sizedDef(getMultiblock(id)!, undefined);
          const enabled = def.defaultHatches.map((k) =>
            k === 'computationIn' ? input : k === 'computationOut' ? output : k,
          );
          const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, enabled, {}, true, {}, {});
          expect(built.unplaced).toEqual([]);
          expect(built.hatches.map((h) => h.kind).sort()).toEqual([...enabled].sort());
          expect(validateAlternativeCounts(def, built.units, built.hatches)).toEqual([]);
          for (const missing of [input, output])
            expect(
              validateAlternativeCounts(
                def,
                built.units,
                built.hatches.filter((h) => h.kind !== missing),
              ),
            ).not.toEqual([]);
          const allowed = unitCells(def, built.units[0]).filter((c) =>
            def.legend[c.char]?.hatches?.includes(input),
          );
          expect(
            allowed.every((c) => c.char === (id === 'weighted-network-switch-with-qos' ? 'A' : 'C')),
          ).toBe(true);
        });
  it('preserves an individual ZPM resolver and service choices across files, rotations, duplicates and caches', async () => {
    const plan = {
      ...defaultPlan('quantum-computer'),
      count: 1,
      size: 8,
      hatchTiers: { [hatchAssignmentKey(0, 'uncertainty')]: 'ZPM' as const },
      enabledHatches: [
        'energy',
        'maintenance',
        'wirelessComputationIn',
        'wirelessComputationOut',
        'uncertainty',
        'computerRack',
      ] as HatchKind[],
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(validatePlanState(plan));
    const pipeline = createPipeline();
    const first = pipeline(plan, false, false, true);
    expect(first.error).toBeNull();
    expect(
      requiredBlocks(first.scene!).blocks.find((b) => b.blockId === 'gt.hatch.uncertainty.ZPM')?.count,
    ).toBe(1);
    expect(
      pipeline({ ...plan, hatchTiers: { [hatchAssignmentKey(0, 'uncertainty')]: 'LV' } }, false, false, true)
        .error,
    ).toContain('no LV variant');
    let site = withPlanAdded(emptySite(), plan, [2, 2]);
    const id = site.groups[0].id;
    site = withGroupDuplicated(withGroupRotated(site, id), id, [18, 18]);
    const restored = await decodeSite(await encodeSite(site));
    expect(restored.groups.map((g) => g.size)).toEqual([8, 8]);
    const result = createSiteBuilder()(restored, { pipes: false, cables: false, below: true });
    for (const group of result.groups)
      expect(group.hatches.find((h) => h.kind === 'uncertainty')?.tier).toBe('ZPM');
    expect(restored.groups.map((g) => g.enabledHatches)).toEqual([plan.enabledHatches, plan.enabledHatches]);
  });
});
