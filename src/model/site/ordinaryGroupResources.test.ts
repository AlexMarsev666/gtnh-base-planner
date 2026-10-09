import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import type { HatchKind, Unit } from '../multiblock/types';
import { buildGroup, defaultGroupHatches, type Demand } from './group';
import type { ResourceBinding } from './types';
import { placeResourceHatches, validateResourceHatches } from './resourcePlacement';

const examples: { id: string; demand: Demand; bindings?: ResourceBinding[] }[] = [
  {
    id: 'pyrolyse-oven',
    demand: { itemIn: ['wood'], fluidIn: ['nitrogen'], itemOut: ['charcoal'], fluidOut: ['gas'] },
  },
  {
    id: 'electric-blast-furnace',
    demand: { itemIn: ['dust', 'additive'], fluidIn: ['nitrogen'], itemOut: ['ingot'] },
  },
  {
    id: 'distillation-tower',
    demand: { fluidIn: ['oil'], fluidOut: ['light-fraction', 'heavy-fraction'] },
    bindings: [
      { kind: 'fluidOut', resource: 'light-fraction', role: 'product', outputSlot: 0 },
      { kind: 'fluidOut', resource: 'heavy-fraction', role: 'product', outputSlot: 1 },
    ],
  },
];

describe('ordinary groups retain a complete resource set per machine', () => {
  for (const example of examples) {
    const def = getMultiblock(example.id)!;
    const settings = { voltageTier: 'HV' as const, resourceBindings: example.bindings };
    for (const count of [1, 4])
      it(`${example.id}, ${count} machines: covers every resource on every controller`, () => {
        const built = buildGroup(
          def,
          count,
          { x: null, y: null, z: null },
          defaultGroupHatches(def),
          example.demand,
          true,
          {},
          settings,
        );
        expect(built.units).toHaveLength(count);
        expect(built.missing).toEqual([]);
        expect(built.unplaced).toEqual([]);
        expect(built.capacityProblems).toBeUndefined();
        for (const unit of built.units)
          for (const [kind, resources] of Object.entries(example.demand))
            for (const resource of resources!)
              expect(
                built.hatches.some(
                  (h) => h.kind === kind && h.resource === resource && h.unitIds.includes(unit.id),
                ),
                `${unit.id}: ${kind}/${resource}`,
              ).toBe(true);
        expect(
          validateResourceHatches(built.def, built.units, built.hatches, settings, example.demand),
        ).toEqual([]);
      });

    it(`${example.id}: separate machines get their own hatches and missing local coverage is rejected`, () => {
      const units: Unit[] = Array.from({ length: 4 }, (_, id) => ({
        id,
        origin: [id * (def.size[0] + 3), 0, 0],
        rotation: 0,
      }));
      const enabled = [
        ...new Set([...defaultGroupHatches(def), ...(Object.keys(example.demand) as HatchKind[])]),
      ];
      const result = placeResourceHatches(def, units, enabled, example.demand, settings, true, {});
      expect(result.unplaced).toEqual([]);
      for (const unit of units)
        for (const [kind, resources] of Object.entries(example.demand))
          for (const resource of resources!)
            expect(
              result.hatches.some(
                (h) =>
                  h.kind === kind &&
                  h.resource === resource &&
                  h.unitIds.length === 1 &&
                  h.unitIds[0] === unit.id,
              ),
            ).toBe(true);
      expect(validateResourceHatches(def, units, result.hatches, settings, example.demand)).toEqual([]);
      const [kind, resources] = Object.entries(example.demand)[0];
      const resource = resources![0];
      const broken = result.hatches.map((h) =>
        h.kind === kind && h.resource === resource && h.unitIds.includes(0)
          ? { ...h, resource: undefined }
          : h,
      );
      expect(broken.some((h) => h.kind === kind && h.resource === resource)).toBe(true);
      expect(validateResourceHatches(def, units, broken, settings, example.demand)).toContain(
        `Controller 0: ${resource} needs an assigned ${kind} in the full resource set.`,
      );
    });
  }
});
