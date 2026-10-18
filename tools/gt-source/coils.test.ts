import { describe, expect, it } from 'vitest';
import { coilLevels, coilMetas, isCoilElement, usesCoils } from './coils.mjs';

// Sources copied from GT5-Unofficial 5.09.54.205.
describe('coilLevels', () => {
  it('reads the levels in order and the heat formula', () => {
    const levels = coilLevels(`
      public enum HeatingCoilLevel {
          None, // 0
          ULV, // Not implemented 901
          LV, // Cupronickel 1801
          MV,
          ;
          public long getHeat() {
              return this == None ? 0 : 1L + (900L * this.ordinal());
          }
      }`);
    expect(levels).toEqual([
      { name: 'None', heat: 0 },
      { name: 'ULV', heat: 901 },
      { name: 'LV', heat: 1801 },
      { name: 'MV', heat: 2701 },
    ]);
  });

  it('fails on a formula it cannot read', () => {
    expect(() => coilLevels('enum HeatingCoilLevel { None, LV; long getHeat() { return foo(); } }')).toThrow(
      /getHeat/,
    );
  });
});

describe('coilMetas', () => {
  const body = `
    public BlockCasings5() {
        super(ItemCasings.class, "gt.blockcasings5", MaterialCasings.INSTANCE, 16);
        register(0, ItemList.Casing_Coil_Cupronickel);
        register(1, ItemList.Casing_Coil_Kanthal);
        register(9, ItemList.Casing_Coil_HSSS);
    }
    public static HeatingCoilLevel getCoilHeatFromDamage(int meta) {
        return switch (meta % ACTIVE_OFFSET) {
            case 0 -> LV;
            case 1 -> MV;
            case 9 -> LuV;
            case 10 -> UHV;
            default -> None;
        };
    }`;

  it('gives the level of each registered meta, in meta order', () => {
    expect(coilMetas(body)).toEqual([
      { meta: 0, level: 'LV' },
      { meta: 1, level: 'MV' },
      { meta: 9, level: 'LuV' },
    ]);
  });
});

describe('coil elements', () => {
  const ctx = {
    bodyOf: (name: string) =>
      name === 'getCoilElement'
        ? 'return GTStructureChannels.HEATING_COIL.use(activeCoils(ofCoil(a, b)));'
        : null,
  };

  it('knows ofCoil, a custom IHeatingCoil check and a helper that builds one', () => {
    expect(
      isCoilElement('GTStructureChannels.HEATING_COIL.use(activeCoils(ofCoil(A::set, A::get)))', ctx),
    ).toBe(true);
    expect(
      isCoilElement('new IStructureElement<T>() { check(...) { block instanceof IHeatingCoil } }', ctx),
    ).toBe(true);
    expect(isCoilElement('getCoilElement()', ctx)).toBe(true);
  });

  it('does not take a fixed coil casing for one', () => {
    expect(isCoilElement('Casings.ElectrumFluxCoilBlock.asElement()', ctx)).toBe(false);
    expect(isCoilElement('ofBlock(GregTechAPI.sBlockCasings5, 0)', ctx)).toBe(false);
    expect(usesCoils([{ name: 'MTEFoo', body: 'ofBlock(GregTechAPI.sBlockCasings5, 0)' }])).toBe(false);
    expect(usesCoils([{ name: 'MTEFoo', body: 'x(activeCoils(ofCoil(a, b)))' }])).toBe(true);
    expect(
      usesCoils([{ name: 'MTEFoo', body: 'if (!(block instanceof IHeatingCoil c)) return false;' }]),
    ).toBe(true);
  });
});
