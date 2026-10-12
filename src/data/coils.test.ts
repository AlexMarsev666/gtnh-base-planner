import { describe, expect, it } from 'vitest';
import { BLOCKS } from './blocks';
import { catalog } from './catalog';
import { COILS, COILS_BY_HEAT, coilById, isCoilBlock } from './coils';
import snapshot from './hatch-extras.snapshot.json';
import { validateMultiblockDef } from './validate';

describe('heating coil table (GT HeatingCoilLevel, BlockCasings5)', () => {
  it('lists the 14 coils in meta order with unique ids, blocks and heats', () => {
    expect(COILS.map((c) => c.blockId)).toEqual(
      Array.from({ length: 14 }, (_, meta) => `gregtech:gt.blockcasings5@${meta}`),
    );
    expect(new Set(COILS.map((c) => c.id)).size).toBe(14);
    expect(new Set(COILS.map((c) => c.heat)).size).toBe(14);
    expect(coilById('cupronickel')).toMatchObject({ name: 'Cupronickel', heat: 1801 });
    expect(coilById('eternal')).toMatchObject({ name: 'Eternal', heat: 13501 });
    expect(coilById('hss-s')?.blockId).toBe('gregtech:gt.blockcasings5@9');
  });

  it('orders the picker by heat (HSS-S is above HSS-G although its meta is 9)', () => {
    const heats = COILS_BY_HEAT.map((c) => c.heat);
    expect(heats).toEqual([...heats].sort((a, b) => a - b));
    const names = COILS_BY_HEAT.map((c) => c.name);
    expect(names.indexOf('HSS-S')).toBe(names.indexOf('HSS-G') + 1);
  });

  it('registers every coil block, and knows the stand-in', () => {
    for (const c of COILS) {
      expect(BLOCKS[c.blockId], c.id).toBeDefined();
      expect(isCoilBlock(c.blockId)).toBe(true);
    }
    expect(isCoilBlock('gt.coil.cupronickel')).toBe(true);
    expect(isCoilBlock('gt.casing.heatProof')).toBe(false);
  });
});

describe('coils of the catalog', () => {
  const withCoils = catalog.filter((d) => d.coils);

  it('lists the entries with coils (tools/gt-source/hatch-extras.mjs)', () => {
    expect(withCoils.map((d) => d.id).sort()).toEqual(snapshot.coils);
    expect(withCoils).toHaveLength(21);
  });

  it.each(withCoils.map((d) => [d.id, d] as const))('%s is valid and draws one coil block', (_id, def) => {
    expect(validateMultiblockDef(def)).toEqual([]);
    for (const ch of def.coils!.chars) expect(isCoilBlock(def.legend[ch].blockId)).toBe(true);
  });

  it('takes the heating coil of the Electric Blast Furnace and of Volcanus', () => {
    expect(catalog.find((d) => d.id === 'electric-blast-furnace')!.coils).toEqual({ chars: ['K'] });
    expect(catalog.find((d) => d.id === 'volcanus')!.coils).toEqual({ chars: ['B'] });
  });

  it('leaves out structures that fix their coil (no ofCoil element)', () => {
    for (const id of [
      'dyson-swarm',
      'helioflare-power-forge',
      'integrated-ore-factory',
      'xl-turbo-plasma-turbine',
    ])
      expect(catalog.find((d) => d.id === id)!.coils, id).toBeUndefined();
  });

  it('rejects a coil list the legend does not back', () => {
    const def = catalog.find((d) => d.id === 'electric-blast-furnace')!;
    const bad = (coils: unknown) =>
      validateMultiblockDef({ ...def, coils } as never).filter((e) => /coils/.test(e));
    expect(bad({ chars: [] })).not.toEqual([]);
    expect(bad({ chars: ['Q'] })).not.toEqual([]);
    expect(bad({ chars: ['K', 'K'] })).not.toEqual([]);
    // A casing is no coil.
    const casing = Object.keys(def.legend).find((c) => !isCoilBlock(def.legend[c].blockId))!;
    expect(bad({ chars: [casing] })).not.toEqual([]);
    expect(bad({ chars: ['K'] })).toEqual([]);
  });
});
