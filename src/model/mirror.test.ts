import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../data/catalog';
import zonesFile from '../data/hatch-zones.generated.json';
import { mirrorCellKey, mirrorCells, mirroredDef } from './mirror';
import { resizeSteps, sizedDef } from './resize';
import type { MultiblockDef } from './multiblock/types';

const charAt = (def: MultiblockDef, [x, y, z]: number[]) => [...(def.layers[y]?.[z] ?? '')][x];

describe('mirroredDef', () => {
  it('reverses every row, mirrors the controller and swaps east and west', () => {
    const def: MultiblockDef = {
      ...getMultiblock('coke-oven')!,
      size: [3, 1, 1],
      layers: [['A~B']],
      legend: {
        A: { blockId: 'a', hatches: ['itemIn'], disallowFaces: { itemIn: ['east', 'up'] } },
        B: { blockId: 'b' },
      },
      controller: { pos: [1, 0, 0], facing: 'east', blockId: 'c' },
      resize: undefined,
    };
    const m = mirroredDef(def);
    expect(m.layers).toEqual([['B~A']]);
    expect(m.controller.pos).toEqual([1, 0, 0]);
    expect(m.controller.facing).toBe('west');
    expect(m.legend.A.disallowFaces).toEqual({ itemIn: ['west', 'up'] });
    expect(m.size).toEqual([3, 1, 1]);
    expect(def.layers).toEqual([['A~B']]);
    const off = mirroredDef({ ...def, layers: [['~AB']], controller: { ...def.controller, pos: [0, 0, 0] } });
    expect(off.controller.pos).toEqual([2, 0, 0]);
  });

  it('keeps the facing of north and south controllers', () => {
    const def = getMultiblock('coke-oven')!;
    expect(def.controller.facing === 'north' || def.controller.facing === 'south').toBe(true);
    expect(mirroredDef(def).controller.facing).toBe(def.controller.facing);
  });

  it('is memoised and its own inverse', () => {
    for (const def of catalog) {
      const m = mirroredDef(def);
      expect(mirroredDef(def)).toBe(m);
      expect(mirroredDef(m)).toBe(def);
    }
  });

  it('puts the controller on the controller cell, and mirrors back to the original data', () => {
    for (const def of catalog) {
      const m = mirroredDef(def);
      const [x, y, z] = m.controller.pos;
      expect(charAt(m, [x, y, z]), def.id).toBe('~');
      expect(m.layers.map((l) => l.map((r) => [...r].reverse().join('')))).toEqual(def.layers);
    }
  });

  it('keeps regions and zones with their cells', () => {
    const def = catalog.find((d) => d.zones)!;
    const m = mirroredDef(def);
    expect(m.zones).toBe(def.zones);
    expect(m.legend).toEqual(
      expect.objectContaining(Object.fromEntries(Object.keys(def.legend).map((k) => [k, expect.anything()]))),
    );
    for (const [ch, entry] of Object.entries(def.legend)) expect(m.legend[ch].region).toBe(entry.region);
  });

  it('composes with sizedDef in either order (resizable entries)', () => {
    const resizable = catalog.filter((d) => d.resize);
    expect(resizable.map((d) => d.resize!.axis)).toContain('x');
    for (const def of resizable) {
      for (const n of resizeSteps(def.resize!)) {
        const a = mirroredDef(sizedDef(def, n));
        const b = sizedDef(mirroredDef(def), n);
        expect(a, `${def.id} at ${n}`).toEqual(b);
      }
    }
  });

  it('has no X-axis resize whose slab carries regions (their copies would be numbered the other way round)', () => {
    for (const def of catalog.filter((d) => d.resize?.axis === 'x')) {
      const { from, to } = def.resize!;
      def.layers.forEach((layer) =>
        layer.forEach((row) =>
          [...row].forEach((ch, x) => {
            if (x >= from && x < to) expect(def.legend[ch]?.region, def.id).toBeUndefined();
          }),
        ),
      );
    }
  });

  it('adjusts the slab of an X-axis resize rule', () => {
    const al = getMultiblock('assembly-line')!;
    expect(al.resize).toMatchObject({ axis: 'x', from: 1, to: 2, min: 5 });
    expect(mirroredDef(al).resize).toMatchObject({ axis: 'x', from: 3, to: 4, min: 5, max: al.resize!.max });
  });
});

describe('mirroring per-cell data', () => {
  it('mirrorCellKey flips x only', () => {
    expect(mirrorCellKey('0,2,3', 5)).toBe('4,2,3');
    expect(mirrorCellKey('4,0,0', 5)).toBe('0,0,0');
    expect(mirrorCells({ '1,0,2': 'dot1' }, 4)).toEqual({ '2,0,2': 'dot1' });
  });

  it('maps the listed zone cells of hand-made entries onto hatch cells of the mirrored entry', () => {
    const zones = zonesFile as Record<string, { cells: Record<string, string> }>;
    for (const [id, { cells }] of Object.entries(zones)) {
      const def = getMultiblock(id)!;
      const m = mirroredDef(def);
      for (const pos of Object.keys(mirrorCells(cells, def.size[0]))) {
        const ch = charAt(m, pos.split(',').map(Number));
        expect(m.legend[ch]?.hatches?.length, `${id} ${pos}`).toBeGreaterThan(0);
      }
    }
  });
});
