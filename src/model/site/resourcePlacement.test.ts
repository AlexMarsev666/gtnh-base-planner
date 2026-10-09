import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { unitCells } from '../geometry';
import { sizedDef } from '../resize';
import { buildGroup } from './group';
import { hatchAssignmentKey, placeResourceHatches, validateResourceHatches } from './resourcePlacement';
import type { MultiblockDef } from '../multiblock/types';

const limits = { x: null, y: 1, z: null };

describe('RC2 Mega Oil Cracker resource dispatch', () => {
  const settings = {
    voltageTier: 'HV' as const,
    resourceBindings: [
      { kind: 'fluidIn' as const, resource: 'oil', role: 'feed' as const },
      { kind: 'fluidIn' as const, resource: 'agent', role: 'catalyst' as const },
    ],
  };
  const build = (side: 'left' | 'right') =>
    buildGroup(
      getMultiblock('mega-oil-cracker')!,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['oil', 'agent'], fluidOut: ['product'] },
      true,
      {},
      { ...settings, crackingFeedSide: side },
    );

  it('uses exactly nine source cells for each reversible side and the middle', () => {
    const def = getMultiblock('mega-oil-cracker')!;
    const cells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 });
    for (const char of ['l', 'm', 'r']) expect(cells.filter((cell) => cell.char === char)).toHaveLength(9);
    expect(cells.filter((cell) => cell.char === 'm').every((cell) => cell.pos[1] === 6)).toBe(true);
    expect(cells.filter((cell) => cell.char === 'l').every((cell) => cell.pos[0] === 11)).toBe(true);
    expect(cells.filter((cell) => cell.char === 'r').every((cell) => cell.pos[0] === 1)).toBe(true);
  });

  for (const side of ['left', 'right'] as const)
    it(`routes the agent through the middle and the feed on the ${side}`, () => {
      const built = build(side);
      expect(built.missing).toEqual([]);
      expect(built.unplaced).toEqual([]);
      expect(validateResourceHatches(built.def, built.units, built.hatches, settings)).toEqual([]);
      expect(built.hatches.find((h) => h.resource === 'oil')!.cell[0]).toBe(side === 'left' ? 1 : 11);
      expect(built.hatches.find((h) => h.resource === 'product')!.cell[0]).toBe(side === 'left' ? 11 : 1);
      expect(built.hatches.find((h) => h.resource === 'agent')!.cell[1]).toBe(6);
      const misassigned = built.hatches.map((h) =>
        h.resource === 'oil'
          ? { ...h, resource: 'agent' }
          : h.resource === 'agent'
            ? { ...h, resource: 'oil' }
            : h,
      );
      expect(validateResourceHatches(built.def, built.units, misassigned, settings)).toContain(
        'Controller 0: agent must use region middle.',
      );
    });

  it('keeps an input with an unspecified role unresolved', () => {
    const def = getMultiblock('mega-oil-cracker')!;
    const built = buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['unknown'] },
      true,
      {},
      { voltageTier: 'HV' },
    );
    expect(built.missing).toContainEqual({ kind: 'fluidIn', resource: 'unknown', unitId: 0 });
    expect(
      validateResourceHatches(built.def, built.units, built.hatches, {
        resourceBindings: [{ kind: 'fluidIn', resource: 'unknown' }],
      }),
    ).toContain('Choose a structural role or output slot for unknown.');
  });
});

describe('RC2 resource-aware hatch placement', () => {
  it('keeps energy, maintenance and mandatory regions when resource demand exceeds casing capacity', () => {
    const raw = getMultiblock('oil-cracking-unit')!;
    const fluidIn = ['f1', 'f2', 'f3', 'f4', 'a1', 'a2'];
    const built = buildGroup(
      raw,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn, fluidOut: ['p1', 'p2', 'p3', 'p4'] },
      true,
      {},
      {
        resourceBindings: fluidIn.map((resource, i) => ({
          kind: 'fluidIn',
          resource,
          role: i < 4 ? 'feed' : 'catalyst',
        })),
      },
    );
    expect(built.hatches.filter((h) => h.kind === 'energy')).toHaveLength(1);
    expect(built.hatches.filter((h) => h.kind === 'maintenance')).toHaveLength(1);
    expect(built.hatches).toHaveLength(7);
    expect(built.unplaced).toHaveLength(5);
    expect(built.unplaced.every((h) => h.kind === 'fluidIn' || h.kind === 'fluidOut')).toBe(true);
    expect(validateResourceHatches(raw, built.units, built.hatches)).toEqual([]);
    expect(built.capacityProblems).toContainEqual(
      expect.stringMatching(/12 hatches required; structure capacity 7.*25.*18/),
    );
    const missingMaintenance = built.hatches.filter((h) => h.kind !== 'maintenance');
    expect(validateResourceHatches(raw, built.units, missingMaintenance)).toContain(
      'Controller 0: maintenance count 0; requires 1–unlimited.',
    );
  });
  it('backtracks beyond 150 assignments without a recursive frame for each hatch', () => {
    const def: MultiblockDef = {
      id: 'matching-conflict',
      name: 'Matching conflict',
      size: [4, 1, 1],
      layers: [['~XYZ']],
      legend: {
        X: { blockId: 'casing', hatches: ['itemIn', 'itemOut', 'fluidIn'] },
        Y: { blockId: 'casing', hatches: ['itemIn'] },
        Z: { blockId: 'casing', hatches: ['itemOut', 'fluidIn'] },
      },
      controller: { pos: [0, 0, 0], facing: 'north', blockId: 'controller' },
      hatchBlocks: { itemIn: 'in', itemOut: 'out', fluidIn: 'fluid' },
      shareableHatches: [],
      defaultHatches: [],
      wallshare: false,
    };
    const units = Array.from({ length: 51 }, (_, id) => ({
      id,
      origin: [id * 8, 0, 0] as [number, number, number],
      rotation: 0 as const,
    }));
    const result = placeResourceHatches(def, units, ['itemIn', 'itemOut', 'fluidIn'], {}, {}, false, {});
    expect(result.unplaced).toEqual([]);
    expect(result.hatches).toHaveLength(153);
    expect(result.hatches.filter((h) => h.kind === 'itemIn').every((h) => h.cell[0] % 8 === 2)).toBe(true);
  });
  for (const side of ['left', 'right'] as const)
    it(`supports the ${side} hydrocarbon side`, () => {
      const built = buildGroup(
        getMultiblock('oil-cracking-unit')!,
        1,
        limits,
        ['energy', 'maintenance'],
        { fluidIn: ['feed', 'agent'], fluidOut: ['product'] },
        true,
        {},
        {
          crackingFeedSide: side,
          resourceBindings: [
            { kind: 'fluidIn', resource: 'feed', role: 'feed' },
            { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
          ],
        },
      );
      expect(built.missing).toEqual([]);
      expect(built.hatches.find((h) => h.resource === 'feed')!.cell[0]).toBe(side === 'left' ? 0 : 4);
      expect(validateResourceHatches(built.def, built.units, built.hatches)).toEqual([]);
    });
  it('preserves two recipe output slots containing the same fluid', () => {
    const def = sizedDef(getMultiblock('distillation-tower')!, 5);
    const settings = {
      resourceBindings: [
        { kind: 'fluidOut' as const, resource: 'same-fluid', outputSlot: 0 },
        { kind: 'fluidOut' as const, resource: 'same-fluid', outputSlot: 3 },
      ],
    };
    const built = buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['feed'], fluidOut: ['same-fluid'] },
      true,
      {},
      settings,
    );
    expect(
      built.hatches
        .filter((h) => h.resource === 'same-fluid')
        .map((h) => h.cell[1])
        .sort(),
    ).toEqual([1, 4]);
    expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
    const missingTop = built.hatches.map((h) =>
      h.resource === 'same-fluid' && h.cell[1] === 4 ? { ...h, resource: undefined } : h,
    );
    expect(
      validateResourceHatches(def, built.units, missingTop, settings).some((message) =>
        message.includes('same-fluid needs an assigned fluidOut in region top'),
      ),
    ).toBe(true);
  });
  it('rejects a missing catalyst region even when the total number of input hatches is sufficient', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    const built = buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['feed', 'agent'], fluidOut: ['product'] },
      true,
      {},
      {
        resourceBindings: [
          { kind: 'fluidIn', resource: 'feed', role: 'feed' },
          { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
        ],
      },
    );
    const withoutMiddle = built.hatches.filter((h) => h.resource !== 'agent');
    withoutMiddle.push({ ...built.hatches.find((h) => h.resource === 'feed')!, resource: 'agent' });
    expect(validateResourceHatches(def, built.units, withoutMiddle)).toContain(
      'Controller 0: fluidIn is required in region middle.',
    );
    const missingOutputs = built.hatches.filter((h) => h.kind !== 'fluidOut');
    expect(
      validateResourceHatches(def, built.units, missingOutputs).some((message) =>
        message.includes('fluidOut count 0'),
      ),
    ).toBe(true);
  });
  it('places cracking agent in the middle and feed opposite the products, independent of names', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    const built = buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['unknown-a', 'unknown-b'], fluidOut: ['out'] },
      true,
      {},
      {
        voltageTier: 'HV',
        resourceBindings: [
          { kind: 'fluidIn', resource: 'unknown-a', role: 'feed' },
          { kind: 'fluidIn', resource: 'unknown-b', role: 'catalyst' },
        ],
      },
    );
    expect(built.unplaced).toEqual([]);
    expect(built.missing).toEqual([]);
    expect(validateResourceHatches(def, built.units, built.hatches)).toEqual([]);
    const region = (resource: string) => {
      const h = built.hatches.find((h) => h.resource === resource)!;
      const c = unitCells(def, built.units[0]).find((c) => c.pos.join() === h.cell.join())!;
      return def.legend[c.char].region;
    };
    expect(region('unknown-b')).toBe('middle');
    expect(region('unknown-a')).toBe('side');
    expect(built.hatches.find((h) => h.resource === 'unknown-a')!.cell[0]).not.toBe(
      built.hatches.find((h) => h.resource === 'out')!.cell[0],
    );
  });

  it('does not infer cracking roles from fluid display names', () => {
    const built = buildGroup(
      getMultiblock('oil-cracking-unit')!,
      1,
      limits,
      ['energy'],
      { fluidIn: ['Steam', 'Oil'] },
      true,
      {},
      {},
    );
    expect(built.missing.map((m) => m.resource)).toEqual(['Steam', 'Oil']);
    expect(built.hatches.some((h) => h.resource)).toBe(false);
  });

  it('binds tower outputs to recipe slots including the top instead of resource order', () => {
    const def = sizedDef(getMultiblock('distillation-tower')!, 5);
    const built = buildGroup(
      def,
      1,
      limits,
      ['energy', 'maintenance'],
      { fluidIn: ['feed'], fluidOut: ['top', 'bottom'] },
      true,
      {},
      {
        resourceBindings: [
          { kind: 'fluidOut', resource: 'top', outputSlot: 3 },
          { kind: 'fluidOut', resource: 'bottom', outputSlot: 0 },
        ],
      },
    );
    expect(built.missing).toEqual([]);
    expect(built.hatches.find((h) => h.resource === 'top')!.cell[1]).toBe(4);
    expect(built.hatches.find((h) => h.resource === 'bottom')!.cell[1]).toBe(1);
    expect(built.hatches.find((h) => h.resource === 'feed')!.cell[1]).toBe(0);
    expect(built.hatches.filter((h) => h.kind === 'fluidOut')).toHaveLength(4);
    expect(
      built.hatches.filter((h) => h.kind === 'fluidOut').every((h) => h.face !== 'up' && h.face !== 'down'),
    ).toBe(true);
  });

  it('accepts the RC2 tower layer adder fallback for vertical outputs while rejecting upper inputs', () => {
    const def = sizedDef(getMultiblock('distillation-tower')!, 5);
    const built = buildGroup(def, 1, limits, def.defaultHatches, {}, true, {}, { voltageTier: 'HV' });
    const output = built.hatches.find((h) => h.kind === 'fluidOut' && h.cell[1] === 2)!;
    expect(output).toBeDefined();
    for (const face of ['up', 'down'] as const) {
      const changed = built.hatches.map((h) => (h === output ? { ...h, face } : h));
      expect(validateResourceHatches(def, built.units, changed)).toEqual([]);
    }
    const bad = built.hatches.map((h) =>
      h.kind === 'fluidIn' ? { ...h, cell: output.cell, face: output.face } : h,
    );
    expect(validateResourceHatches(def, built.units, bad).some((e) => e.includes('is not allowed'))).toBe(
      true,
    );
  });

  it('uses persistent individual tiers and separates incompatible shared assignments', () => {
    const def = getMultiblock('electric-blast-furnace')!;
    const k = hatchAssignmentKey(0, 'itemIn', 'ore');
    const settings = { voltageTier: 'LV' as const, hatchTiers: { [k]: 'HV' as const } };
    const build = (x: number | null) =>
      buildGroup(
        def,
        2,
        { ...limits, x },
        ['energy', 'maintenance', 'muffler'],
        { itemIn: ['ore'], itemOut: ['metal'] },
        true,
        {},
        settings,
      );
    for (const result of [build(1), build(2)]) {
      expect(result.missing).toEqual([]);
      const individual = result.hatches.find((h) => h.assignments?.includes(k))!;
      expect(individual.tier).toBe('HV');
      expect(individual.unitIds).toEqual([0]);
      expect(result.hatches.find((h) => h.kind === 'itemIn' && h.unitIds.includes(1))!.tier).toBe('LV');
    }
  });
});
