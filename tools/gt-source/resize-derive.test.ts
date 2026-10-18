import { describe, expect, it } from 'vitest';
import type { MultiblockDef } from '../../src/model/multiblock/types';
import { sizedDef } from '../../src/model/resize';
import { deriveResize, withResize } from './resize-derive.mjs';

type Form = Parameters<typeof deriveResize>[0][number];
const legend = {
  A: { blockId: 'casing' },
  B: { blockId: 'casing', hatches: ['itemIn'], region: 'dot1' },
  G: { blockId: 'glass@0' },
};
/** A column along y: floor, `n` middle layers, roof; the controller in the floor's front row. */
const column = (n: number, glass = 'G', extra: Record<string, unknown> = {}): Form =>
  ({
    size: [1, 2 + n, 2],
    layers: [['A', '~'], ...Array.from({ length: n }, () => ['B', glass]), ['A', 'A']],
    legend: { ...legend, ...extra },
    controller: { pos: [0, 0, 1], facing: 'south', blockId: 'ctrl' },
  }) as Form;

describe('deriveResize', () => {
  it('finds the slab that expands to every form', () => {
    const r = deriveResize([column(1), column(2), column(3), column(4)]);
    expect(r.rule).toEqual({ axis: 'y', from: 1, to: 2, min: 3, max: 6, default: 3, label: 'height' });
  });

  it('takes the maximum from the tooltip, shifted by what the box counts more, in whole slabs', () => {
    const tooltip = { min: [1, 2, 2], max: [1, 9, 2] } as Parameters<typeof deriveResize>[1];
    const r = deriveResize([column(1), column(2)], tooltip);
    // The box is one above the tooltip's minimum (3 against 2): 9 + 1 = 10.
    expect(r.rule?.max).toBe(10);
    expect(r.rule?.default).toBe(r.rule?.min);
  });

  it('treats a tiered block that changes everywhere as the same structure', () => {
    const forms = [
      column(1),
      column(2, 'T', { T: { blockId: 'glass@1' } }),
      column(3, 'U', { U: { blockId: 'glass@2' } }),
    ];
    expect(deriveResize(forms).rule?.max).toBe(5);
  });

  it('rejects forms that differ somewhere a slab cannot reproduce', () => {
    const odd = column(3);
    odd.layers = odd.layers.map((l, y) => (y === 2 ? ['A', 'A'] : l));
    expect(deriveResize([column(1), column(2), odd]).why).toMatch(/no 1-wide slab/);
  });

  it('rejects forms that grow on two axes, or only one form', () => {
    const wide = {
      ...column(1),
      size: [2, 4, 2],
      layers: column(2).layers.map((l) => l.map((r) => r + r)),
    } as Form;
    expect(deriveResize([column(1), wide]).why).toMatch(/2 axes/);
    expect(deriveResize([column(1)]).why).toMatch(/one dumped form/);
  });

  it('leaves out a last form that is the sweep clamped to the tooltip maximum', () => {
    // Slabs of two layers: sizes 4, 6, 8, and a form of 9 (the tooltip's maximum, 9, in the box's frame: 8 + 1).
    const tooltip = { min: [1, 3, 2], max: [1, 9, 2] } as Parameters<typeof deriveResize>[1];
    const r = deriveResize([column(2), column(4), column(6), column(7)], tooltip);
    expect(r.rule).toMatchObject({ from: 1, to: 3, min: 4, max: 10 });
    expect(r.note).toMatch(/clamped/);
  });
});

describe('withResize', () => {
  const rule = { axis: 'y', from: 1, to: 2, min: 3, max: 5, default: 3, label: 'height' } as const;
  const stacked = (): Form => {
    const def = column(1);
    // `B` (a region) also stands outside the slab, in the roof.
    def.layers = [
      ['A', '~'],
      ['B', 'G'],
      ['B', 'A'],
    ];
    return def;
  };

  it('gives the cells of a counted region inside the slab a key of their own', () => {
    const def = { ...stacked(), requiredHatches: { itemIn: { min: 1, regions: ['dot1'] } } };
    const out = withResize(def, rule, ['a', 'b']);
    expect(out.layers).toEqual([
      ['A', '~'],
      ['a', 'G'],
      ['B', 'A'],
    ]);
    expect(out.legend.a).toEqual(def.legend.B);
    expect(Object.keys(out)).toEqual(['size', 'layers', 'legend', 'controller', 'resize', 'requiredHatches']);
  });

  it('leaves a zone-only region alone: it keeps its name in every copy', () => {
    const def = stacked();
    const out = withResize(def, rule, ['a', 'b']);
    expect(out.layers).toEqual(def.layers);
    const grown = sizedDef({ ...out, resize: rule } as unknown as MultiblockDef, 5);
    expect(grown.size[1]).toBe(5);
    expect(Object.values(grown.legend).filter((e) => e.region === 'dot1')).toHaveLength(1);
  });
});
