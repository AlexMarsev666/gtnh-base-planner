import { expect, it } from 'vitest';

const { countChecks } = await import(
  /* @vite-ignore */ new URL('../../tools/gt-source/count-checks.mjs', import.meta.url).href
);

it('dispatches an inherited checkMachine helper to the controller override', () => {
  const rules = countChecks([
    { path: 'Controller.java', methods: { checkHatches: '\ncheckHasOutputHatch(errors);\n' } },
    {
      path: 'Base.java',
      methods: { checkMachine: '\ncheckHatches(errors);\n', checkHatches: '\ncheckHasInputHatch(errors);\n' },
    },
  ]);
  expect(rules).toEqual([
    { kind: 'fluidOut', min: 1, source: 'Controller.java', helper: 'checkHasOutputHatch' },
  ]);
});

it('includes explicitly called parent helper checks and leaves an uncalled parent alone', () => {
  const chain = [
    {
      path: 'Controller.java',
      methods: {
        checkMachine: '\ncheckHatches(errors);\n',
        checkHatches: '\nsuper.checkHatches(errors);\ncheckOneEnergyHatch(errors);\n',
      },
    },
    { path: 'Base.java', methods: { checkHatches: '\ncheckHasInputHatch(errors);\n' } },
  ];
  expect(
    countChecks(chain)
      .map((r: { kind: string }) => r.kind)
      .sort(),
  ).toEqual(['energy', 'fluidIn']);
  chain[0].methods.checkHatches = '\ncheckOneEnergyHatch(errors);\n';
  expect(countChecks(chain).map((r: { kind: string }) => r.kind)).toEqual(['energy']);
});

it('does not promote conditional helper calls or branch-local counts to global requirements', () => {
  expect(
    countChecks([
      {
        path: 'C.java',
        methods: {
          checkMachine: '\nif (alternate) { checkHatches(errors); }\nif (alternate) checkHatches(errors);\n',
          checkHatches: '\ncheckHasInputHatch(errors);\n',
        },
      },
    ]),
  ).toEqual([]);
  expect(
    countChecks([
      {
        path: 'C.java',
        methods: {
          checkMachine: '\nthis.checkHatches(errors);\n',
          checkHatches: '\nif (alternate) { checkHasInputHatch(errors); }\ncheckHasOutputBus(errors);\n',
        },
      },
    ]).map((r: { kind: string }) => r.kind),
  ).toEqual(['itemOut']);
});
