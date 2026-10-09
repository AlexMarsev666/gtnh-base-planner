#!/usr/bin/env node
/** Resolve unconditional casing minima to the actual counted block, not every hatchable legend cell.
 * Unsupported expressions stay pending. Usage: node casings-rc2.mjs <checkout> <audit.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from './registry.mjs';
import { findCalls, methodBody, splitArgs, classBody } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const [root, auditFile] = process.argv.slice(2);
const audit = JSON.parse(readFileSync(auditFile, 'utf8'));
const registry = new Registry(root, []);
// Existing planner IDs are preserved; these aliases name the same registered RC2 block and metadata.
const aliases = {
  'gregtech:gt.blockcasings@10': 'gt.casing.bronzePlated',
  'gregtech:gt.blockcasings2@0': 'gt.casing.solidSteel',
  'gregtech:gt.blockcasings2@1': 'gt.casing.frostProof',
  'gregtech:gt.blockcasingsNH@2': 'gt.casing.pyrolyseOven',
  'gregtech:gt.blockcasings4@1': 'gt.casing.cleanStainless',
  'gregtech:gt.blockcasings8@0': 'gt.casing.chemicallyInert',
  'gregtech:gt.blockcasings10@3': 'gt.casing.pressureContainment',
  'gregtech:gt.blockcasings10@15': 'gt.casing.reinforcedWooden',
  'miscutils:miscutils.blockcasings@0': 'gtpp.casing.centrifuge',
};
function registeredBlock(field, meta, ids) {
  const casings = /^sBlockCasings(\d+)$/.exec(field);
  if (casings) return `gregtech:gt.blockcasings${casings[1] === '1' ? '' : casings[1]}@${meta}`;
  if (field === 'sBlockReinforced') return `gregtech:gt.blockreinforced@${meta}`;
  if (field === 'sBlockCasingsNH') return `gregtech:gt.blockcasingsNH@${meta}`;
  // The headless dump supplies the registered namespace. Match a resolved constructor name to
  // exactly one dumped block rather than inferring a mod ID from the Java package.
  const info = registry.blockInfo(field);
  if (info?.unloc) {
    const candidates = [...ids, ...Object.keys(aliases)].filter((id) =>
      id.endsWith(`:${info.unloc}@${meta}`),
    );
    const unique = [...new Set(candidates)];
    if (unique.length === 1) return unique[0];
  }
  return undefined;
}
function blockOf(element, ids) {
  const casing = /^Casings\.(\w+)\.asElement\(\)$/.exec(element.trim());
  if (casing) {
    const info = registry.casingsEnum.get(casing[1]);
    return info && registeredBlock(info.field, info.meta, ids);
  }
  const calls = findCalls(element, 'ofBlock');
  if (calls.length !== 1 || element.trim() !== element.slice(calls[0].start, calls[0].end)) return;
  const [field, meta] = splitArgs(calls[0].args);
  if (!/^\d+$/.test(meta ?? '')) return;
  return registeredBlock(field.split('.').pop(), Number(meta), ids);
}
const result = {};
for (const entry of audit.entries) {
  const def = JSON.parse(readFileSync(join('src/data/multiblocks', `${entry.id}.json`), 'utf8'));
  const ids = new Set(Object.values(def.legend).map((cell) => cell.blockId));
  const rules = [];
  for (const item of entry.chain) {
    const fileSource = readPinnedSource(root, item.path);
    const source = classBody(fileSource, item.class) ?? fileSource;
    const body = methodBody(source, 'checkMachine');
    if (!body) continue;
    for (const call of findCalls(body, 'checkCasingMin')) {
      // Only a standalone call at method scope; nested and conditional expressions need an adapter.
      const prefix = body.slice(0, call.start);
      const depth = [...prefix].reduce((n, c) => n + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
      if (depth || prefix.slice(prefix.lastIndexOf('\n') + 1).trim()) continue;
      const [errors, counter, expression] = splitArgs(call.args);
      // MIN_CASINGS is intentionally different in many controllers. A field on this checked class
      // takes precedence over the global index, which drops such ambiguous unqualified names.
      const local =
        expression && /^\w+$/.test(expression)
          ? new RegExp(
              `(?:static\\s+final|final\\s+static)\\s+(?:int|short|byte)\\s+${expression}\\s*=\\s*(\\d+)\\s*;`,
            ).exec(source)
          : undefined;
      const n = /^\d+$/.test(expression ?? '')
        ? Number(expression)
        : local
          ? Number(local[1])
          : registry.globalInts.get(expression);
      if (errors !== 'errors' || !/^\w+$/.test(counter ?? '') || n === undefined) continue;
      const blocks = new Set();
      const countedFixed = new Set();
      let unresolved = false;
      const increments = (callback) => {
        const ref = /::(\w+)$/.exec(callback ?? '');
        const callbackBody = ref ? (methodBody(source, ref[1]) ?? '') : callback;
        return new RegExp(`(?:\\+\\+\\s*(?:\\w+\\.)?${counter}\\b|\\b(?:\\w+\\.)?${counter}\\s*\\+\\+)`).test(
          callbackBody ?? '',
        );
      };
      for (const pass of findCalls(source, 'onElementPass')) {
        const [callback, element] = splitArgs(pass.args);
        if (!increments(callback)) continue;
        const block = blockOf(element ?? '', ids);
        const id = block && (ids.has(block) ? block : ids.has(aliases[block]) ? aliases[block] : undefined);
        if (id) blocks.add(id);
        else unresolved = true;
      }
      // Identical block IDs can be structural decor that does not increment this counter. The dump
      // distinguishes fixed cells from hatchable ones, so keep that distinction when it suffices.
      let hasUncountedFixed = false;
      for (const add of findCalls(source, 'addElement')) {
        const [, element] = splitArgs(add.args);
        if (!element) continue;
        const elements = [element, ...findCalls(element, 'onElementPass').map((p) => splitArgs(p.args)[1])];
        const referenced = elements.flatMap((e) => {
          if (!e) return [];
          const block = blockOf(e, ids);
          const id = block && (ids.has(block) ? block : aliases[block]);
          return id && blocks.has(id) ? [id] : [];
        });
        if (
          !referenced.length ||
          /buildHatchAdder|ofHatchAdder|ofHatchAdderOptional|ofHatchAdderGeneric/.test(element)
        )
          continue;
        const counted = findCalls(element, 'onElementPass').some((p) => increments(splitArgs(p.args)[0]));
        if (counted) referenced.forEach((id) => countedFixed.add(id));
        else hasUncountedFixed = true;
      }
      // Mixed fixed cells with the same block need an exact source-coordinate adapter, not a guess.
      if (hasUncountedFixed && countedFixed.size) unresolved = true;
      if (!unresolved && blocks.size)
        rules.push({
          blocks: [...blocks],
          min: n,
          ...(hasUncountedFixed ? { hatchableOnly: true } : {}),
          counter,
          source: item.path,
        });
    }
    if (!/super\.checkMachine\s*\(/.test(body)) break;
  }
  if (rules.length) result[entry.id] = rules;
}
writeFileSync(
  'src/data/casings.rc2.generated.json',
  JSON.stringify({ rulesVersion: audit.lock.pack, entries: result }, null, 2) + '\n',
);
writeFileSync(
  'src/data/casings.runtime.generated.json',
  JSON.stringify(
    Object.fromEntries(
      Object.entries(result).map(([id, rules]) => [
        id,
        rules.map(({ blocks, min, hatchableOnly }) => ({
          blocks,
          min,
          ...(hatchableOnly ? { hatchableOnly } : {}),
        })),
      ]),
    ),
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    controllers: Object.keys(result).length,
    rules: Object.values(result).reduce((n, rules) => n + rules.length, 0),
  }),
);
