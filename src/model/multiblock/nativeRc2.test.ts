import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { buildGroup } from '../site/group';
import { sizedDef } from '../resize';
import { unitCells } from '../geometry';
import { withStructureGlass } from './glass';
import evidence from '../../../tools/game-dump/native-results.rc2.json';

const { nativeCases } = await import(
  /* @vite-ignore */ new URL('../../../tools/game-dump/native-cases.mjs', import.meta.url).href
);

// These hashes were produced by the real pinned Forge checkMachine/checkProcessing pass, not by
// validateResourceHatches. Changing a placement requires rerunning the native pass before updating evidence.
const cases = nativeCases({ getMultiblock, buildGroup, sizedDef, unitCells, withStructureGlass });

describe('placements validated by the actual RC2 game', () => {
  it('uses verified loaded RC2 jars and complete successful evidence', () => {
    expect(evidence.sourceCommit).toBe('a3e1e11241a814c9fa0dd0973d5699548428f689');
    expect(evidence.pack).toBe('2.9.0-RC-2');
    expect(evidence.loadedJars.map((j) => j.artifact)).toEqual([
      'GT5-Unofficial-5.09.54.205-dev.jar',
      'StructureLib-1.4.45-dev.jar',
    ]);
    expect(evidence.passed).toBe(1866);
    expect(evidence.failed).toBe(0);
    expect(evidence.results).toHaveLength(cases.length);
  });

  for (const test of cases) {
    it(test.name, () => {
      const verified = evidence.results.find((r) => r.name === test.name)!;
      expect(verified, 'Missing native evidence; run tools/game-dump/native-fixtures.mjs').toBeDefined();
      const cells = JSON.parse(JSON.stringify(test.cells)); // Optional unset properties are absent in JSON.
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            circuit: test.circuit,
            controllerFacing: test.controllerFacing,
            cells,
            expectedHatchFields: test.expectedHatchFields,
            expectedBlockFacings: test.expectedBlockFacings,
            expectedBeamRates: test.expectedBeamRates,
            expectedFluidDrain: test.expectedFluidDrain,
            expectedControllerFields: test.expectedControllerFields,
            dataBankWireless: test.dataBankWireless,
            checkRecipeData: test.checkRecipeData,
            processingEnvironment: test.processingEnvironment,
            expectedFluidProcessing: test.expectedFluidProcessing,
            expectedHatchCounts: test.expectedHatchCounts,
            expectedElectrode: test.expectedElectrode,
          }),
        )
        .digest('hex');
      expect(hash, 'Placement changed; rerun the native RC2 game validation').toBe(verified.placementSha256);
      expect(verified.passed).toBe(true);
      expect(verified.formed).toBe(test.expectedStructure);
      if (test.expectedBlockFacings) expect(verified.blockFacings).toEqual(test.expectedBlockFacings);
      if (test.expectedBeamRates) expect(verified.beamRates).toEqual(test.expectedBeamRates);
      if (test.expectedHatchCounts) expect(verified.hatchCounts).toEqual(test.expectedHatchCounts);
      if (test.expectedElectrode) expect(verified.electrode).toEqual(test.expectedElectrode);
      if (test.expectedFluidDrain) expect(verified.fluidDrain).toEqual(test.expectedFluidDrain);
      if (test.expectedFluidProcessing)
        expect(verified.fluidProcessing).toEqual(test.expectedFluidProcessing);
      if (test.expectedControllerFields)
        expect(verified.controllerFields).toEqual(test.expectedControllerFields);
      if (test.checkRecipeData) expect(verified.recipeData).toEqual(test.checkRecipeData.expected);
      if (test.expectedProcessing !== undefined)
        expect(verified.processingSucceeded).toBe(test.expectedProcessing);
      if (test.expectedFluids) expect(verified.seenFluidResources).toEqual([...test.expectedFluids].sort());
      if (test.checkOutputSlots)
        expect(verified.outputSlots!.every((slot) => slot.expected === slot.actual)).toBe(true);
      if (test.expectedHatchFields)
        expect(verified.hatchFields!.every((m) => m.expected === m.actual)).toBe(
          test.expectedHatchFieldsMatch ?? true,
        );
    });
  }
});
