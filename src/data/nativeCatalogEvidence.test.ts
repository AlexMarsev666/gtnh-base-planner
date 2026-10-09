import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import lock from '../../tools/game-dump/rc2-source-lock.json';
const gt = lock['GT5-Unofficial'].devJarSha256;
const sl = lock.StructureLib.devJarSha256;

const { nativeCatalogEvidence } = await import(
  /* @vite-ignore */ new URL('../../tools/game-dump/native-catalog-evidence.mjs', import.meta.url).href
);

function input() {
  const sourceCommit = 'a3e1e11241a814c9fa0dd0973d5699548428f689';
  const cells = [{ pos: [0, 0, 0], block: 'gregtech:gt.blockmachines@12697' }];
  const test = { name: 'catalog-one', machine: 'one', circuit: 0, cells, expectedStructure: true };
  const fixtures = {
    schema: 1,
    pack: '2.9.0-RC-2',
    sourceCommit,
    cases: [test],
    jars: [{ sha256: gt }, { sha256: sl }],
    catalogProbe: {
      count: 244,
      unresolved: Array.from({ length: 243 }, (_, i) => ({
        machine: `unmapped-${i}`,
        reason: 'Unmapped blocks',
      })),
    },
  };
  const report = {
    pack: fixtures.pack,
    sourceCommit,
    passed: 0,
    failed: 1,
    loadedJars: [
      { path: 'C:\\cache\\GT5U.jar', sha256: gt },
      { path: 'C:\\cache\\SL.jar', sha256: sl },
    ],
    results: [
      {
        name: test.name,
        passed: false,
        formed: false,
        errors: [{ id: 'missing hatch' }],
        placementSha256: createHash('sha256')
          .update(JSON.stringify({ circuit: 0, cells }))
          .digest('hex'),
      },
    ],
  };
  return { fixtures, report };
}

it('retains failed and unresolved catalog cases without declaring a full semantic audit', () => {
  const { fixtures, report } = input();
  const evidence = nativeCatalogEvidence(fixtures, report);
  expect(evidence).toMatchObject({
    semanticAudit: 'partial',
    count: 244,
    formed: 0,
    rejected: 1,
    exceptions: 0,
    unresolved: 243,
  });
  expect(evidence.entries.find((e: { machine: string }) => e.machine === 'one').errors).toEqual(
    report.results[0].errors,
  );
  expect(JSON.stringify(evidence)).not.toContain('C:\\cache');
});

it('rejects missing, duplicate and stale catalog cases, including expected failures', () => {
  const { fixtures, report } = input();
  expect(() => nativeCatalogEvidence(fixtures, { ...report, results: [] })).toThrow(/every controller/);
  fixtures.catalogProbe.unresolved[0].machine = 'one';
  expect(() => nativeCatalogEvidence(fixtures, report)).toThrow(/every controller/);
  fixtures.catalogProbe.unresolved[0].machine = 'unmapped-0';
  fixtures.cases[0].cells[0].pos = [1, 0, 0];
  expect(() => nativeCatalogEvidence(fixtures, report)).toThrow(/stale/);
});

it('rejects other game jars and false positive formed results', () => {
  const { fixtures, report } = input();
  expect(() => nativeCatalogEvidence(fixtures, { ...report, loadedJars: [{ sha256: 'other' }] })).toThrow(
    /different game jars/,
  );
  expect(() =>
    nativeCatalogEvidence(fixtures, {
      ...report,
      passed: 1,
      failed: 0,
      results: [{ ...report.results[0], passed: true, formed: false }],
    }),
  ).toThrow(/inconsistent/);
});
