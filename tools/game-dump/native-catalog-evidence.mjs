import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { assertNativeJars } from './native-jars.mjs';

/** Diagnostic evidence retains failures and unresolved entries; it never declares a semantic audit complete. */
export function nativeCatalogEvidence(fixtures, report) {
  if (
    fixtures.schema !== 1 ||
    fixtures.catalogProbe?.count !== 244 ||
    fixtures.pack !== '2.9.0-RC-2' ||
    report.pack !== fixtures.pack ||
    report.sourceCommit !== fixtures.sourceCommit ||
    report.sourceCommit !== 'a3e1e11241a814c9fa0dd0973d5699548428f689'
  )
    throw new Error('Catalog report uses an unsupported schema or source revision.');
  const unresolved = fixtures.catalogProbe.unresolved;
  const machines = [...fixtures.cases.map((c) => c.machine), ...unresolved.map((u) => u.machine)];
  if (
    machines.length !== 244 ||
    new Set(machines).size !== 244 ||
    report.results.length !== fixtures.cases.length ||
    new Set(report.results.map((r) => r.name)).size !== fixtures.cases.length ||
    report.passed !== report.results.filter((r) => r.passed).length ||
    report.failed !== report.results.filter((r) => !r.passed).length
  )
    throw new Error('Catalog report does not account for every controller.');
  assertNativeJars(fixtures, report);
  const entries = fixtures.cases.map((test) => {
    const result = report.results.find((r) => r.name === test.name);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          circuit: test.circuit,
          controllerFacing: test.controllerFacing,
          cells: test.cells,
          expectedHatchFields: test.expectedHatchFields,
        }),
      )
      .digest('hex');
    if (
      !result ||
      result.placementSha256 !== hash ||
      test.expectedStructure !== true ||
      (result.passed && (result.exception || result.formed !== true)) ||
      (!result.passed && !result.exception && result.formed !== false)
    )
      throw new Error(`Catalog result is stale or inconsistent for ${test.machine}.`);
    return {
      machine: test.machine,
      source: test.source,
      status: result.exception ? 'native-exception' : result.formed ? 'default-formed' : 'default-rejected',
      placementSha256: hash,
      errors: result.errors,
      exception: result.exception,
    };
  });
  entries.push(...unresolved.map(({ machine, reason }) => ({ machine, status: 'unresolved', reason })));
  entries.sort((a, b) => a.machine.localeCompare(b.machine));
  return {
    schema: 1,
    semanticAudit: 'partial',
    scope: 'One default placement per controller; no proof of all conditional or resource rules.',
    pack: report.pack,
    sourceCommit: report.sourceCommit,
    loadedJars: report.loadedJars.map(({ path, ...jar }) => ({
      ...jar,
      artifact: basename(path.replaceAll('\\', '/')),
    })),
    count: 244,
    formed: entries.filter((e) => e.status === 'default-formed').length,
    rejected: entries.filter((e) => e.status === 'default-rejected').length,
    exceptions: entries.filter((e) => e.status === 'native-exception').length,
    unresolved: unresolved.length,
    entries,
  };
}
