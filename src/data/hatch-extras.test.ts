import { describe, expect, it } from 'vitest';
import type { Dir } from '../model/core/types';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import { catalog, getMultiblock } from './catalog';
import snapshot from './hatch-extras.snapshot.json';
import { validateMultiblockDef } from './validate';

/**
 * `allowFaces`, `glassTierLimits` and the `dataAccess` hatch kind come from the structure definitions and checks of
 * each controller class (tools/gt-source/hatch-extras.mjs). The snapshot lists which catalog ids carry them: update it
 * together with the data (`node tools/gt-source/hatch-extras.mjs <GT5-Unofficial checkout> --write`).
 */
const faces = (def: MultiblockDef) =>
  Object.fromEntries(
    Object.entries(def.legend)
      .filter(([, e]) => e.allowFaces)
      .map(([ch, e]) => [ch, e.allowFaces]),
  );

describe('hatch sides, glass tier limits and data access hatches of the catalog', () => {
  it('lists the entries with allowFaces, and the sides each legend entry allows', () => {
    const have = Object.fromEntries(
      catalog.filter((d) => Object.keys(faces(d)).length).map((d) => [d.id, faces(d)]),
    );
    expect(have).toEqual(snapshot.allowFaces);
  });

  it('lists the entries with glassTierLimits', () => {
    const ids = catalog
      .filter((d) => d.glassTierLimits)
      .map((d) => d.id)
      .sort();
    expect(ids).toEqual(snapshot.glassTierLimits);
  });

  it('lists the entries with a data access hatch', () => {
    const ids = catalog
      .filter((d) => Object.values(d.legend).some((e) => e.hatches?.includes('dataAccess')))
      .map((d) => d.id)
      .sort();
    expect(ids).toEqual(snapshot.dataAccess);
  });

  it.each(
    catalog
      .filter((d) => d.glassTierLimits || d.requiredHatches?.dataAccess || faces(d))
      .map((d) => [d.id, d] as const),
  )('%s is valid', (_id, def) => {
    expect(validateMultiblockDef(def)).toEqual([]);
  });

  it('limits the tier of the energy hatches by the glass of the Mega Oil Cracker', () => {
    const def = getMultiblock('mega-oil-cracker')!;
    expect(def.glassTierLimits).toEqual({ chars: ['C'], kinds: ['energy'] });
    expect(def.legend.C.blockId).toBe('bartworks:BW_TieredGlass@0');
  });

  it("allows the Assembly Line's hatches only on the sides GT's structure names", () => {
    const al = getMultiblock('assembly-line')!;
    // Input hatches and the maintenance hatch face down, the data access hatch faces the front.
    expect(al.legend.b.allowFaces).toEqual({ fluidIn: ['down'], maintenance: ['down'] });
    expect(al.legend.d.allowFaces).toEqual({ dataAccess: ['north'] });
    // Energy hatches (up, front, back) are stated as disallowFaces, which is not repeated.
    expect(al.legend.e.allowFaces).toBeUndefined();
    expect(al.legend.e.disallowFaces).toEqual({ energy: ['west', 'east', 'down'] });
  });

  it('takes the data access hatch on the grate casings of the later slices of both Assembly Lines', () => {
    for (const id of ['assembly-line', 'advanced-assembly-line']) {
      const def = getMultiblock(id)!;
      expect(def.hatchBlocks.dataAccess, id).toBe('gt.hatch.dataAccess');
      // GT: `mDataAccessHatches.size() > 1` is an error, and none is needed.
      expect(def.requiredHatches?.dataAccess, id).toEqual({ min: 0, max: 1 });
      expect(def.defaultHatches, id).not.toContain('dataAccess');
      const chars = Object.entries(def.legend)
        .filter(([, e]) => e.hatches?.includes('dataAccess'))
        .map(([ch]) => ch);
      expect(chars, id).toHaveLength(1);
      expect(def.legend[chars[0]].allowFaces?.dataAccess, id).toEqual(['north']);
    }
  });

  it('keeps the plain grate casing of the first slice of the Advanced Assembly Line free of the data hatch', () => {
    const def = getMultiblock('advanced-assembly-line')!;
    // GT 'G' (ofBlock only) beside the controller is not the data access element 'd': a key of its own.
    expect(def.layers[2][2]).toBe('EEEEH');
    expect(def.legend.H).toEqual({ blockId: def.legend.E.blockId });
    expect(def.legend.E.hatches).toEqual(['dataAccess']);
  });

  it('gives both Assembly Lines the same sides per cell (an output bus may face any side on the last slice)', () => {
    for (const id of ['assembly-line', 'advanced-assembly-line'])
      for (const [ch, e] of Object.entries(getMultiblock(id)!.legend))
        expect(e.allowFaces?.itemOut, `${id} "${ch}"`).toBeUndefined();
  });

  it('narrows the Dangote Distillus rings to the sides of their own element', () => {
    const def = getMultiblock('dangote-distillus')!;
    // GT 'l' (rings) disallows UP and DOWN, 't' (top) only DOWN; they share a hint dot.
    expect(def.legend.B.allowFaces?.fluidOut).toEqual(['north', 'south', 'east', 'west']);
    expect(def.legend.D.allowFaces?.fluidOut).toEqual(['north', 'south', 'east', 'west', 'up']);
  });

  it('lets the top output hatches of the Distillation Tower face down (GT disallowOnly(UP))', () => {
    const def = getMultiblock('distillation-tower')!;
    expect(def.legend.t.disallowFaces).toEqual({ fluidOut: ['up'] });
    expect(def.legend.l.disallowFaces).toEqual({ fluidOut: ['up', 'down'] });
  });

  it('only lists hatch kinds and sides the legend entry can use, and leaves a side open', () => {
    const dirs: Dir[] = ['north', 'south', 'east', 'west', 'up', 'down'];
    for (const def of catalog)
      for (const [ch, entry] of Object.entries(def.legend))
        for (const [kind, list] of Object.entries(entry.allowFaces ?? {}) as [HatchKind, Dir[]][]) {
          const at = `${def.id} "${ch}" ${kind}`;
          expect(entry.hatches, at).toContain(kind);
          expect(list.length, at).toBeGreaterThan(0);
          expect(list.length, at).toBeLessThan(dirs.length);
          expect(new Set(list).size, at).toBe(list.length);
          const blocked = entry.disallowFaces?.[kind] ?? [];
          expect(list.filter((d) => !blocked.includes(d)).length, at).toBeGreaterThan(0);
        }
  });

  it('puts the glass of a limit on legend keys without hatches, and limits only kinds a cell takes', () => {
    for (const def of catalog.filter((d) => d.glassTierLimits)) {
      for (const ch of def.glassTierLimits!.chars)
        expect(def.legend[ch]?.hatches, `${def.id} "${ch}"`).toBeUndefined();
      const placeable = new Set(Object.values(def.legend).flatMap((e) => e.hatches ?? []));
      for (const k of def.glassTierLimits!.kinds) expect(placeable.has(k), `${def.id} ${k}`).toBe(true);
    }
  });
});
