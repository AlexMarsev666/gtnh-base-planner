import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { unitCells } from '../geometry';
import { buildGroup } from '../site/group';
import { validateResourceHatches } from '../site/resourcePlacement';
import { sizedDef, sizeForFluidOutputs } from '../resize';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipeline';
import { casingRules } from './rules';
import { VOLTAGE_TIERS } from '../tiers';
import type { SiteHatch } from '../site/group';
import type { HatchKind, Unit } from './types';
import {
  REVIEWED_ENERGY_RULES,
  REVIEWED_GLASS_ENERGY_RULES,
  withReviewedStructure,
} from './structureAdapters';

describe('RC2 Mega Distillation Tower output sections', () => {
  const raw = getMultiblock('mega-distillation-tower')!;
  for (const [height, outputs] of [
    [30, [13, 15, 19]],
    [36, [13, 15, 19, 21, 25]],
    [42, [13, 15, 19, 21, 25, 27, 31]],
    [48, [13, 15, 19, 21, 25, 27, 31, 33, 37]],
    [54, [13, 15, 19, 21, 25, 27, 31, 33, 37, 39, 43]],
  ] as const) {
    it(`requires the ${outputs.length} native output cells at height ${height}`, () => {
      const def = sizedDef(raw, height);
      expect(def.size).toEqual([15, height, 9]);
      const unit: Unit = { id: 0, origin: [0, 0, 0], rotation: 0 };
      const cells = unitCells(def, unit).filter((c) => c.hatches?.includes('fluidOut'));
      expect(cells.map((c) => c.pos)).toEqual(outputs.map((y) => [0, y, 4]));
      const regions = cells.map((c) => def.legend[c.char].region);
      expect(def.fluidOutputRegions).toEqual(regions);
      const resourceBindings = outputs.map((_, outputSlot) => ({
        kind: 'fluidOut' as const,
        resource: `fraction-${outputSlot}`,
        outputSlot,
      }));
      const built = buildGroup(
        def,
        1,
        { x: null, y: 1, z: null },
        ['energy', 'maintenance'],
        {
          fluidIn: ['feed'],
          fluidOut: resourceBindings.map((b) => b.resource),
        },
        true,
        {},
        { voltageTier: 'LV', resourceBindings },
      );
      expect(built.missing).toEqual([]);
      expect(built.unplaced).toEqual([]);
      expect(validateResourceHatches(built.def, built.units, built.hatches, { resourceBindings })).toEqual(
        [],
      );
      for (const [slot, y] of outputs.entries())
        expect(built.hatches.find((h) => h.resource === `fraction-${slot}`)!.cell[1]).toBe(y);
      const withoutLast = built.hatches.filter((h) => h.resource !== `fraction-${outputs.length - 1}`);
      expect(validateResourceHatches(def, built.units, withoutLast, { resourceBindings })).toContain(
        'Controller 0: fluidOut is required in region final.',
      );
    });
  }

  it('sizes paired sections by native slot capacity and leaves excess slots invalid', () => {
    for (const [slots, height] of [
      [1, 30],
      [3, 30],
      [4, 36],
      [5, 36],
      [6, 42],
      [11, 54],
      [12, 60],
    ])
      expect(sizeForFluidOutputs(raw, slots)).toBe(height);
  });
});

describe('RC2 standard energy tier versus the actual structure glass', () => {
  for (const id of [
    'algae-farm',
    'exothermic-hearth',
    'extreme-industrial-greenhouse',
    'fluid-shaper',
    'mass-solidifier',
    'mega-chemical-reactor',
    'mega-oil-cracker',
  ]) {
    it(`${id}: allows HV with borosilicate glass and rejects EV without changing the hatch`, () => {
      const def = getMultiblock(id)!;
      expect(REVIEWED_GLASS_ENERGY_RULES[id]).toContain('a3e1e11241a814c9fa0dd0973d5699548428f689');
      expect(Object.values(def.legend).some((cell) => cell.blockId === 'bartworks:BW_TieredGlass@0')).toBe(
        true,
      );
      const unit: Unit = { id: 0, origin: [0, 0, 0], rotation: 0 };
      const cell = unitCells(def, unit).find((c) => c.hatches?.includes('energy'))!;
      const hatch: SiteHatch = { kind: 'energy', cell: cell.pos, face: 'north', unitIds: [0], tier: 'HV' };
      const glassErrors = (h: SiteHatch) =>
        validateResourceHatches(def, [unit], [h]).filter((e) => e.includes('structure glass tier'));
      expect(glassErrors(hatch)).toEqual([]);
      const higher: SiteHatch = { ...hatch, tier: 'EV' };
      expect(glassErrors(higher)).toEqual([
        'Controller 0: energy tier EV; RC2 requires ULV–HV (structure glass tier HV).',
      ]);
      expect(higher.tier).toBe('EV');
      // The cap follows the blocks, not a hard-coded limit for the controller ID.
      const titanium = withReviewedStructure({
        ...def,
        legend: Object.fromEntries(
          Object.entries(def.legend).map(([ch, entry]) => [
            ch,
            entry.blockId === 'bartworks:BW_TieredGlass@0'
              ? { ...entry, blockId: 'bartworks:BW_TieredGlass@1' }
              : entry,
          ]),
        ),
      });
      expect(
        validateResourceHatches(titanium, [unit], [higher]).filter((e) => e.includes('structure glass tier')),
      ).toEqual([]);
    });
  }

  it('does not restrict Industrial Mixer standard hatches by a condition meant only for exotic inputs', () => {
    const def = getMultiblock('industrial-mixing-machine')!;
    expect(def.hatchTierLimits?.energy?.max).toBeUndefined();
  });

  it('uses the actual BW_ExtraGlass registration, including its nonconsecutive IV and UHV tiers', () => {
    const def = getMultiblock('algae-farm')!;
    for (const [meta, tier] of [
      [0, 'IV'],
      [1, 'UHV'],
      [2, 'UEV'],
      [3, 'UIV'],
      [4, 'UMV'],
      [5, 'UXV'],
    ] as const) {
      const variant = withReviewedStructure({
        ...def,
        legend: Object.fromEntries(
          Object.entries(def.legend).map(([ch, entry]) => [
            ch,
            entry.blockId === 'bartworks:BW_TieredGlass@0'
              ? { ...entry, blockId: `bartworks:BW_ExtraGlass@${meta}` }
              : entry,
          ]),
        ),
      });
      expect(variant.hatchTierLimits?.energy?.max).toBe(tier);
    }
  });
});

describe('RC2 energy hatch combinations, independently of shape hints', () => {
  for (const [id, kinds] of [
    ['dimensionally-transcendent-plasma-forge', ['energy']],
    ['synchrotron', ['energy']],
    ['manual-transformer', ['energy', 'dynamo']],
  ] as const) {
    it(`${id}: rejects mixed tiers per controller and keeps different controllers independent`, () => {
      const def = getMultiblock(id)!;
      expect(REVIEWED_ENERGY_RULES[id].source).toContain('a3e1e11241a814c9fa0dd0973d5699548428f689');
      const units: Unit[] = [
        { id: 0, origin: [0, 0, 0], rotation: 0 },
        { id: 1, origin: [100, 0, 0], rotation: 1 },
      ];
      const hatches: SiteHatch[] = [];
      for (const unit of units)
        for (const kind of kinds) {
          const cells = unitCells(def, unit).filter((c) => c.hatches?.includes(kind as HatchKind));
          expect(cells.length).toBeGreaterThanOrEqual(2);
          hatches.push(
            ...cells.slice(0, 2).map((cell): SiteHatch => ({
              kind,
              cell: cell.pos,
              face: 'north',
              unitIds: [unit.id],
              tier: unit.id === 0 ? 'LV' : 'MV',
            })),
          );
        }
      const tierErrors = (items: SiteHatch[]) =>
        validateResourceHatches(def, units, items).filter((e) => e.includes('same specified tier'));
      expect(tierErrors(hatches)).toEqual([]);
      for (const kind of kinds) {
        const index = hatches.findIndex((h) => h.kind === kind && h.unitIds.includes(0));
        const mixed = hatches.map((h, i) => (i === index ? { ...h, tier: 'HV' as const } : h));
        expect(tierErrors(mixed)).toEqual([
          `Controller 0: all ${kind} hatches must have the same specified tier under RC2.`,
        ]);
        const unknown = hatches.map((h, i) => (i === index ? { ...h, tier: undefined } : h));
        expect(tierErrors(unknown)).toHaveLength(1);
        expect(hatches[index].tier).toBe('LV');
      }
    });
  }

  for (const [id, good, bad, minimum, maximum] of [
    ['synchrotron', 4, 3, 4, 4],
    ['synchrotron', 4, 5, 4, 4],
    ['dimensionally-transcendent-plasma-forge', 2, 3, 1, 2],
  ] as const) {
    it(`${id}: accepts ${good} standard inputs and rejects ${bad}`, () => {
      const def = getMultiblock(id)!;
      const unit: Unit = { id: 0, origin: [0, 0, 0], rotation: 0 };
      const slots = unitCells(def, unit).filter((c) => c.hatches?.includes('energy'));
      const make = (n: number): SiteHatch[] =>
        Array.from({ length: n }, (_, i) => ({
          kind: 'energy',
          cell: slots[i % slots.length].pos,
          face: 'north',
          unitIds: [0],
          tier: 'LV',
        }));
      expect(
        validateResourceHatches(def, [unit], make(good)).filter((e) => e.includes('energy count')),
      ).toEqual([]);
      expect(validateResourceHatches(def, [unit], make(bad))).toContain(
        `Controller 0: energy count ${bad}; requires ${minimum}–${maximum}.`,
      );
    });
  }
});

describe('RC2 source-reviewed standard hatch adders', () => {
  for (const [id, minimum, count] of [
    ['fusion-control-computer-mark-i', 'LuV', 16],
    ['fusion-control-computer-mark-ii', 'ZPM', 16],
    ['fusion-control-computer-mark-iii', 'UV', 16],
    ['fusiontech-mk-iv', 'UHV', 16],
    ['fusiontech-mk-v', 'UEV', 16],
    ['compact-fusion-computer-mk-i-prototype', 'LuV', 32],
    ['compact-fusion-computer-mk-ii', 'ZPM', 32],
    ['compact-fusion-computer-mk-iii', 'UV', 32],
    ['compact-fusion-computer-mk-iv-prototype', 'UHV', 32],
    ['compact-fusion-computer-mk-v', 'UEV', 32],
  ] as const) {
    it(`${id}: only accepts injectors in the source zone and at the registered minimum tier`, () => {
      const def = getMultiblock(id)!;
      const cells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 });
      const slots = cells.filter((c) => c.char && def.legend[c.char]?.hatches?.includes('energy'));
      expect(slots).toHaveLength(count);
      expect(def.minimumVoltageTier).toBe(minimum);
      const built = createPipeline()({ ...defaultPlan(id), count: 1 }, false, false, true);
      expect(built.error).toBeNull();
      const energy = built.hatches!.hatches.find((h) => h.kind === 'energy')!;
      expect(energy.tier).toBe(minimum);
      const bad = built.hatches!.hatches.map((h) => (h === energy ? { ...h, tier: 'IV' as const } : h));
      expect(
        validateResourceHatches(def, built.pack!.units, bad).some((e) => e.includes('energy tier IV')),
      ).toBe(true);
      const wrongCell = cells.find(
        (c) => c.role === 'casing' && !def.legend[c.char]?.hatches?.includes('energy'),
      )!;
      expect(
        validateResourceHatches(
          def,
          built.pack!.units,
          built.hatches!.hatches.map((h) => (h === energy ? { ...h, cell: wrongCell.pos } : h)),
        ).some((e) => e.includes('energy at') && e.includes('is not allowed')),
      ).toBe(true);
    });
  }

  it('retains the module base optional classic adder at all nine casing positions', () => {
    for (const id of [
      'space-assembler-module-mk-i',
      'space-mining-module-mk-i',
      'space-pumping-module-mk-i',
    ]) {
      const def = getMultiblock(id)!;
      const cells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 });
      expect(
        cells.filter((c) => c.role === 'casing' && def.legend[c.char]?.hatches?.includes('itemOut')),
      ).toHaveLength(9);
      const built = createPipeline()({ ...defaultPlan(id), count: 1 }, false, false, true);
      expect(built.error).toBeNull();
      expect(built.hatches!.hatches.every((h) => h.kind !== 'energy')).toBe(true);
    }
  });

  it('checks Chemical Plant default casing tier and the source minimum of 70 solid casings', () => {
    const def = getMultiblock('exxonmobil-chemical-plant')!;
    expect(casingRules(def).map((r) => r.min)).toEqual([70]);
    const built = createPipeline()({ ...defaultPlan(def.id), count: 1 }, false, false, true);
    expect(built.error).toBeNull();
    const high = built.hatches!.hatches.map((h) => (h.kind === 'energy' ? { ...h, tier: 'MV' as const } : h));
    expect(
      validateResourceHatches(def, built.pack!.units, high).some((e) => e.includes('energy tier MV')),
    ).toBe(true);
  });

  it('keeps a required bottom-facing hatch invalid until below connections are enabled', () => {
    const plan = { ...defaultPlan('nuclear-salt-processing-plant'), count: 1 };
    const run = createPipeline();
    expect(run(plan, false, false, false).error).toContain('energy count 0');
    const built = run(plan, false, false, true);
    expect(built.error).toBeNull();
    const energy = built.hatches!.hatches.filter((h) => h.kind === 'energy');
    expect(energy).toHaveLength(2);
    expect(energy.every((h) => h.cell[1] === 0 && h.face === 'down')).toBe(true);
  });
});

describe('RC2 Sparge Tower checked structure and resource dispatch', () => {
  const def = getMultiblock('sparge-tower-controller')!;
  const limits = { x: null, y: 1, z: null };
  const settings = { resourceBindings: [{ kind: 'fluidOut' as const, resource: 'product', outputSlot: 6 }] };
  const build = () =>
    buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['feed'], fluidOut: ['product'] },
      true,
      {},
      settings,
    );

  it('keeps the six intermediate centers air and the top center a counted closing casing', () => {
    for (let y = 1; y < 7; y++) expect(def.layers[y][1][1]).toBe('-');
    const top = def.legend[def.layers[7][1][1]];
    expect(top.blockId).toBe('miscutils:gtplusplus.blockcasings.5@4');
    expect(top.region).toBe('topCenter');
  });

  it('places recipe slot 6 on the top perimeter and the mandatory first-layer outlet separately', () => {
    const built = build();
    expect(built.missing).toEqual([]);
    expect(built.unplaced).toEqual([]);
    const product = built.hatches.find((h) => h.resource === 'product')!;
    expect(product.cell[1]).toBe(7);
    expect(product.cell.slice(0, 3)).not.toEqual([1, 7, 1]);
    expect(built.hatches.some((h) => h.kind === 'fluidOut' && h.cell[1] === 1)).toBe(true);
    expect(built.hatches.find((h) => h.resource === 'feed')!.cell[1]).toBe(0);
    expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
    expect(
      validateResourceHatches(
        def,
        built.units,
        built.hatches.filter((h) => !(h.kind === 'fluidOut' && h.cell[1] === 1)),
        settings,
      ),
    ).toContain('Controller 0: fluidOut is required in region layer1.');
  });

  it('accepts an exposed top output and rejects the wrong recipe layer', () => {
    const built = build();
    const product = built.hatches.find((h) => h.resource === 'product')!;
    const vertical = built.hatches.map((h) => (h === product ? { ...h, face: 'up' as const } : h));
    expect(validateResourceHatches(def, built.units, vertical, settings)).toEqual([]);
    const first = built.hatches.find((h) => h.kind === 'fluidOut' && h.cell[1] === 1)!;
    const wrongLayer = built.hatches
      .filter((h) => h !== product)
      .map((h) => (h === first ? { ...h, resource: 'product' } : h));
    expect(
      validateResourceHatches(def, built.units, wrongLayer, settings).some((e) =>
        e.includes('must use region layer7'),
      ),
    ).toBe(true);
    for (const y of [1, 4, 7]) {
      const cell = unitCells(def, built.units[0]).find((c) => c.local.join() === `0,${y},0`)!;
      expect(cell.hatches).toEqual(['fluidOut', 'energy', 'maintenance']);
    }
    for (const entry of Object.values(def.legend).filter((e) => e.region?.startsWith('layer'))) {
      expect(entry.disallowFaces?.energy).toBeUndefined();
      expect(entry.disallowFaces?.maintenance).toBeUndefined();
    }
  });
});

describe('RC2 Dangote Distillus tower mode', () => {
  for (const height of [3, 5, 12]) {
    it(`checks each output layer and a closing top at height ${height}`, () => {
      const def = sizedDef(getMultiblock('dangote-distillus')!, height);
      const settings = {
        resourceBindings: [{ kind: 'fluidOut' as const, resource: 'last', outputSlot: height - 2 }],
      };
      expect(def.fluidOutputRegions).toHaveLength(height - 1);
      for (let y = 1; y < height - 1; y++) {
        expect(def.layers[y][1][1]).toBe('-');
        const entry = def.legend[def.layers[y][0][0]];
        expect(entry.hatches).not.toContain('muffler');
        expect(entry.disallowFaces?.energy).toBeUndefined();
      }
      const built = buildGroup(
        def,
        1,
        { x: null, y: 1, z: null },
        ['energy', 'maintenance', 'muffler'],
        { fluidIn: ['feed'], fluidOut: ['last'] },
        true,
        {},
        settings,
      );
      expect(built.unplaced).toEqual([]);
      expect(built.missing).toEqual([]);
      expect(built.hatches.find((h) => h.resource === 'feed')!.cell[1]).toBe(0);
      expect(built.hatches.find((h) => h.resource === 'last')!.cell[1]).toBe(height - 1);
      expect(built.hatches.filter((h) => h.kind === 'muffler').every((h) => h.cell[1] === height - 1)).toBe(
        true,
      );
      expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
      for (let y = 1; y < height; y++) {
        expect(built.hatches.some((h) => h.kind === 'fluidOut' && h.cell[1] === y)).toBe(true);
        const missingLayer = built.hatches.filter((h) => !(h.kind === 'fluidOut' && h.cell[1] === y));
        expect(
          validateResourceHatches(def, built.units, missingLayer, settings).some((e) =>
            e.includes('fluidOut is required in region'),
          ),
        ).toBe(true);
      }
    });
  }
});

describe('RC2 fixed hatch voltage limits', () => {
  for (const [id, minimum] of Object.entries({
    'fluid-drilling-rig': 'MV',
    'fluid-drilling-rig-ii': 'HV',
    'fluid-drilling-rig-iii': 'EV',
    'fluid-drilling-rig-iv': 'IV',
    'ore-drilling-plant': 'MV',
    'ore-drilling-plant-ii': 'HV',
    'ore-drilling-plant-iii': 'EV',
    'ore-drilling-plant-iv': 'IV',
    'infinite-fluid-drilling-rig': 'UHV',
    'void-miner-i': 'LuV',
    'void-miner-ii': 'ZPM',
    'void-miners': 'UV',
  })) {
    it(`${id}: starts at ${minimum} and rejects a lower energy hatch without silently upgrading it`, () => {
      const def = getMultiblock(id)!;
      expect(defaultPlan(id).voltageTier).toBe(minimum);
      const unit = { id: 42, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const };
      const cell = unitCells(def, unit).find((c) => c.hatches?.includes('energy'))!;
      const hatch = {
        kind: 'energy' as const,
        cell: cell.pos,
        face: 'north' as const,
        unitIds: [42],
        tier: 'LV' as const,
      };
      expect(
        validateResourceHatches(def, [unit], [hatch]).some((e) =>
          e.includes(`energy input tier too low; RC2 requires ${minimum}`),
        ),
      ).toBe(true);
      expect(
        validateResourceHatches(def, [unit], [{ ...hatch, tier: minimum as 'UHV' }]).some((e) =>
          e.includes('energy input tier'),
        ),
      ).toBe(false);
      expect(hatch.tier).toBe('LV');
      const lower = VOLTAGE_TIERS[VOLTAGE_TIERS.indexOf(minimum as 'MV') - 1];
      const otherCell = unitCells(def, unit).find(
        (c) => c.hatches?.includes('energy') && c.pos.join() !== cell.pos.join(),
      )!;
      const pair = [
        { ...hatch, tier: lower },
        { ...hatch, cell: otherCell.pos, tier: lower },
      ];
      expect(validateResourceHatches(def, [unit], pair).some((e) => e.includes('energy input tier'))).toBe(
        false,
      );
    });
  }

  it('requires four standard LFTR outputs, IV fluid and muffler hatches, and EV through LuV dynamos', () => {
    const def = getMultiblock('thorium-reactor-lftr')!;
    for (const y of [1, 2]) for (let z = 1; z <= 5; z++) expect(def.layers[y][z].slice(1, 6)).toBe('-----');
    const built = buildGroup(
      def,
      1,
      { x: null, y: 1, z: null },
      ['dynamo', 'maintenance', 'muffler'],
      { fluidIn: ['salt'], fluidOut: ['out'] },
      true,
      {},
      { voltageTier: 'IV' },
    );
    expect(built.unplaced).toEqual([]);
    expect(validateResourceHatches(def, built.units, built.hatches)).toEqual([]);
    expect(built.hatches.filter((h) => h.kind === 'fluidOut')).toHaveLength(4);
    expect(built.hatches.filter((h) => h.kind === 'dynamo')).toHaveLength(4);
    expect(built.hatches.filter((h) => h.kind === 'muffler')).toHaveLength(4);
    for (const [kind, low, high] of [
      ['fluidIn', 'EV', 'IV'],
      ['fluidOut', 'EV', 'IV'],
      ['muffler', 'EV', 'IV'],
      ['dynamo', 'HV', 'EV'],
    ] as const) {
      const hatch = built.hatches.find((h) => h.kind === kind)!;
      const withTier = (tier: typeof low | typeof high) =>
        built.hatches.map((h) => (h === hatch ? { ...h, tier } : h));
      expect(
        validateResourceHatches(def, built.units, withTier(low)).some((e) => e.includes(`${kind} tier`)),
      ).toBe(true);
      expect(
        validateResourceHatches(def, built.units, withTier(high)).some((e) => e.includes(`${kind} tier`)),
      ).toBe(false);
    }
    const badDynamo = built.hatches.map((h) => (h.kind === 'dynamo' ? { ...h, tier: 'ZPM' as const } : h));
    expect(
      validateResourceHatches(def, built.units, badDynamo).some((e) => e.includes('dynamo tier ZPM')),
    ).toBe(true);
    expect(
      validateResourceHatches(
        def,
        built.units,
        built.hatches
          .filter((h) => h.kind !== 'fluidOut')
          .concat(built.hatches.filter((h) => h.kind === 'fluidOut').slice(0, 3)),
      ),
    ).toContain('Controller 0: fluidOut count 3; requires 4–unlimited.');
  });
});
