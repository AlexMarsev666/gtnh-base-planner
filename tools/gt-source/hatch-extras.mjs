#!/usr/bin/env node
/**
 * What GT's structure definition and check say about the hatches beyond their kinds and counts, written into the
 * catalog:
 *
 *   node tools/gt-source/hatch-extras.mjs <GT5-Unofficial checkout> [--write]
 *
 *   - `allowFaces` on legend entries: the sides a hatch of a kind may face (`hatch-faces.mjs`);
 *   - `glassTierLimits`: the hatch kinds whose tier may not exceed the tiered glass's, and the legend keys of that
 *     glass (`glass-tier.mjs`);
 *   - the `dataAccess` hatch kind of the Assembly Lines (`data-access.mjs`): on the cells of its element, with
 *     `hatchBlocks.dataAccess` and `requiredHatches.dataAccess` (at most what the controller's check allows).
 *
 * Every class is read the same way, nothing is listed per machine, and the class of a catalog entry comes from its
 * `source` (hand-made entries too). `--write` patches the JSON files (only the fields above, the rest of the text is
 * left alone) and refreshes `src/data/hatch-extras.snapshot.json`. A reading that fails is an error: the tool lists
 * the classes and writes nothing (`--partial` writes the rest). `tools/game-dump/build.mjs` applies the same code to
 * the entries it writes.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConstraints, sourceClassOf } from './casing-min.mjs';
import { dataAccessOf, DATA_ACCESS_BLOCK } from './data-access.mjs';
import { glassChars, glassLimits, tieredGlassBlocks } from './glass-tier.mjs';
import { faceLeaves, facesOf } from './hatch-faces.mjs';
import { HatchRules } from './hatch-rules.mjs';
import { jsonLine, legendOpen, openOf, props, removeProp, setProp } from './json-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MULTI_DIR = join(ROOT, 'src/data/multiblocks');

/** Order of the kinds of `glassTierLimits`. */
const LIMIT_ORDER = ['energy', 'dynamo'];

/**
 * `{ dataAccess, allowFaces, glassTierLimits, problems, notes, other }` for one catalog def: `dataAccess` is
 * `{ chars, max }` (the legend keys to give the kind) or null, `allowFaces` is `{ char: { kind: Dir[] } }`,
 * `glassTierLimits` is `{ chars, kinds }` or null. `problems` are readings that failed, `notes` readings worth a look,
 * `other` the comparisons with the glass tier that are not modelled.
 */
export function extrasOf(def, sourceClass, rules, blocks, names, glassBlocks) {
  const problems = [];
  const notes = [];
  const chain = rules.chain(sourceClass);

  const access = dataAccessOf(def, sourceClass, rules, blocks, names);
  if (access) problems.push(...access.problems);
  const dataAccess =
    access && !access.problems.length
      ? { chars: access.add, max: access.max, split: withKeys(def, access.split) }
      : null;
  // The sides are read for the legend as it will be with the data hatch.
  const staged = dataAccess ? withExtras(def, { dataAccess, allowFaces: {}, glassTierLimits: null }) : def;
  const { leaves, problems: faceProblems } = faceLeaves(rules, sourceClass);
  problems.push(...faceProblems);
  const faces = facesOf(staged, leaves);
  notes.push(...faces.notes);

  let glassTierLimits = null;
  const limits = glassLimits(chain);
  const placeable = new Set(Object.values(def.legend).flatMap((e) => e.hatches ?? []));
  const kinds = LIMIT_ORDER.filter((k) => limits.kinds.includes(k) && placeable.has(k));
  if (limits.kinds.length && !kinds.length)
    problems.push(`${sourceClass}: the glass tier limits ${limits.kinds.join(', ')}, which no cell takes`);
  if (kinds.length)
    try {
      glassTierLimits = { chars: glassChars(def, sourceClass, rules, blocks, names, glassBlocks), kinds };
    } catch (e) {
      problems.push(`${sourceClass}: ${e.message}`);
    }
  return { dataAccess, allowFaces: faces.allowFaces, glassTierLimits, problems, notes, other: limits.other };
}

const KEY_CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];

/** The splits (`{ from, cells }`) with the unused legend key `to` each plain part is drawn with. */
function withKeys(def, split) {
  const used = new Set(Object.keys(def.legend));
  return split.map((s) => {
    const to = KEY_CHARS.find((c) => !used.has(c));
    used.add(to);
    return { ...s, to };
  });
}

/** `rows` (`layers[y][z]`) with the cells `"x,y,z"` of each split drawn with its `to` key. */
function splitLayers(rows, split) {
  return rows.map((layer, y) =>
    layer.map((row, z) =>
      [...row]
        .map((c, x) => split.find((s) => s.from === c && s.cells.includes([x, y, z].join(',')))?.to ?? c)
        .join(''),
    ),
  );
}

/** A def with the extras in their place in the key order (`hatchBlocks`, `requiredHatches`, before `defaultHatches`). */
export function withExtras(def, { dataAccess, allowFaces, glassTierLimits }) {
  const legend = {};
  for (const [ch, entry] of Object.entries(def.legend)) {
    const { allowFaces: _old, ...rest } = entry;
    const hatches = dataAccess?.chars.includes(ch) ? [...(rest.hatches ?? []), 'dataAccess'] : rest.hatches;
    const next = { ...rest, ...(hatches ? { hatches } : {}) };
    legend[ch] = allowFaces[ch]
      ? withAfter(next, 'allowFaces', allowFaces[ch], ['disallowFaces', 'hatches'])
      : next;
    // The plain cells of a split key are drawn with a key of their own, right after it.
    for (const s of dataAccess?.split ?? []) if (s.from === ch) legend[s.to] = { blockId: entry.blockId };
  }
  const out = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === 'glassTierLimits') continue;
    if (k === 'defaultHatches' && glassTierLimits) out.glassTierLimits = glassTierLimits;
    if (k === 'legend') out[k] = legend;
    else if (k === 'layers' && dataAccess?.split.length) out[k] = splitLayers(v, dataAccess.split);
    else if (k === 'hatchBlocks' && dataAccess) out[k] = { ...v, dataAccess: DATA_ACCESS_BLOCK };
    else if (k === 'requiredHatches' && dataAccess)
      out[k] = { ...v, dataAccess: { min: 0, ...(dataAccess.max === null ? {} : { max: dataAccess.max }) } };
    else out[k] = v;
  }
  return out;
}

/** `entry` with `key` placed right after the last of `anchors` it has (at the end when none). */
function withAfter(entry, key, value, anchors) {
  const at = Math.max(...anchors.map((a) => Object.keys(entry).indexOf(a)));
  const out = [];
  Object.entries(entry).forEach(([k, v], i) => {
    out.push([k, v]);
    if (i === at) out.push([key, value]);
  });
  if (at < 0) out.push([key, value]);
  return Object.fromEntries(out);
}

/** The JSON text of a def with the extras set (or removed), changing nothing else. */
export function patchDef(text, def, { dataAccess, allowFaces, glassTierLimits }) {
  let out = text;
  const entry = (ch) => legendOpen(out, ch);
  for (const ch of Object.keys(def.legend)) {
    let open = entry(ch);
    if (dataAccess?.chars.includes(ch)) {
      const hatches = [...(def.legend[ch].hatches ?? []), 'dataAccess'];
      out = setProp(out, open, 'hatches', hatches, { before: 'disallowFaces' });
      open = entry(ch);
    }
    out = allowFaces[ch]
      ? setProp(out, open, 'allowFaces', allowFaces[ch], { before: 'region' })
      : removeProp(out, open, 'allowFaces');
  }
  for (const s of dataAccess?.split ?? []) {
    const legend = openOf(out, ['legend']);
    const keys = props(out, legend).map((p) => p.key);
    const next = keys[keys.indexOf(s.from) + 1];
    out = setProp(out, legend, s.to, { blockId: def.legend[s.from].blockId }, { before: next });
  }
  if (dataAccess?.split.length)
    out = setProp(out, openOf(out, []), 'layers', splitLayers(JSON.parse(out).layers, dataAccess.split));
  if (dataAccess) {
    out = setProp(out, openOf(out, ['hatchBlocks']), 'dataAccess', JSON.stringify(DATA_ACCESS_BLOCK));
    const required = { min: 0, ...(dataAccess.max === null ? {} : { max: dataAccess.max }) };
    out = setProp(out, openOf(out, ['requiredHatches']), 'dataAccess', required);
  }
  // Always last before `defaultHatches`, after the `minCasings` casing-min.mjs puts there.
  out = removeProp(out, openOf(out, []), 'glassTierLimits');
  return glassTierLimits
    ? setProp(out, openOf(out, []), 'glassTierLimits', jsonLine(glassTierLimits), {
        before: 'defaultHatches',
      })
    : out;
}

async function formatted(file, text) {
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

/**
 * Readers over a checkout: `of(def)` is `extrasOf` for a catalog def (null without a `source` class). Used by
 * `run` and by tools/game-dump/build.mjs.
 */
export async function createExtras(checkout, rules = new HatchRules(checkout)) {
  const { blocks, names } = await createConstraints(checkout, rules);
  const glassBlocks = tieredGlassBlocks(rules, blocks);
  return {
    of(def) {
      const cls = sourceClassOf(def);
      return cls ? extrasOf(def, cls, rules, blocks, names, glassBlocks) : null;
    },
  };
}

export async function run(
  checkout,
  { write = false, partial = false, dir = MULTI_DIR, log = console.log } = {},
) {
  const extras = await createExtras(checkout);
  const results = [];
  const problems = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const file = join(dir, f);
    const text = readFileSync(file, 'utf8');
    const def = JSON.parse(text);
    const r = extras.of(def);
    if (!r) continue;
    problems.push(...r.problems);
    results.push({ file, text, def, ...r });
  }
  const faced = results.filter((r) => Object.keys(r.allowFaces).length);
  const limited = results.filter((r) => r.glassTierLimits);
  const access = results.filter((r) => r.dataAccess);
  const entries = faced.reduce((n, r) => n + Object.keys(r.allowFaces).length, 0);
  log(`allowFaces: ${faced.length} entries, ${entries} legend entries`);
  log(`glassTierLimits: ${limited.length} entries`);
  log(`dataAccess: ${access.length} entries`);
  for (const r of results) for (const n of r.notes) log(`note: ${n}`);
  for (const r of results) for (const o of r.other) log(`glass tier, not modelled: ${r.def.id}: ${o}`);
  if (problems.length) {
    log(`\n${problems.length} problems:`);
    for (const p of problems) log(`  ${p}`);
    if (!partial) return { ok: false, results };
  }
  if (!write) return { ok: true, results };
  for (const r of results) {
    if (r.problems.length) continue;
    const out = await formatted(r.file, patchDef(r.text, r.def, r));
    if (out !== r.text) writeFileSync(r.file, out);
  }
  // The catalog ids that carry each field, for src/data/hatch-extras.test.ts.
  const ids = (list) => list.map((r) => r.def.id).sort();
  const snapshot = {
    allowFaces: Object.fromEntries(faced.map((r) => [r.def.id, r.allowFaces])),
    glassTierLimits: ids(limited),
    dataAccess: ids(access),
  };
  const file = join(dir, '../hatch-extras.snapshot.json');
  writeFileSync(file, await formatted(file, JSON.stringify(snapshot)));
  return { ok: true, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkout = args.find((a) => !a.startsWith('--'));
  if (!checkout) {
    console.error(
      'usage: node tools/gt-source/hatch-extras.mjs <GT5-Unofficial checkout> [--write] [--partial]',
    );
    process.exit(1);
  }
  run(checkout, { write: args.includes('--write'), partial: args.includes('--partial') }).then(
    (r) => process.exit(r.ok ? 0 : 1),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
