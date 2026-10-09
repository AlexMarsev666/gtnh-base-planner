import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import type { MultiblockDef, Unit } from './types';
import { casingRules } from './rules';
import { casingAllowance, validateCasings } from './casingConstraints';

// Independently transcribed checkCasingMin literals in the pinned RC2 controller sources.
const minimums: Record<string, number[]> = {
  'absolute-baryonic-perfection-purification-unit': [300],
  'active-transformer': [5],
  'algae-farm': [20],
  'alloy-blast-smelter': [3],
  'big-barrel-brewery': [14],
  'bio-vat': [19],
  'dangote-distillus': [7],
  'density-2': [50],
  digester: [40],
  'dissection-apparatus': [45],
  'dissolution-tank': [30],
  'draconic-evolution-fusion-crafter': [19],
  'electric-implosion-compressor': [230],
  'endothermic-fridge': [750],
  'exothermic-hearth': [1800],
  'exxonmobil-chemical-plant': [70],
  'extreme-entity-crusher': [35],
  'extreme-heat-exchanger': [25],
  'extreme-temperature-fluctuation-purification-unit': [50],
  'flocculation-purification-unit': [56],
  'hot-isostatic-pressurization-unit': [95],
  'hyper-intensity-laser-engraver': [35],
  'implosion-compressor': [16],
  'industrial-3d-copying-machine': [40],
  'industrial-arc-furnace': [10],
  'industrial-autoclave': [128],
  'industrial-bending-machine': [4],
  'industrial-centrifuge': [6],
  'industrial-coke-oven': [35],
  'industrial-electrolyzer': [6],
  'industrial-extrusion-machine': [3, 8],
  'industrial-forming-press': [5],
  'industrial-mixing-machine': [5],
  'industrial-precision-lathe': [42],
  'industrial-sledgehammer': [10],
  'industrial-wire-factory': [14],
  'infinite-fluid-drilling-rig': [90],
  'l-a-t-e-x': [14],
  'large-chemical-reactor': [8],
  'large-electric-compressor': [95],
  'large-molecular-assembler': [24],
  'large-naquadah-reactor': [130],
  'matter-fabrication-cpu': [35],
  'mega-distillation-tower': [150],
  'mega-oil-cracker': [145],
  'neutron-activator': [7],
  'neutronium-compressor': [220],
  'nuclear-salt-processing-plant': [1],
  'oil-cracking-unit': [18],
  'ozonation-purification-unit': [96],
  'pseudostable-black-hole-containment-field': [950],
  'pyrolyse-oven': [60],
  'residual-decontaminant-degasser-purification-unit': [780],
  'reactor-fuel-processing-plant': [7],
  'sparge-tower-controller': [45],
  'thermal-boiler': [10],
  'thorium-reactor-lftr': [27],
  'turbocan-pro': [85],
  'universal-chemical-fuel-engine': [100],
  'utupu-tanuri': [4],
  'vacuum-freezer': [16],
  'water-pump': [9],
};
const unit: Unit = { id: 42, origin: [0, 0, 0], rotation: 0 };

describe('RC2 counted casing constraints', () => {
  for (const id of [
    'industrial-sledgehammer',
    'thorium-reactor-lftr',
    'hot-isostatic-pressurization-unit',
    'large-electric-compressor',
    'ozonation-purification-unit',
  ]) {
    it(`${id}: ignores fixed decoration made of the same counted block`, () => {
      const original = getMultiblock(id)!;
      const [rule] = casingRules(original);
      expect(rule.hatchableOnly).toBe(true);
      const row = '~' + 'C'.repeat(rule.min) + 'D'.repeat(10);
      const def: MultiblockDef = {
        ...original,
        size: [row.length, 1, 1],
        layers: [[row]],
        legend: { C: { blockId: rule.blocks[0], hatches: ['itemIn'] }, D: { blockId: rule.blocks[0] } },
        controller: { ...original.controller, pos: [0, 0, 0] },
      };
      expect(validateCasings(def, [unit], [])).toEqual([]);
      const hatch = {
        cell: [1, 0, 0] as [number, number, number],
        unitIds: [42],
        kind: 'itemIn' as const,
        face: 'north' as const,
      };
      expect(validateCasings(def, [unit], [hatch])).toHaveLength(1);
      expect(casingAllowance(def, [unit]).canReplace(hatch.cell, hatch.unitIds)).toBe(false);
    });
  }

  for (const [id, expected] of Object.entries(minimums)) {
    it(`${id}: accepts each counter's minimum and rejects one less`, () => {
      const original = getMultiblock(id)!;
      const rules = casingRules(original);
      expect(rules.map((rule) => rule.min)).toEqual(expected);
      // Isolate physical counting from hatch prerequisites and default shapes. Each block counter
      // gets exactly its independently known minimum; a hatch in it removes one counted casing.
      const legend: MultiblockDef['legend'] = {};
      let row = '~';
      expected.forEach((n, i) => {
        const char = String.fromCharCode(65 + i);
        legend[char] = { blockId: rules[i].blocks[0], hatches: ['itemIn'] };
        row += char.repeat(n);
      });
      const def: MultiblockDef = {
        ...original,
        size: [row.length, 1, 1],
        layers: [[row]],
        legend,
        controller: { ...original.controller, pos: [0, 0, 0] },
      };
      expect(validateCasings(def, [unit], [])).toEqual([]);
      let x = 1;
      for (const n of expected) {
        const hatch = {
          kind: 'itemIn' as const,
          cell: [x, 0, 0] as [number, number, number],
          face: 'north' as const,
          unitIds: [unit.id],
        };
        expect(validateCasings(def, [unit], [hatch])).toHaveLength(1);
        expect(casingAllowance(def, [unit]).canReplace(hatch.cell, hatch.unitIds)).toBe(false);
        x += n;
      }
    });
  }

  it('checks every controller containing a replaced shared physical casing', () => {
    const original = getMultiblock('vacuum-freezer')!;
    const def: MultiblockDef = {
      ...original,
      size: [18, 1, 1],
      layers: [['~' + 'C'.repeat(17)]],
      controller: { ...original.controller, pos: [0, 0, 0] },
    };
    const other = { ...unit, id: 99 };
    const allowance = casingAllowance(def, [unit, other]);
    expect(allowance.canReplace([1, 0, 0], [42, 99])).toBe(true);
    allowance.replace([1, 0, 0], [42, 99]);
    expect(allowance.canReplace([2, 0, 0], [42, 99])).toBe(false);
    allowance.replace([1, 0, 0], [42, 99], -1);
    expect(allowance.canReplace([2, 0, 0], [42, 99])).toBe(true);
    const hatches = [1, 2].map((x) => ({
      kind: 'itemIn' as const,
      cell: [x, 0, 0] as [number, number, number],
      face: 'north' as const,
      unitIds: [42],
    }));
    expect(validateCasings(def, [unit, other], hatches)).toHaveLength(2);
  });
});
