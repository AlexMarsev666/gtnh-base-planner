import { describe, expect, it } from 'vitest';
import type { MultiblockDef } from '../model/multiblock/types';
import { sizedDef } from '../model/resize';
import { UNWRITTEN } from '../../tools/gt-source/casing-min.mjs';
import { catalog, getMultiblock } from './catalog';
import snapshot from './constraints.snapshot.json';
import { validateMultiblockDef } from './validate';

/**
 * `minCasings` and `requiredAny` come from the structure check of each controller class
 * (tools/gt-source/casing-min.mjs). The snapshot lists which catalog ids carry them: update it together with the
 * data (a new id without a minimum means the tool could not read it or the entry holds another structure tier).
 */
const ids = (pick: (d: MultiblockDef) => unknown) =>
  catalog
    .filter((d) => pick(d) !== undefined)
    .map((d) => d.id)
    .sort();

describe('casing minimums and hatch groups of the catalog', () => {
  it('lists the entries with minCasings', () => {
    expect(ids((d) => d.minCasings)).toEqual(snapshot.minCasings);
  });

  it('lists the entries with requiredAny', () => {
    expect(ids((d) => d.requiredAny)).toEqual(snapshot.requiredAny);
  });

  it('has a minimum for every class that checks one, bar the listed entries', () => {
    // 131 classes call checkCasingMin; the tool names why the others cannot get one.
    expect(snapshot.checksCasingMin).toHaveLength(131);
    const without = snapshot.checksCasingMin.filter((id) => !snapshot.minCasings.includes(id));
    expect(without.sort()).toEqual(Object.keys(UNWRITTEN).sort());
    for (const id of Object.keys(UNWRITTEN)) expect(getMultiblock(id)?.minCasings, id).toBeUndefined();
    for (const id of snapshot.checksCasingMin) expect(getMultiblock(id), id).toBeDefined();
  });

  it.each(catalog.filter((d) => d.minCasings || d.requiredAny).map((d) => [d.id, d] as const))(
    '%s is valid',
    (_id, def) => {
      expect(validateMultiblockDef(def)).toEqual([]);
    },
  );

  it('states a group only when no kind of it is already required', () => {
    for (const def of catalog)
      for (const group of def.requiredAny ?? [])
        for (const k of group.kinds) expect(def.requiredHatches?.[k]?.min ?? 0, `${def.id} ${k}`).toBe(0);
  });

  it('grows the Distillation Tower minimum by 7 casings per layer', () => {
    const dt = getMultiblock('distillation-tower')!;
    expect(dt.minCasings).toEqual([{ chars: ['b', 'l', 't', 'c'], min: 16, perSlab: 7 }]);
    // GT: 7 * height - 5, from 3 to 12 layers (tooltip "16-79").
    for (const n of [3, 4, 5, 12])
      expect(sizedDef(dt, n).minCasings?.[0], `height ${n}`).toMatchObject({ min: 7 * n - 5 });
    expect(sizedDef(dt, 5).minCasings?.[0]).not.toHaveProperty('perSlab');
    // The characters of each slab copy count too: every one of them is a legend key of the sized def.
    const sized = sizedDef(dt, 7);
    expect(sized.minCasings?.[0].chars.length).toBeGreaterThan(4);
    for (const ch of sized.minCasings![0].chars) expect(sized.legend[ch], ch).toBeDefined();
  });

  it('counts only the cells GT counts where another element places the same block', () => {
    // MTEIndustrialCompressor: 'D' places the same casing as 'C' without counting it (123 cells of GT's 95
    // minimum, not the 168 of the block).
    const def = getMultiblock('large-electric-compressor')!;
    const chars = def.minCasings![0].chars;
    const cells = def.layers
      .flat()
      .join('')
      .split('')
      .filter((ch) => chars.includes(ch)).length;
    expect(cells).toBe(123);
    const sameBlock = Object.entries(def.legend).filter(([, e]) =>
      chars.some((c) => def.legend[c].blockId === e.blockId),
    );
    expect(sameBlock.length).toBeGreaterThan(chars.length);
  });

  it('reads the boilers, which inherit their minimums, and the XL turbines', () => {
    expect(getMultiblock('large-titanium-boiler')?.minCasings?.map((m) => m.min)).toEqual([20, 5]);
    expect(getMultiblock('thermal-boiler')?.minCasings?.map((m) => m.min)).toEqual([10, 10, 20]);
    expect(getMultiblock('xl-turbo-gas-turbine')?.minCasings?.[0].min).toBeGreaterThan(300);
  });

  it('keeps old definitions without the fields valid', () => {
    const coke = getMultiblock('coke-oven')!;
    expect(coke.minCasings).toBeUndefined();
    expect(coke.requiredAny).toBeUndefined();
    expect(validateMultiblockDef(coke)).toEqual([]);
  });
});

describe('validation of the fields', () => {
  const base = getMultiblock('oil-cracking-unit')!;
  const check = (patch: Partial<MultiblockDef>) => validateMultiblockDef({ ...base, ...patch });

  it('accepts the entry as it is', () => {
    expect(check({})).toEqual([]);
  });

  it('rejects a character the legend does not have and a minimum the structure cannot meet', () => {
    expect(check({ minCasings: [{ chars: ['Z'], min: 3 }] }).join()).toContain('not a legend key');
    expect(check({ minCasings: [{ chars: ['l', 'r', 'm'], min: 999 }] }).join()).toContain(
      'only 25 such cells',
    );
    expect(check({ minCasings: [{ chars: [], min: 3 }] }).join()).toContain('non-empty');
  });

  it('rejects bad numbers and perSlab on a fixed-size def', () => {
    expect(check({ minCasings: [{ chars: ['l'], min: 0 }] }).join()).toContain('min must be');
    expect(check({ minCasings: [{ chars: ['l'], min: 3, perSlab: 2 }] }).join()).toContain('perSlab');
  });

  it('rejects hatch groups naming a kind no cell takes', () => {
    expect(check({ requiredAny: [{ kinds: ['muffler'], min: 1 }] }).join()).toContain(
      'no legend cell allows',
    );
    expect(check({ requiredAny: [{ kinds: [], min: 1 }] }).join()).toContain('non-empty');
    expect(check({ requiredAny: [{ kinds: ['itemIn'], min: 0 }] }).join()).toContain('min must be');
  });
});
