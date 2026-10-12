import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../data/catalog';
import zonesFile from '../data/hatch-zones.generated.json';
import { flipCells, mirrorCellKey, mirrorCells, mirroredDef, orientedDef, variantOfDef } from './mirror';
import { resizeSteps, sizedDef } from './resize';
import type { MultiblockDef } from './multiblock/types';

const charAt = (def: MultiblockDef, [x, y, z]: readonly number[]) => [...(def.layers[y]?.[z] ?? '')][x];

describe('mirroredDef', () => {
  it('reverses every row, mirrors the controller and swaps east and west', () => {
    const def: MultiblockDef = {
      ...getMultiblock('coke-oven')!,
      size: [3, 1, 1],
      layers: [['A~B']],
      legend: {
        A: {
          blockId: 'a',
          hatches: ['itemIn'],
          disallowFaces: { itemIn: ['east', 'up'] },
          allowFaces: { itemIn: ['east', 'north'] },
        },
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
    expect(m.legend.A.allowFaces).toEqual({ itemIn: ['west', 'north'] });
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

describe('orientedDef', () => {
  const variants = [0, 1, 2, 3] as const;

  it('is memoised, 0 is the def itself, 1 is mirroredDef and every variant is its own inverse', () => {
    for (const def of catalog) {
      expect(orientedDef(def, 0)).toBe(def);
      expect(orientedDef(def, 1)).toBe(mirroredDef(def));
      for (const v of variants) {
        const o = orientedDef(def, v);
        expect(orientedDef(def, v)).toBe(o);
        expect(orientedDef(o, v), `${def.id} ${v}`).toBe(def);
        expect(variantOfDef(o)).toBe(v);
      }
      expect(orientedDef(orientedDef(def, 1), 3)).toBe(orientedDef(def, 2));
      expect(orientedDef(orientedDef(def, 2), 1)).toBe(orientedDef(def, 3));
    }
  });

  it('flips layers and the controller in Y, and swaps up and down in the face restrictions', () => {
    const def: MultiblockDef = {
      ...getMultiblock('coke-oven')!,
      size: [3, 2, 1],
      layers: [['A~B'], ['BBB']],
      legend: {
        A: { blockId: 'a', hatches: ['itemIn'], disallowFaces: { itemIn: ['up', 'east'] } },
        B: { blockId: 'b', allowFaces: { itemIn: ['down', 'north'] } },
      },
      controller: { pos: [1, 0, 0], facing: 'east', blockId: 'c' },
      resize: undefined,
    };
    const f = orientedDef(def, 3);
    expect(f.layers).toEqual([['BBB'], ['A~B']]);
    expect(f.controller.pos).toEqual([1, 1, 0]);
    expect(f.controller.facing).toBe('east');
    expect(f.legend.A.disallowFaces).toEqual({ itemIn: ['down', 'east'] });
    expect(f.legend.B.allowFaces).toEqual({ itemIn: ['up', 'north'] });
    const r = orientedDef(def, 2);
    expect(r.layers).toEqual([['BBB'], ['B~A']]);
    expect(r.controller).toMatchObject({ pos: [1, 1, 0], facing: 'west' });
    expect(r.legend.A.disallowFaces).toEqual({ itemIn: ['down', 'west'] });
  });

  it('puts the controller on its cell in every variant', () => {
    for (const def of catalog)
      for (const v of variants) {
        const o = orientedDef(def, v);
        expect(charAt(o, o.controller.pos), `${def.id} ${v}`).toBe('~');
      }
  });

  it('composes with sizedDef in either order (same structure)', () => {
    const at = (d: MultiblockDef, p: number[]) => {
      const ch = charAt(d, p);
      if (ch === '~' || ch === ' ' || ch === '-') return ch;
      const { region: _region, ...entry } = d.legend[ch];
      return entry;
    };
    for (const def of catalog.filter((d) => d.resize))
      for (const v of variants)
        for (const n of resizeSteps(def.resize!)) {
          const a = orientedDef(sizedDef(def, n), v);
          const b = sizedDef(orientedDef(def, v), n);
          const what = `${def.id} ${v} ${n}`;
          expect(a.size, what).toEqual(b.size);
          expect(a.controller, what).toEqual(b.controller);
          expect(a.resize, what).toEqual(b.resize);
          // Region names of slab copies may count from the other end (a Y-flipped tower).
          for (let y = 0; y < a.size[1]; y++)
            for (let z = 0; z < a.size[2]; z++)
              for (let x = 0; x < a.size[0]; x++)
                expect(at(a, [x, y, z]), `${what} ${x},${y},${z}`).toEqual(at(b, [x, y, z]));
        }
  });

  it('flips the slab of a Y-axis resize rule', () => {
    const tower = getMultiblock('distillation-tower')!;
    const { axis, min, from, to } = tower.resize!;
    expect(axis).toBe('y');
    expect(orientedDef(tower, 3).resize).toMatchObject({ from: min - to, to: min - from });
    expect(orientedDef(tower, 1).resize).toEqual(tower.resize);
    expect(orientedDef(tower, 2).resize).toEqual(orientedDef(tower, 3).resize);
  });

  it('flips the zone cells with the structure', () => {
    const cells = { '1,0,2': 'dot1' };
    expect(flipCells(cells, [4, 3, 5], false, true)).toEqual({ '1,2,2': 'dot1' });
    expect(flipCells(cells, [4, 3, 5], true, true)).toEqual({ '2,2,2': 'dot1' });
  });
});
