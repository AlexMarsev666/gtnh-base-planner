#!/usr/bin/env node
/**
 * The sides a GT hatch element lets a hatch face, read from the controller's structure definition:
 *
 *   .addElement('d', buildHatchAdder(MTEAssemblyLine.class).atLeast(DataHatchElement.DataAccess)
 *       .hint(3).casingIndex(42).allowOnly(ForgeDirection.NORTH).buildAndChain(...))
 *
 * is "a hatch of that element faces north only". `LegendEntry.allowFaces` (see `src/model/multiblock/types.ts`) holds
 * it per hatch kind. Every class is read the same way, nothing is listed per machine:
 *
 *   node tools/gt-source/hatch-faces.mjs <GT5-Unofficial checkout> <source class> [...]
 *
 * prints the elements' sides. What is read:
 *   - `.allowOnly(ForgeDirection...)`, `.disallowOnly(ForgeDirection...)` (the complement of the six sides) and the
 *     directions of `X.newAny(casingIndex, dot, ForgeDirection...)` (`IHatchElement.newAny`, an `allowOnly`); the last
 *     one of an element wins, as in `HatchElementBuilder`. GT only uses them to pick the side an auto-placed hatch
 *     faces (survival hologram), but they say where the slices of the structure leave room for one.
 *   - the directions are in the structure's own frame, where the controller faces NORTH (`ExtendedFacing`'s default),
 *     UP is up and EAST / WEST are the sides: a catalog def turns them with `controller.facing`, so NORTH is always
 *     the controller's front. (GT only names EAST and WEST together, so the planner's X mirror does not matter.)
 *   - an element is one `addElement` call; a chain (`ofChain`, `buildAndChain`) is read member by member, each with
 *     its own sides and kinds (the casing block at the end of a chain places no hatch).
 *
 * Which legend entry gets them (`facesOf`): an entry that names a zone `dot<N>` takes the elements that carry hint dot
 * N (any of their members), an entry without one (hand-made) the elements of the whole class. Where several elements
 * share a dot but the dump gave them different keys (the Dangote Distillus's rings and top), an entry keeps the
 * elements whose kinds hold all the kinds of the entry (the way `kindsForCell` tells cells apart), when there are
 * any. For each kind the entry takes, the sides are the union over the remaining elements' members that accept the
 * kind; one member that accepts it on every side (or has no restriction) leaves the kind unrestricted. Keys the dump
 * merged from elements with the same kinds (the Power Sub-Station's rings and ends) stay a union.
 */
import { pathToFileURL } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import { chainMembers, elementCalls, leaf } from './hatch-elements.mjs';
import { findCalls, splitArgs } from './java.mjs';

/** Sides in the order they are written to the catalog. */
export const DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];
const HORIZONTAL = ['north', 'east', 'south', 'west'];

/** A GT side in the planner's local frame of a controller facing `facing`. */
export function toLocal(dir, facing) {
  const i = HORIZONTAL.indexOf(dir);
  if (i < 0) return dir;
  return HORIZONTAL[(i + HORIZONTAL.indexOf(facing)) % 4];
}

const dirName = (arg) => {
  const m = /^(?:\w+\.)?(NORTH|SOUTH|EAST|WEST|UP|DOWN)$/.exec(arg.trim());
  return m ? m[1].toLowerCase() : null;
};

/** The member expressions of an element, chains flattened (a single element is its own member). */
export function memberTexts(expr) {
  const members = chainMembers(expr);
  return members ? members.flatMap(memberTexts) : [expr.trim()];
}

/**
 * The sides one element member lets a hatch face: a Set of the six names, or null without a restriction. Throws
 * when a call names its sides in a way that cannot be read.
 */
export function allowedSides(text) {
  let found = null;
  const take = (at, args, complement) => {
    const dirs = args.map(dirName);
    if (dirs.includes(null)) throw new Error(`unreadable sides: ${args.join(', ')}`);
    const named = new Set(dirs);
    if (!found || at > found.at)
      found = { at, set: new Set(DIRS.filter((d) => named.has(d) !== complement)) };
  };
  for (const [name, complement] of [
    ['allowOnly', false],
    ['disallowOnly', true],
  ])
    for (const c of findCalls(text, name))
      if (text[c.start - 1] === '.') take(c.start, splitArgs(c.args), complement);
  // `IHatchElement.newAny(casingIndex, dot, ForgeDirection...)`; the other overload takes a predicate.
  for (const c of findCalls(text, 'newAny')) {
    const rest = splitArgs(c.args).slice(2);
    if (rest.length && rest.every((a) => dirName(a))) take(c.start, rest, false);
  }
  // An empty set makes GT use the default facing, the same as no restriction.
  return found && found.set.size > 0 && found.set.size < DIRS.length ? found.set : null;
}

/**
 * Every hatch-bearing member of the controller's structure elements: `{ char, dot, kinds, allowed }` (`allowed`
 * is a Set of GT-frame sides, or null). `problems` lists the elements whose sides could not be read.
 */
export function faceLeaves(rules, sourceClass) {
  const { calls, ctx } = elementCalls(rules, sourceClass);
  const leaves = [];
  const problems = [];
  for (const { char, expr } of calls)
    for (const text of memberTexts(expr)) {
      const { dot, kinds } = leaf(text, ctx);
      if (!kinds.size) continue;
      try {
        leaves.push({ char, dot, kinds: [...kinds], allowed: allowedSides(text) });
      } catch (e) {
        problems.push(`${sourceClass}: element '${char}': ${e.message}`);
      }
    }
  return { leaves, problems };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * `allowFaces` for the legend entries of a catalog def: `{ allowFaces, notes }`, `allowFaces` as `{ char: { kind:
 * Dir[] } }` (only entries and kinds that GT restricts). A restriction an entry already states as `disallowFaces`
 * (its complement) is not repeated; one that disagrees with it is written and noted.
 */
export function facesOf(def, leaves) {
  const facing = def.controller?.facing ?? 'north';
  const allowFaces = {};
  const notes = [];
  for (const [ch, entry] of Object.entries(def.legend)) {
    const zone = /^dot(\d+)$/.exec(entry.region ?? '');
    const carrying = zone
      ? new Set(leaves.filter((l) => l.dot === Number(zone[1])).map((l) => l.char))
      : null;
    let pool = carrying ? leaves.filter((l) => carrying.has(l.char)) : leaves;
    const fits = [...new Set(pool.map((l) => l.char))].filter((c) => {
      const has = new Set(leaves.filter((l) => l.char === c).flatMap((l) => l.kinds));
      return (entry.hatches ?? []).every((k) => has.has(k));
    });
    if (fits.length) pool = pool.filter((l) => fits.includes(l.char));
    for (const kind of entry.hatches ?? []) {
      const taking = pool.filter((l) => l.kinds.includes(kind));
      if (!taking.length || taking.some((l) => !l.allowed)) continue;
      const open = new Set(taking.flatMap((l) => [...l.allowed].map((d) => toLocal(d, facing))));
      const dirs = DIRS.filter((d) => open.has(d));
      if (dirs.length === DIRS.length) continue;
      const blocked = entry.disallowFaces?.[kind];
      if (blocked) {
        const rest = DIRS.filter((d) => !blocked.includes(d));
        if (sameSet(rest, dirs)) continue;
        notes.push(
          `${def.id}: '${ch}' ${kind}: GT allows ${dirs.join(', ')}, the entry's disallowFaces leaves ${rest.join(', ')}`,
        );
      }
      (allowFaces[ch] ??= {})[kind] = dirs;
    }
  }
  return { allowFaces, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, ...classes] = process.argv.slice(2);
  const rules = new HatchRules(root);
  for (const cls of classes) {
    const { leaves, problems } = faceLeaves(rules, cls);
    console.log(cls);
    for (const l of leaves)
      console.log(
        `  '${l.char}' dot ${l.dot ?? '-'}: ${l.kinds.join(', ')}  ${l.allowed ? [...l.allowed].join(', ') : 'any side'}`,
      );
    for (const p of problems) console.log(`  problem: ${p}`);
  }
}
