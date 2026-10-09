import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { buildGroup } from '../site/group';
import { validateResourceHatches } from '../site/resourcePlacement';
import { unitCells } from '../geometry';
import type { HatchKind } from './types';
import type { ResourceBinding, ResourceRole } from '../site/types';
import { emptySite, siteFromJson, siteToJson } from '../../share/siteCodec';
import { withGroupAdded } from '../../ui/siteActions';
import { withStructureGlass } from './glass';

describe('RC2 dedicated hatches and ordinary resource lists', () => {
  const cases: { id: string; counts: Partial<Record<HatchKind, number>>; bindings: ResourceBinding[] }[] = [
    {
      id: 'high-temperature-gas-cooled-reactor',
      counts: { fluidIn: 3, fluidOut: 2, itemIn: 1, itemOut: 1 },
      bindings: [
        { kind: 'fluidIn', resource: 'helium', role: 'helium' },
        { kind: 'fluidIn', resource: 'coolant', role: 'coolant' },
        { kind: 'fluidIn', resource: 'water', role: 'water' },
        { kind: 'fluidOut', resource: 'hotCoolant', role: 'hotFluid' },
        { kind: 'fluidOut', resource: 'steam', role: 'steam' },
      ],
    },
    {
      id: 'large-heat-exchanger',
      counts: { fluidIn: 2, fluidOut: 2 },
      bindings: [
        { kind: 'fluidIn', resource: 'hot', role: 'hotFluid' },
        { kind: 'fluidIn', resource: 'water', role: 'water' },
        { kind: 'fluidOut', resource: 'cooled', role: 'coldFluid' },
        { kind: 'fluidOut', resource: 'steam', role: 'steam' },
      ],
    },
    {
      id: 'target-chamber',
      counts: { itemIn: 2, itemOut: 1 },
      bindings: [
        { kind: 'itemIn', resource: 'mask', role: 'mask' },
        { kind: 'itemIn', resource: 'target', role: 'feed' },
      ],
    },
    {
      id: 'extreme-heat-exchanger',
      counts: { fluidIn: 2, fluidOut: 2 },
      bindings: [
        { kind: 'fluidIn', resource: 'hot', role: 'hotFluid' },
        { kind: 'fluidIn', resource: 'water', role: 'water' },
        { kind: 'fluidOut', resource: 'cooled', role: 'coldFluid' },
        { kind: 'fluidOut', resource: 'steam', role: 'steam' },
      ],
    },
    {
      id: 'ph-neutralization-purification-unit',
      counts: { itemIn: 1, fluidIn: 2, fluidOut: 1 },
      bindings: [
        { kind: 'itemIn', resource: 'sodium', role: 'alkaline' },
        { kind: 'fluidIn', resource: 'acid', role: 'acid' },
        { kind: 'fluidIn', resource: 'water', role: 'water' },
        { kind: 'fluidOut', resource: 'product', role: 'product' },
      ],
    },
    {
      id: 'extreme-temperature-fluctuation-purification-unit',
      counts: { fluidIn: 3, fluidOut: 1 },
      bindings: [
        { kind: 'fluidIn', resource: 'coolant', role: 'coolant' },
        { kind: 'fluidIn', resource: 'plasma', role: 'plasma' },
        { kind: 'fluidIn', resource: 'water', role: 'water' },
        { kind: 'fluidOut', resource: 'product', role: 'product' },
      ],
    },
  ];
  for (const test of cases) {
    const original = getMultiblock(test.id)!;
    const def = test.id === 'target-chamber' ? withStructureGlass(original, 'LuV') : original;
    const limits = { x: 1, y: 1, z: 1 };
    it(`${test.id}: requires dedicated and ordinary hatches independently`, () => {
      const built = buildGroup(def, 1, limits, def.defaultHatches, {}, true, {}, { voltageTier: 'LV' });
      expect(built.unplaced).toEqual([]);
      expect(validateResourceHatches(def, built.units, built.hatches, {})).toEqual([]);
      for (const [kind, count] of Object.entries(test.counts)) {
        expect(built.hatches.filter((h) => h.kind === kind)).toHaveLength(count!);
        const regions = def.requiredHatches?.[kind as HatchKind]?.regions ?? [];
        for (const region of regions) {
          const cells = new Set(
            unitCells(def, built.units[0])
              .filter((c) => def.legend[c.char]?.region === region)
              .map((c) => c.pos.join()),
          );
          const removed = built.hatches.filter((h) => h.kind !== kind || !cells.has(h.cell.join()));
          expect(validateResourceHatches(def, built.units, removed, {}).some((e) => e.includes(region))).toBe(
            true,
          );
        }
      }
    });
    it(`${test.id}: assigns resource roles before selecting cells and rejects swapped roles`, () => {
      const demand: Partial<Record<HatchKind, string[]>> = {};
      for (const b of test.bindings) (demand[b.kind] ??= []).push(b.resource);
      const settings = { voltageTier: 'LV' as const, resourceBindings: test.bindings };
      const built = buildGroup(def, 1, limits, def.defaultHatches, demand, true, {}, settings);
      expect(built.unplaced).toEqual([]);
      expect(built.missing).toEqual([]);
      expect(validateResourceHatches(def, built.units, built.hatches, settings)).toEqual([]);
      const inputKind = test.bindings.some((r) => r.kind === 'fluidIn') ? 'fluidIn' : 'itemIn';
      const [a, b] = test.bindings.filter((r) => r.kind === inputKind);
      const swapped = built.hatches.map((h) => ({
        ...h,
        resource:
          h.resource === a.resource ? b.resource : h.resource === b.resource ? a.resource : h.resource,
      }));
      expect(
        validateResourceHatches(def, built.units, swapped, settings).some((e) =>
          e.includes('must use region'),
        ),
      ).toBe(true);
      const unknown = buildGroup(
        def,
        1,
        limits,
        def.defaultHatches,
        { [inputKind]: ['unknown'] },
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(unknown.missing).toContainEqual({ kind: inputKind, resource: 'unknown', unitId: 0 });
    });
  }
  it('keeps new roles in version 2 JSON and still rejects unknown role values', () => {
    const site = withGroupAdded(emptySite(), cases[0].id);
    site.groups[0].resourceBindings = structuredClone(cases[0].bindings);
    expect(siteFromJson(siteToJson(site)).groups[0].resourceBindings).toEqual(cases[0].bindings);
    site.groups[0].resourceBindings[0].role = 'unverified' as ResourceRole;
    expect(() => siteFromJson(siteToJson(site))).toThrow(/Invalid resource role/);
  });
  it('keeps HTGCR source c/w and h/s in their distinct physical cells', () => {
    const def = getMultiblock('high-temperature-gas-cooled-reactor')!;
    for (const [x, y, z, region] of [
      [12, 3, 10, 'coolantIn'],
      [0, 8, 10, 'water'],
      [9, 14, 10, 'coolantOut'],
      [0, 3, 10, 'steam'],
    ] as const)
      expect(def.legend[def.layers[y][z][x]].region).toBe(region);
    const heliumCells = unitCells(def, { id: 0, origin: [0, 0, 0], rotation: 0 }).filter(
      (c) => def.legend[c.char]?.region === 'helium',
    );
    expect(heliumCells.map((c) => c.pos)).toEqual([
      [10, 2, 6],
      [11, 2, 6],
      [12, 2, 6],
    ]);
    expect(heliumCells.every((c) => c.hatches?.join() === 'fluidIn,energy,maintenance')).toBe(true);
    const site = withGroupAdded(emptySite(), def.id);
    site.groups[0].resourceBindings = cases[0].bindings;
    expect(siteFromJson(siteToJson(site)).groups[0].resourceBindings).toEqual(cases[0].bindings);
  });
  it('Large Heat Exchanger keeps twenty counted titanium casings independently of mandatory centres', () => {
    const def = getMultiblock('large-heat-exchanger')!;
    const unit = { id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const };
    const hatches = unitCells(def, unit)
      .filter((c) => c.blockId === 'gt.casing.stableTitanium')
      .slice(0, 12)
      .map((c) => ({ kind: 'fluidIn' as const, cell: c.pos, face: 'north' as const, unitIds: [0] }));
    expect(
      validateResourceHatches(def, [unit], hatches, {}).some((e) =>
        e.includes('19 casings; RC2 requires at least 20'),
      ),
    ).toBe(true);
  });
});
