import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertNativeJars } from './native-jars.mjs';

/** Refuse incomplete, stale or failing native reports before updating the regression evidence. */
export function nativeEvidence(fixtures, results) {
  if (
    fixtures.schema !== 1 ||
    fixtures.catalogProbe ||
    fixtures.pack !== '2.9.0-RC-2' ||
    results.pack !== fixtures.pack ||
    results.sourceCommit !== fixtures.sourceCommit ||
    results.sourceCommit !== 'a3e1e11241a814c9fa0dd0973d5699548428f689'
  )
    throw new Error('Native report uses an unsupported schema or source revision.');
  if (
    !fixtures.cases.length ||
    new Set(fixtures.cases.map((c) => c.name)).size !== fixtures.cases.length ||
    results.failed !== 0 ||
    results.passed !== fixtures.cases.length ||
    results.results.length !== fixtures.cases.length ||
    new Set(results.results.map((r) => r.name)).size !== fixtures.cases.length
  )
    throw new Error('Native report is incomplete or has failures.');
  assertNativeJars(fixtures, results);
  for (const test of fixtures.cases) {
    const result = results.results.find((r) => r.name === test.name);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          circuit: test.circuit,
          controllerFacing: test.controllerFacing,
          cells: test.cells,
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
    if (
      !result ||
      !result.passed ||
      result.exception ||
      result.placementSha256 !== hash ||
      result.formed !== test.expectedStructure ||
      (test.expectedProcessing !== undefined && result.processingSucceeded !== test.expectedProcessing) ||
      (test.expectedFluidProcessing &&
        !isDeepStrictEqual(result.fluidProcessing, test.expectedFluidProcessing)) ||
      (test.expectedHatchCounts && !isDeepStrictEqual(result.hatchCounts, test.expectedHatchCounts)) ||
      (test.expectedElectrode && !isDeepStrictEqual(result.electrode, test.expectedElectrode)) ||
      (test.checkRecipeData &&
        (!result.recipeData ||
          Object.keys(result.recipeData).length !== Object.keys(test.checkRecipeData.expected).length ||
          Object.entries(test.checkRecipeData.expected).some(
            ([key, value]) => result.recipeData[key] !== value,
          ))) ||
      (test.expectedBlockFacings &&
        (!result.blockFacings ||
          Object.keys(result.blockFacings).length !== Object.keys(test.expectedBlockFacings).length ||
          Object.entries(test.expectedBlockFacings).some(
            ([cell, face]) => result.blockFacings[cell] !== face,
          ))) ||
      (test.expectedBeamRates &&
        JSON.stringify(result.beamRates) !== JSON.stringify(test.expectedBeamRates)) ||
      (test.expectedControllerFields &&
        (!result.controllerFields ||
          Object.keys(result.controllerFields).length !== Object.keys(test.expectedControllerFields).length ||
          Object.entries(test.expectedControllerFields).some(
            ([key, value]) => result.controllerFields[key] !== value,
          ))) ||
      (test.expectedFluidDrain &&
        (!result.fluidDrain ||
          result.fluidDrain.method !== test.expectedFluidDrain.method ||
          result.fluidDrain.amount !== test.expectedFluidDrain.amount ||
          result.fluidDrain.success !== test.expectedFluidDrain.success ||
          ['filled', 'remaining'].some(
            (field) =>
              !result.fluidDrain[field] ||
              Object.keys(result.fluidDrain[field]).length !==
                Object.keys(test.expectedFluidDrain[field]).length ||
              Object.entries(test.expectedFluidDrain[field]).some(
                ([key, value]) => result.fluidDrain[field][key] !== value,
              ),
          ))) ||
      (test.expectedFluids &&
        JSON.stringify(result.seenFluidResources) !== JSON.stringify([...test.expectedFluids].sort())) ||
      (test.checkOutputSlots &&
        (!result.outputSlots ||
          result.outputSlots.length !== test.cells.filter((c) => c.outputSlot !== undefined).length ||
          result.outputSlots.some((slot) => slot.expected !== slot.actual))) ||
      (test.expectedHatchFields &&
        (!result.hatchFields ||
          result.hatchFields.length !== Object.keys(test.expectedHatchFields).length ||
          new Set(result.hatchFields.map((m) => m.field)).size !== result.hatchFields.length ||
          result.hatchFields.some((m) => m.expected !== test.expectedHatchFields[m.field]) ||
          result.hatchFields.every((m) => m.expected === m.actual) !==
            (test.expectedHatchFieldsMatch ?? true)))
    )
      throw new Error(`Native result is stale or failed for ${test.name}.`);
  }
  return {
    schema: 1,
    ...results,
    loadedJars: results.loadedJars.map(({ path, ...jar }) => ({
      ...jar,
      artifact: basename(path.replaceAll('\\', '/')),
    })),
  };
}
