import { readFileSync, writeFileSync } from 'node:fs';
import { nativeCatalogEvidence } from './native-catalog-evidence.mjs';

const [fixturesPath, reportPath] = process.argv.slice(2);
if (!fixturesPath || !reportPath) throw new Error('Expected catalog fixture and native report paths.');
const evidence = nativeCatalogEvidence(
  JSON.parse(readFileSync(fixturesPath, 'utf8')),
  JSON.parse(readFileSync(reportPath, 'utf8')),
);
writeFileSync('tools/game-dump/catalog-results.rc2.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(
  `Catalog diagnostic: ${evidence.formed} formed, ${evidence.rejected} rejected, ${evidence.exceptions} exceptions, ${evidence.unresolved} unresolved. Semantic audit remains partial.`,
);
