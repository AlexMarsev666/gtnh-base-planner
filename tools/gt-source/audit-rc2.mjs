#!/usr/bin/env node
/** Collect pinned source evidence for every catalog controller, including its inheritance chain.
 * This is evidence collection, NOT a substitute for semantic review or game validation.
 * Usage: node tools/gt-source/audit-rc2.mjs <GT5-Unofficial checkout> <output.json> [<verified dump>/multiblocks]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { methodBody, superclass, classBody } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const [root, output, dumpDirectory] = process.argv.slice(2);
if (!root || !output) throw new Error('Expected checkout and output path.');
const lock = JSON.parse(readFileSync('tools/game-dump/rc2-source-lock.json', 'utf8'));
const files = new Map();
function visit(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) visit(p);
    else if (e.name.endsWith('.java')) {
      files.set(e.name.slice(0, -5), p);
      // Nested controllers live in the outer class's file and may have different inherited checks.
      for (const match of readFileSync(p, 'utf8').matchAll(/\bclass\s+(\w+)\b/g)) {
        if (!files.has(match[1])) files.set(match[1], p);
      }
    }
  }
}
visit(join(root, 'src/main/java'));
const dumpedClasses = new Map();
if (dumpDirectory)
  for (const file of readdirSync(dumpDirectory).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    const doc = JSON.parse(readFileSync(join(dumpDirectory, file), 'utf8'));
    dumpedClasses.set(
      `${doc.controller.registry_name}@${doc.controller.meta}`,
      doc.controller.source_class?.split(/[.$]/).pop(),
    );
  }
const catalog = readdirSync('src/data/multiblocks')
  .filter((p) => p.endsWith('.json'))
  .sort();
const entries = catalog.map((file) => {
  const def = JSON.parse(readFileSync(join('src/data/multiblocks', file), 'utf8'));
  const oldName = def.source?.match(/\/([^/]+)\.java/)?.[1];
  const name =
    dumpedClasses.get(def.controller.blockId) ??
    (oldName === 'MTESMDProcessorModule' ? 'MTEPartProcessorModule' : oldName);
  const chain = [];
  const seen = new Set();
  let current = name;
  while (files.has(current) && !seen.has(current)) {
    seen.add(current);
    const path = files.get(current);
    const source = readPinnedSource(root, relative(root, path).replaceAll('\\', '/'));
    const bodyOfClass = classBody(source, current) ?? source;
    const methods = {};
    for (const method of [
      'getStructureDefinition',
      'checkMachine',
      'checkHatch',
      'checkHatches',
      'checkProcessing',
      'getStoredFluids',
      'getStoredInputs',
      'getOutputHatches',
      'getInputBusses',
      'getOutputBusses',
      'addInputToMachineList',
      'addOutputToMachineList',
      'addEnergyInputToMachineList',
      'addMaintenanceToMachineList',
      'addMufflerToMachineList',
      'addOutput',
      'addFluidOutputs',
      'getFluidOutputSlots',
      'getItemOutputSlots',
      'createProcessingLogic',
      'getInitialAlignmentLimits',
    ]) {
      const body = methodBody(bodyOfClass, method);
      if (body) methods[method] = body;
    }
    const adders = [
      ...new Set(
        [...bodyOfClass.matchAll(/\b(?:boolean|void)\s+(add\w*(?:Hatch|Bus)\w*)\s*\(/g)].map((m) => m[1]),
      ),
    ];
    for (const method of adders) {
      const body = methodBody(bodyOfClass, method);
      if (body) methods[method] = body;
    }
    chain.push({
      class: current,
      path: relative(root, path).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(source).digest('hex'),
      methods,
    });
    current = superclass(source, current);
  }
  return {
    id: def.id,
    controller: name,
    source: chain[0]
      ? `https://github.com/GTNewHorizons/GT5-Unofficial/blob/${lock['GT5-Unofficial'].commit}/${chain[0].path}`
      : def.source,
    status: chain.length ? 'requires-semantic-review' : 'source-unresolved',
    chain,
  };
});
writeFileSync(output, JSON.stringify({ lock, count: entries.length, entries }, null, 2) + '\n');
console.log(
  JSON.stringify({
    count: entries.length,
    unresolved: entries.filter((e) => !e.chain.length).map((e) => e.id),
  }),
);
