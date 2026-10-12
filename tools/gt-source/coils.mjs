#!/usr/bin/env node
/**
 * The heating coils of GT and which cells of a multiblock hold them, read from the sources:
 *
 *   node tools/gt-source/coils.mjs <GT5-Unofficial checkout> [--write]
 *
 *   - the table (`src/data/coils.generated.json`, read by `src/data/coils.ts`): every block of a class that
 *     `implements IHeatingCoil`, with the coil each of its metas is. `HeatingCoilLevel` gives the levels in order and
 *     the heat (`getHeat`), the block class its registry name (`super(ItemCasings.class, "gt.blockcasings5", ...)`),
 *     the metas (`register(N, ...)`) and the level of each meta (`getCoilHeatFromDamage`: `case N -> LEVEL`); the
 *     lang file names the level (`GT5U.coil.<LEVEL>`);
 *   - `coils` of a def (`MultiblockDef.coils`): a structure that uses `ofCoil(...)` (GTStructureUtility's heating
 *     coil element, which forms with any tier as long as all coils of the machine are the same) or tests
 *     `instanceof IHeatingCoil` itself (the Large Chemical Reactor) takes one coil; the cells are the legend keys
 *     that hold a coil block of the table (or the planner's `gt.coil.cupronickel` stand-in of a hand-made entry).
 *     Another element of the class placing such a block (a fixed `Casings.ElectrumFluxCoilBlock`) makes the keys
 *     ambiguous and fails the run.
 *
 * Every class is read the same way, nothing is listed per machine.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import { elementCalls } from './hatch-elements.mjs';
import { ClassContext } from './casing-min.mjs';
import { findCalls, matchClose, methodBody, stripComments } from './java.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The planner's own stand-in for a heating coil in a hand-made entry (`src/data/blocks.ts`). */
export const GENERIC_COILS = ['gt.coil.cupronickel'];

/** Level names of `HeatingCoilLevel` in order, and its `getHeat`: `base + step * ordinal` (`None` is 0). */
export function coilLevels(src) {
  const body = /\benum\s+HeatingCoilLevel\s*\{([\s\S]*)\}/.exec(stripComments(src))?.[1];
  if (!body) throw new Error('HeatingCoilLevel is not an enum');
  const names = body
    .slice(0, body.indexOf(';'))
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const heat =
    /\bgetHeat\s*\(\)\s*\{[^}]*?\?\s*0\s*:\s*(\d+)L?\s*\+\s*\(?\s*(\d+)L?\s*\*\s*this\.ordinal\(\)/.exec(
      body,
    );
  if (!heat) throw new Error('cannot read HeatingCoilLevel.getHeat');
  const [base, step] = [Number(heat[1]), Number(heat[2])];
  return names.map((name, i) => ({ name, heat: name === 'None' ? 0 : base + step * i }));
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The coils one block class registers: `[{ meta, level }]` in meta order. `level` is the `HeatingCoilLevel` name
 * the `getCoilHeatFromDamage` switch gives the meta, for the metas the constructor registers.
 */
export function coilMetas(body) {
  const registered = new Set([...body.matchAll(/\bregister\s*\(\s*(\d+)\s*,/g)].map((m) => Number(m[1])));
  const decl = methodBody(body, 'getCoilHeatFromDamage');
  if (!decl) throw new Error('no getCoilHeatFromDamage');
  const out = [];
  for (const m of decl.matchAll(/\bcase\s+(\d+)\s*->\s*(\w+)\s*;/g))
    if (registered.has(Number(m[1]))) out.push({ meta: Number(m[1]), level: m[2] });
  return out.sort((a, b) => a.meta - b.meta);
}

/**
 * The coil table of a checkout (`HatchRules`): `[{ id, blockId, level, heat, name }]`, in the order of the block
 * classes then their metas. `id` is the slug of the coil's name.
 */
export function coilTable(rules) {
  const levelFile = rules.files.get('HeatingCoilLevel')?.[0];
  if (!levelFile) throw new Error('no HeatingCoilLevel');
  const levels = new Map(coilLevels(rules.src(levelFile)).map((l) => [l.name, l]));
  const out = [];
  for (const [cls, paths] of [...rules.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const path of paths) {
      const src = rules.src(path);
      const m = new RegExp(`\\bclass\\s+${cls}\\b[^{]*\\bimplements\\b[^{]*\\bIHeatingCoil\\b[^{]*\\{`).exec(
        src,
      );
      if (!m) continue;
      const body = src.slice(m.index + m[0].length, matchClose(src, m.index + m[0].length - 1));
      const registry = /\bsuper\s*\([^;]*?"([\w.]+)"/.exec(body)?.[1];
      const mod = /[/\\]gregtech[/\\]/.test(path) ? 'gregtech' : null;
      if (!registry || !mod) throw new Error(`${cls}: no registry name or mod`);
      for (const { meta, level } of coilMetas(body)) {
        const info = levels.get(level);
        const name = rules.lang.get(`GT5U.coil.${level}`);
        if (!info || !name) throw new Error(`${cls} meta ${meta}: unknown level ${level}`);
        out.push({ id: slug(name), blockId: `${mod}:${registry}@${meta}`, level, heat: info.heat, name });
      }
    }
  }
  if (!out.length) throw new Error('no block class implements IHeatingCoil');
  const ids = out.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('two coils have the same name');
  return out;
}

/** Whether an element expression is a heating coil element (`ofCoil`, or a helper of the class that builds one). */
export function isCoilElement(expr, ctx) {
  if (/\bofCoil\s*\(|\bIHeatingCoil\b/.test(expr)) return true;
  for (const m of expr.matchAll(/\b(\w+)\s*\(/g)) {
    const body = ctx.bodyOf(m[1]);
    if (body && /\bofCoil\s*\(/.test(body)) return true;
  }
  return false;
}

/** Whether the class chain has a heating coil element anywhere in its code. */
export function usesCoils(chain) {
  return chain.some(
    (c) => findCalls(c.body, 'ofCoil').length > 0 || /\binstanceof\s+IHeatingCoil\b/.test(c.body),
  );
}

/**
 * `{ coils, problems }` for one catalog def: `coils` is `{ chars }` (the legend keys that hold the coil) or null
 * for a structure without a heating coil. `table` is `coilTable`'s result, `blocks` / `names` the block readers
 * (`createConstraints`). A class with coils whose legend shows no coil block is a problem, and so is another
 * element of the class placing such a block.
 */
export function coilsOf(def, sourceClass, rules, blocks, names, table) {
  const chain = rules.chain(sourceClass);
  if (!usesCoils(chain)) return { coils: null, problems: [] };
  const ids = [...table.map((c) => c.blockId), ...GENERIC_COILS];
  const chars = Object.entries(def.legend)
    .filter(([, e]) => ids.includes(e.blockId))
    .map(([ch]) => ch)
    .sort();
  if (!chars.length)
    return {
      coils: null,
      problems: [`${sourceClass}: uses heating coils, but no legend key of ${def.id} is one`],
    };
  const { calls, ctx } = elementCalls(rules, sourceClass);
  const cctx = new ClassContext(chain);
  const held = new Set(chars.map((ch) => def.legend[ch].blockId));
  for (const { char, expr } of calls) {
    if (!ctx || isCoilElement(expr, ctx)) continue;
    const clash = blocks
      .elementBlocks(expr, cctx)
      .cands.some((c) => [...held].some((id) => names.matches(c, id)));
    if (clash)
      return {
        coils: null,
        problems: [
          `${sourceClass}: element '${char}' places a heating coil block without being the coil element`,
        ],
      };
  }
  return { coils: { chars }, problems: [] };
}

/** The file the table is written to (read by `src/data/coils.ts`). */
export const TABLE_FILE = join(ROOT, 'src/data/coils.generated.json');

async function formatted(file, text) {
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkout = args.find((a) => !a.startsWith('--'));
  if (!checkout) {
    console.error('usage: node tools/gt-source/coils.mjs <GT5-Unofficial checkout> [--write]');
    process.exit(1);
  }
  const table = coilTable(new HatchRules(checkout));
  for (const c of table)
    console.log(c.blockId.padEnd(28), c.level.padEnd(4), String(c.heat).padStart(6), c.name);
  if (args.includes('--write')) writeFileSync(TABLE_FILE, await formatted(TABLE_FILE, JSON.stringify(table)));
}
