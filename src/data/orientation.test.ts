import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from './catalog';
import snapshot from './orientation.snapshot.json';
import { validateMultiblockDef } from './validate';

/**
 * `variants` (the orientations GT allows) comes from the alignment limits of each controller class
 * (tools/gt-source/orientation.mjs). The snapshot lists which catalog ids carry it: update it together with the data
 * (`node tools/gt-source/orientation.mjs <GT5-Unofficial checkout> --write`).
 */
describe('orientations of the catalog', () => {
  it('lists the entries with variants, and which', () => {
    const have = Object.fromEntries(catalog.filter((d) => d.variants).map((d) => [d.id, d.variants]));
    expect(have).toEqual(snapshot.variants);
  });

  it.each(catalog.filter((d) => d.variants).map((d) => [d.id, d] as const))('%s is valid', (_id, def) => {
    expect(validateMultiblockDef(def)).toEqual([]);
  });

  it('lists the ids of each restriction', () => {
    const ids = (v: string) =>
      catalog
        .filter((d) => d.variants?.join() === v)
        .map((d) => d.id)
        .sort();
    expect(ids('0')).toEqual([
      'bricked-blast-furnace',
      'extreme-industrial-greenhouse',
      'high-temperature-gas-cooled-reactor',
      'thorium-high-temperature-reactor',
      'windmill',
    ]);
    expect(ids('0,2')).toEqual([
      'large-gas-turbine',
      'large-hp-steam-turbine',
      'large-plasma-turbine',
      'large-steam-turbine',
      'large-supercritical-steam-turbine',
    ]);
    expect(ids('0,1')).toHaveLength(Object.keys(snapshot.variants).length - 10);
  });

  it('keeps the Coke Oven and the towers upright and leaves a plain machine free', () => {
    expect(getMultiblock('coke-oven')!.variants).toEqual([0, 1]);
    expect(getMultiblock('distillation-tower')!.variants).toEqual([0, 1]);
    expect(getMultiblock('industrial-centrifuge')!.variants).toBeUndefined();
  });

  it('rejects malformed variants', () => {
    const def = getMultiblock('coke-oven')!;
    const problems = (variants: unknown) =>
      validateMultiblockDef({ ...def, variants: variants as never }).join('; ');
    expect(problems([])).toMatch(/non-empty/);
    expect(problems([0, 4])).toMatch(/0, 1, 2 or 3/);
    expect(problems([1, 0])).toMatch(/sorted/);
    expect(problems([1, 2])).toMatch(/include 0/);
    expect(problems([0, 0, 1])).toMatch(/twice/);
    expect(problems([0, 1, 2, 3])).toMatch(/all four/);
    expect(problems([0, 2])).toBe('');
  });
});
