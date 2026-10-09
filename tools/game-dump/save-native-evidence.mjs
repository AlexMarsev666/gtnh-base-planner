import { readFileSync, writeFileSync } from 'node:fs';
import { nativeEvidence } from './native-evidence.mjs';
const [fixtures, results] = process.argv.slice(2);
if (!fixtures || !results) throw new Error('Expected native fixtures JSON and results JSON.');
const evidence = nativeEvidence(
  JSON.parse(readFileSync(fixtures, 'utf8')),
  JSON.parse(readFileSync(results, 'utf8')),
);
writeFileSync('tools/game-dump/native-results.rc2.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`Saved ${evidence.passed} verified native RC2 cases.`);
