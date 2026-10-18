import { describe, expect, it } from 'vitest';
import { kindsForCell, readElement } from './hatch-elements.mjs';

const kinds = (expr: string) => {
  const { dot, kinds } = readElement(expr);
  return { dot, kinds: [...kinds].sort() };
};

// Element expressions copied from GT5-Unofficial 5.09.54.205.
describe('readElement', () => {
  it("Mega Oil Cracker's left hatch: the element, not its adder, says what it takes", () => {
    expect(
      kinds(`buildHatchAdder(MTEMegaOilCracker.class)
        .atLeast(InputHatch.withAdder(MTEMegaOilCracker::addLeftHatchToMachineList))
        .casingIndex(Casings.NaquadahReinforcedDistillationCasing.textureId)
        .hint(2)
        .buildAndChain(onElementPass(MTEMegaOilCracker::onCasingAdded, Casings.NaquadahReinforcedDistillationCasing.asElement()))`),
    ).toEqual({ dot: 2, kinds: ['fluidIn'] });
  });

  it("Fusion computer's energy injector: a custom adder inside an ImmutableMap", () => {
    expect(
      kinds(`lazy(t -> buildHatchAdder(MTEFusionComputer.class)
        .atLeast(ImmutableMap.of(Energy.withAdder(MTEFusionComputer::addEnergyInjector), 16))
        .casingIndex(t.getCasingTextureIndex())
        .hint(2)
        .buildAndChain(t.getCasing(), t.getCasingMeta()))`),
    ).toEqual({ dot: 2, kinds: ['energy'] });
  });

  it('Circuit Assembly Line: energy hatch and first input bus share dot 3', () => {
    const energy = readElement(`buildHatchAdder(MTECircuitAssemblyLine.class).atLeast(Energy)
      .casingIndex(CASING_INDEX).hint(3).buildAndChain(GregTechAPI.sBlockCasings3, 10)`);
    const bus = readElement('InputBus.newAny(CASING_INDEX, 3, ForgeDirection.DOWN)');
    expect([energy.dot, bus.dot]).toEqual([3, 3]);
    const sets = [energy.kinds, bus.kinds];
    // Each cell takes the element whose kinds it already has.
    expect(kindsForCell(sets, ['energy'])).toEqual(['energy']);
    expect(kindsForCell(sets, ['itemIn'])).toEqual(['itemIn']);
    expect(kindsForCell(sets, [])).toEqual([]);
    expect(kindsForCell([energy.kinds], [])).toEqual(['energy']);
  });

  it("Assembly Line's data access hatch is the dataAccess kind", () => {
    expect(
      kinds(`buildHatchAdder(MTEAssemblyLine.class).atLeast(DataHatchElement.DataAccess).hint(3).casingIndex(42)
        .allowOnly(ForgeDirection.NORTH).buildAndChain(GregTechAPI.sBlockCasings3, 10)`),
    ).toEqual({ dot: 3, kinds: ['dataAccess'] });
    expect(kinds('ofHatchAdder(MTEAssemblyLine::addDataAccessToMachineList, 42, 3)')).toEqual({
      dot: 3,
      kinds: ['dataAccess'],
    });
  });

  it("reads a local IHatchElement through its initialiser (Distillation Tower's layered output)", () => {
    const ctx = {
      ints: new Map<string, number>(),
      bodyOf: () => null,
      elementOf: (name: string) =>
        name === 'layeredOutputHatch'
          ? 'OutputHatch.withCount(MTEDistillationTower::getCurrentLayerOutputHatchCount)'
          : null,
    };
    const { dot, kinds } = readElement(
      'buildHatchAdder(MTEDistillationTower.class).atLeast(layeredOutputHatch).casingIndex(CASING_INDEX).hint(2).build()',
      ctx,
    );
    expect({ dot, kinds: [...kinds] }).toEqual({ dot: 2, kinds: ['fluidOut'] });
  });

  it('a cell takes the smallest element that holds its kinds, and none that does not', () => {
    const sets = [new Set(['fluidOut', 'muffler']), new Set(['fluidOut', 'energy', 'maintenance'])];
    expect(kindsForCell(sets, ['fluidOut', 'muffler'])).toEqual(['fluidOut', 'muffler']);
    expect(kindsForCell(sets, ['fluidOut'])).toEqual(['fluidOut', 'muffler']);
    expect(kindsForCell(sets, ['itemIn'])).toEqual([]);
  });
});
