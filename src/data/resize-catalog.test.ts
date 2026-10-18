import { describe, expect, it } from 'vitest';
import { zoneTakesKind } from '../model/hatches/zones';
import { effectiveSize, resizeSteps, sizedDef } from '../model/resize';
import { catalog } from './catalog';

/**
 * Generated entries get `resize` from the forms the game dump holds (tools/gt-source/resize-derive.mjs, which checks
 * that `sizedDef` reproduces every dumped form cell for cell). The dump is not in the repository, so this checks
 * what is left: the set of entries, that the default is the smallest form, and that every size builds a whole box.
 */
const RESIZABLE = [
  'advanced-assembly-line',
  'circuit-assembly-line',
  'dangote-distillus',
  'lapotronic-supercapacitor',
  'manual-transformer',
  'mega-distillation-tower',
  'neutron-activator',
  'quantum-computer',
  'static-network-switch-with-qos',
  'tfft',
  'yottank',
];

describe('resizable generated entries', () => {
  const resizable = catalog.filter((d) => d.generated && d.resize);

  it('are the ones whose dumped forms one repeating slab reproduces', () => {
    expect(resizable.map((d) => d.id).sort()).toEqual(RESIZABLE);
  });

  for (const def of resizable) {
    it(`${def.id}: starts at its smallest form and builds every size`, () => {
      const rule = def.resize!;
      const a = { x: 0, y: 1, z: 2 }[rule.axis];
      expect(rule.default).toBe(rule.min);
      expect(def.size[a]).toBe(rule.min);
      const steps = resizeSteps(rule);
      expect(effectiveSize(def, undefined)).toBe(rule.min);
      // The ends and a middle size are enough: the expansion is the same code at every size.
      for (const n of [
        ...new Set([steps[0], steps[Math.floor(steps.length / 2)], steps[steps.length - 1]]),
      ]) {
        const sized = sizedDef(def, n);
        expect(sized.size[a]).toBe(n);
        expect(sized.layers).toHaveLength(sized.size[1]);
        for (const layer of sized.layers) {
          expect(layer).toHaveLength(sized.size[2]);
          for (const row of layer) expect([...row]).toHaveLength(sized.size[0]);
        }
        const ctrl = sized.layers[sized.controller.pos[1]][sized.controller.pos[2]];
        expect([...ctrl][sized.controller.pos[0]]).toBe('~');
      }
    });
  }

  it('keep every hatch zone on its cells at the larger sizes (the zone regions are not renamed per copy)', () => {
    for (const id of ['dangote-distillus', 'quantum-computer', 'tfft', 'static-network-switch-with-qos']) {
      const def = catalog.find((d) => d.id === id)!;
      const big = sizedDef(def, def.resize!.max);
      expect(Object.keys(def.zones ?? {}).length, id).toBeGreaterThan(0);
      for (const [region, zone] of Object.entries(def.zones!)) {
        const cells = big.layers
          .flat()
          .flatMap((row) => [...row].filter((ch) => big.legend[ch]?.region === region));
        expect(cells.length, `${id} ${region}`).toBeGreaterThan(0);
        for (const kind of zone.kinds)
          expect(zoneTakesKind(big, region, kind), `${id} ${region} ${kind}`).toBe(true);
      }
    }
  });

  it('need as many hatches as GT counts at the largest size (one per layer or slice)', () => {
    const at = (id: string, kind: 'itemIn' | 'fluidOut') => {
      const def = catalog.find((d) => d.id === id)!;
      return sizedDef(def, def.resize!.max).requiredHatches?.[kind];
    };
    // Tooltip ranges: Dangote 2-11, Mega Distillation Tower 3-11, Advanced Assembly Line 5-16, CAL 1-6.
    expect(at('dangote-distillus', 'fluidOut')).toEqual({ min: 11, max: 11 });
    expect(at('mega-distillation-tower', 'fluidOut')).toEqual({ min: 11, max: 11 });
    expect(at('advanced-assembly-line', 'itemIn')).toEqual({ min: 16, max: 16 });
    expect(at('circuit-assembly-line', 'itemIn')).toEqual({ min: 6, max: 6 });
    for (const def of resizable)
      expect(JSON.stringify(sizedDef(def, def.resize!.max).requiredHatches), def.id).not.toContain('perSlab');
  });
});
