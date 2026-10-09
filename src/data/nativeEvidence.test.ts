import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import lock from '../../tools/game-dump/rc2-source-lock.json';
const gt = lock['GT5-Unofficial'].devJarSha256;
const sl = lock.StructureLib.devJarSha256;

const { nativeEvidence } = await import(
  /* @vite-ignore */ new URL('../../tools/game-dump/native-evidence.mjs', import.meta.url).href
);

function input() {
  const sourceCommit = 'a3e1e11241a814c9fa0dd0973d5699548428f689';
  const cells = [{ pos: [0, 0, 0], block: 'gregtech:gt.blockmachines@12697' }];
  const fixtures = {
    schema: 1,
    pack: '2.9.0-RC-2',
    sourceCommit,
    cases: [{ name: 'same-id', circuit: 0, cells, expectedStructure: true }],
    jars: [{ sha256: gt }, { sha256: sl }],
  };
  const results = {
    pack: fixtures.pack,
    sourceCommit,
    passed: 1,
    failed: 0,
    loadedJars: [
      { path: 'C:\\cache\\GT5U.jar', sha256: gt },
      { path: 'C:\\cache\\SL.jar', sha256: sl },
    ],
    results: [
      {
        name: 'same-id',
        passed: true,
        formed: true,
        placementSha256: createHash('sha256')
          .update(JSON.stringify({ circuit: 0, cells }))
          .digest('hex'),
      },
    ],
  };
  return { fixtures, results };
}

it('rejects a stale native report with the same case ID but a different placement', () => {
  const { fixtures, results } = input();
  fixtures.cases[0].cells[0].pos = [1, 0, 0];
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale/);
});

it('binds first-match hatch lists and electrode inventory observations to their native fixture', () => {
  const { fixtures, results } = input();
  const expectedHatchCounts = { electrodeHatch: 1, mInputBusses: 2 };
  const expectedElectrode = {
    gameId: 'kubatech:arc_furnace_electrode@0',
    slotAccepts: true,
    operatingMeta: 0,
  };
  const test = { ...fixtures.cases[0], expectedHatchCounts, expectedElectrode };
  const run = {
    ...results.results[0],
    hatchCounts: structuredClone(expectedHatchCounts),
    electrode: structuredClone(expectedElectrode),
    placementSha256: createHash('sha256')
      .update(JSON.stringify({ circuit: 0, cells: test.cells, expectedHatchCounts, expectedElectrode }))
      .digest('hex'),
  };
  const fresh = { ...fixtures, cases: [test] };
  expect(nativeEvidence(fresh, { ...results, results: [run] }).passed).toBe(1);
  for (const bad of [
    { ...run, hatchCounts: undefined },
    { ...run, hatchCounts: { ...run.hatchCounts, mInputBusses: 1 } },
    { ...run, electrode: undefined },
    { ...run, electrode: { ...run.electrode, operatingMeta: 1 } },
  ])
    expect(() => nativeEvidence(fresh, { ...results, results: [bad] })).toThrow(/stale or failed/);
  test.expectedElectrode.gameId = 'minecraft:stone@0';
  expect(() => nativeEvidence(fresh, { ...results, results: [run] })).toThrow(/stale or failed/);
});

it('binds controlled processing environment and exact fluid consumption/output observations', () => {
  const { fixtures, results } = input();
  const processingEnvironment = { humidity: 0.4, dimension: 'Overworld' };
  const expectedFluidProcessing = {
    result: 'success',
    duration: 20,
    filled: { steam: 1500 },
    remaining: { steam: 0 },
    outputs: [{ fluid: 'water', amount: 600 }],
  };
  const test = { ...fixtures.cases[0], processingEnvironment, expectedFluidProcessing };
  const run = {
    ...results.results[0],
    fluidProcessing: expectedFluidProcessing,
    placementSha256: createHash('sha256')
      .update(
        JSON.stringify({
          circuit: test.circuit,
          cells: test.cells,
          processingEnvironment,
          expectedFluidProcessing,
        }),
      )
      .digest('hex'),
  };
  const fresh = { ...fixtures, cases: [test] };
  expect(nativeEvidence(fresh, { ...results, results: [run] }).passed).toBe(1);
  for (const fluidProcessing of [
    undefined,
    { ...expectedFluidProcessing, duration: 0 },
    { ...expectedFluidProcessing, remaining: { steam: 1500 } },
    { ...expectedFluidProcessing, outputs: [{ fluid: 'lava', amount: 600 }] },
    { ...expectedFluidProcessing, extra: 1 },
  ])
    expect(() => nativeEvidence(fresh, { ...results, results: [{ ...run, fluidProcessing }] })).toThrow(
      /stale or failed/,
    );
  expect(() =>
    nativeEvidence(
      {
        ...fresh,
        cases: [{ ...test, processingEnvironment: { ...processingEnvironment, dimension: 'Mars' } }],
      },
      { ...results, results: [run] },
    ),
  ).toThrow(/stale or failed/);
});

it('binds scalar controller state to the fixture and rejects missing or incorrect observations', () => {
  const { fixtures, results } = input();
  const expectedControllerFields = { slave: true, mEUt: -32768 };
  const test = { ...fixtures.cases[0], expectedControllerFields };
  const run = {
    ...results.results[0],
    controllerFields: { ...expectedControllerFields },
    placementSha256: createHash('sha256')
      .update(JSON.stringify({ circuit: test.circuit, cells: test.cells, expectedControllerFields }))
      .digest('hex'),
  };
  const freshFixtures = { ...fixtures, cases: [test] };
  expect(nativeEvidence(freshFixtures, { ...results, results: [run] }).passed).toBe(1);
  for (const controllerFields of [
    undefined,
    { slave: false, mEUt: -32768 },
    { slave: true },
    { ...expectedControllerFields, unexpected: 1 },
  ])
    expect(() =>
      nativeEvidence(freshFixtures, { ...results, results: [{ ...run, controllerFields }] }),
    ).toThrow(/stale or failed/);
  expect(() =>
    nativeEvidence(
      { ...freshFixtures, cases: [{ ...test, expectedControllerFields: { slave: false, mEUt: -32768 } }] },
      { ...results, results: [run] },
    ),
  ).toThrow(/stale or failed/);
});

it('rejects missing cases, wrong jars and exceptions even for an expected-invalid structure', () => {
  const { fixtures, results } = input();
  expect(() => nativeEvidence(fixtures, { ...results, results: [] })).toThrow(/incomplete/);
  expect(() =>
    nativeEvidence(fixtures, { ...results, loadedJars: [{ path: 'other', sha256: 'other' }] }),
  ).toThrow(/different game jars/);
  fixtures.cases[0].expectedStructure = false;
  expect(() =>
    nativeEvidence(fixtures, {
      ...results,
      results: [{ ...results.results[0], formed: false, exception: 'Native check threw' }],
    }),
  ).toThrow(/stale or failed/);
});

it('pins recipe packets and controller mode, and requires every observed protocol result', () => {
  const { fixtures, results } = input();
  const expected = { readRecipes: 1, wiredReceived: 1, wirelessReceived: 1, sameRecipes: true };
  const checkRecipeData = { loaded: true, expected };
  const test = { ...fixtures.cases[0], dataBankWireless: true, checkRecipeData };
  const run = {
    ...results.results[0],
    recipeData: { ...expected },
    placementSha256: createHash('sha256')
      .update(
        JSON.stringify({ circuit: test.circuit, cells: test.cells, dataBankWireless: true, checkRecipeData }),
      )
      .digest('hex'),
  };
  const freshFixtures = { ...fixtures, cases: [test] };
  expect(nativeEvidence(freshFixtures, { ...results, results: [run] }).passed).toBe(1);
  for (const recipeData of [
    undefined,
    { ...expected, wirelessReceived: 0 },
    { readRecipes: 1 },
    { ...expected, extra: true },
  ])
    expect(() => nativeEvidence(freshFixtures, { ...results, results: [{ ...run, recipeData }] })).toThrow(
      /stale or failed/,
    );
  expect(() =>
    nativeEvidence(
      { ...freshFixtures, cases: [{ ...test, dataBankWireless: false }] },
      { ...results, results: [run] },
    ),
  ).toThrow(/stale or failed/);
  expect(() =>
    nativeEvidence(
      { ...freshFixtures, cases: [{ ...test, checkRecipeData: { ...checkRecipeData, loaded: false } }] },
      { ...results, results: [run] },
    ),
  ).toThrow(/stale or failed/);
});

it('rejects a circuit change and preserves a verified report without local cache paths', () => {
  const { fixtures, results } = input();
  const saved = nativeEvidence(fixtures, results);
  expect(saved.loadedJars).toEqual([
    { artifact: 'GT5U.jar', sha256: gt },
    { artifact: 'SL.jar', sha256: sl },
  ]);
  expect(results.loadedJars[0].path).toBe('C:\\cache\\GT5U.jar');
  fixtures.cases[0].circuit = 1;
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale/);
});

it('rejects a replacement jar even if both the fixture and loaded report agree on its checksum', () => {
  const { fixtures, results } = input();
  fixtures.jars[0].sha256 = 'modified-205-jar';
  results.loadedJars[0].sha256 = 'modified-205-jar';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/pinned RC2 artifacts/);
});

it('requires complete native field mappings and pins their expectations to the placement hash', () => {
  const { fixtures, results } = input();
  const expectedHatchFields = { coolantInputHatch: 'coolant', plasmaInputHatch: 'plasma' };
  Object.assign(fixtures.cases[0], { expectedHatchFields });
  results.results[0].placementSha256 = createHash('sha256')
    .update(JSON.stringify({ circuit: 0, cells: fixtures.cases[0].cells, expectedHatchFields }))
    .digest('hex');
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  const hatchFields = Object.entries(expectedHatchFields).map(([field, expected]) => ({
    field,
    expected,
    actual: expected,
  }));
  Object.assign(results.results[0], { hatchFields });
  expect(nativeEvidence(fixtures, results).passed).toBe(1);
  hatchFields[0].actual = 'plasma';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  Object.assign(fixtures.cases[0], { expectedHatchFieldsMatch: false });
  expect(nativeEvidence(fixtures, results).passed).toBe(1);
  hatchFields[1].field = 'coolantInputHatch';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  hatchFields[1].field = 'plasmaInputHatch';
  expectedHatchFields.coolantInputHatch = 'changed-resource';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
});

it('requires actual block fronts and beam dispatch rates, and pins both expectations', () => {
  const { fixtures, results } = input();
  const expectedBlockFacings = { '0,1,0': 'north', '0,4,3': 'up' };
  const expectedBeamRates = [120];
  Object.assign(fixtures.cases[0], { expectedBlockFacings, expectedBeamRates });
  results.results[0].placementSha256 = createHash('sha256')
    .update(
      JSON.stringify({ circuit: 0, cells: fixtures.cases[0].cells, expectedBlockFacings, expectedBeamRates }),
    )
    .digest('hex');
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  const blockFacings = { '0,4,3': 'up', '0,1,0': 'north' };
  const beamRates = [120];
  Object.assign(results.results[0], { blockFacings, beamRates });
  expect(nativeEvidence(fixtures, results).passed).toBe(1);
  blockFacings['0,4,3'] = 'north';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  blockFacings['0,4,3'] = 'up';
  beamRates[0] = 30;
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  beamRates[0] = 120;
  expectedBeamRates[0] = 30;
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
});

it('requires the actual locked-fluid fill, drain and remaining amounts, and pins their expectations', () => {
  const { fixtures, results } = input();
  const expectedFluidDrain = {
    method: 'drainCryotheum',
    amount: 10,
    success: true,
    filled: { coolant: 100, recipe: 1000 },
    remaining: { coolant: 90, recipe: 1000 },
  };
  Object.assign(fixtures.cases[0], { expectedFluidDrain });
  results.results[0].placementSha256 = createHash('sha256')
    .update(JSON.stringify({ circuit: 0, cells: fixtures.cases[0].cells, expectedFluidDrain }))
    .digest('hex');
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  const fluidDrain = structuredClone(expectedFluidDrain);
  Object.assign(results.results[0], { fluidDrain });
  expect(nativeEvidence(fixtures, results).passed).toBe(1);
  fluidDrain.remaining.coolant = 100;
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  fluidDrain.remaining.coolant = 90;
  fluidDrain.filled.coolant = 0;
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
  fluidDrain.filled.coolant = 100;
  expectedFluidDrain.method = 'drainPyrotheum';
  expect(() => nativeEvidence(fixtures, results)).toThrow(/stale or failed/);
});
