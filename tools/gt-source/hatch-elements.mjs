#!/usr/bin/env node
/**
 * Hatch kinds of every hint dot of a GT controller, read from its structure definition:
 *
 *   .addElement('b', buildHatchAdder(MTEFoo.class).atLeast(InputBus, Energy).casingIndex(16).hint(2).build())
 *
 * is "a cell the hologram marks with dot 2 takes an Input Bus and an Energy Hatch". The game dump records the
 * kinds of the cells it could probe through StructureLib's `IHatchElement` list; elements built any other way
 * (fusion's energy injector, the steam buses, TecTech's multi-amp hatches, `ofHatchAdder(Foo::addToMachineList)`)
 * show up in it as a hint dot with no kinds. This reader gives the missing kinds, the same way for every class:
 *
 *   node tools/gt-source/hatch-elements.mjs <GT5-Unofficial checkout> <source class> [...]
 *
 * Which element is read: the nearest class of the controller's chain (nested class, its outer class, its
 * superclasses) that calls `.addElement(`. In each element, a hatch-bearing call has
 *   - a dot: `.hint(N)`, `.dot(N)`, `X.newAny(casingIndex, N, ...)`, `ofHatchAdder(adder, casingIndex, N)`,
 *     `ofHatchAdderOptional(adder, casingIndex, N, block, meta)` (an `int` constant of the class works too);
 *   - kinds: the element names it mentions (`atLeast(...)`, `.or(...)`, `X.newAny`: `ELEMENT_KIND`), the classes of
 *     `.hatchClass(X.class)` (`CLASS_KIND`) and, when it names none, the adder method of `ofHatchAdder` /
 *     `.adder(Foo::bar)`: `ADDER_KIND` by name, else the hatch classes the method's body tests with `instanceof`.
 * A chain (`ofChain(a, b, ...)`, `x.buildAndChain(a, b, ...)`) is one cell: its dot is the first member's that has
 * one (the hologram shows that member's hint) and its kinds are those of all members. Element names that are
 * machine-specific (data, laser, beamline, ...) are not in the tables and give no kind.
 */
import { pathToFileURL } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import { findCalls, intFields, matchClose, methodBody, splitArgs } from './java.mjs';

/** Names of `HatchElement`, `SteamHatchElement`, `GTPPHatchElement` and TecTech's `HatchElement` constants → kinds. */
export const ELEMENT_KIND = {
  InputBus: 'itemIn',
  OutputBus: 'itemOut',
  InputHatch: 'fluidIn',
  SolidifierHatch: 'fluidIn',
  CryotheumHatch: 'fluidIn',
  PyrotheumHatch: 'fluidIn',
  OutputHatch: 'fluidOut',
  // Only plain Energy and Dynamo Hatches: ExoticEnergy, MultiAmpEnergy, EnergyMulti, TTEnergy, ExoticDynamo,
  // DynamoMulti and TTDynamo take the multi-amp and laser hatches, which `addEnergyInputToMachineList` and
  // `addDynamoToMachineList` (MTEMultiBlockBase) turn away, so they give no kind.
  Energy: 'energy',
  Dynamo: 'dynamo',
  Maintenance: 'maintenance',
  Muffler: 'muffler',
  InputBus_Steam: 'itemIn',
  OutputBus_Steam: 'itemOut',
  // The Assembly Lines' own `DataHatchElement.DataAccess` (`MTEHatchDataAccess`).
  DataAccess: 'dataAccess',
};

/** Hatch classes named in `.hatchClass(X.class)` → kinds. */
export const CLASS_KIND = {
  MTEHatchInput: 'fluidIn',
  MTEHatchInputBus: 'itemIn',
  MTEHatchOutput: 'fluidOut',
  MTEHatchOutputBus: 'itemOut',
  MTEHatchEnergy: 'energy',
  MTEHatchDynamo: 'dynamo',
  MTEHatchMaintenance: 'maintenance',
  MTEHatchMuffler: 'muffler',
  MTEHatchSteamBusInput: 'itemIn',
  MTEHatchSteamBusOutput: 'itemOut',
  MTEHatchDataAccess: 'dataAccess',
};

const EVERY_HATCH = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'energy',
  'dynamo',
  'maintenance',
  'muffler',
];
/**
 * `IGTHatchAdder` methods (`add<X>ToMachineList`, `add<X>`) → kinds. `addToMachineList` (MTEMultiBlockBase) and
 * TecTech's `addClassicToMachineList` switch over every plain bus and hatch class: input and output buses and
 * hatches, energy, dynamo, maintenance and muffler. The exotic and multi-amp adders give no kind (see ELEMENT_KIND).
 */
export const ADDER_KIND = {
  addToMachineList: EVERY_HATCH,
  addClassicToMachineList: EVERY_HATCH,
  addInputToMachineList: ['itemIn', 'fluidIn'],
  addInputBusToMachineList: ['itemIn'],
  addInputHatchToMachineList: ['fluidIn'],
  addOutputToMachineList: ['itemOut', 'fluidOut'],
  addOutputBusToMachineList: ['itemOut'],
  addOutputHatchToMachineList: ['fluidOut'],
  addEnergyInputToMachineList: ['energy'],
  addDynamoToMachineList: ['dynamo'],
  addMaintenanceToMachineList: ['maintenance'],
  addMufflerToMachineList: ['muffler'],
  addSteamBusInput: ['itemIn'],
  addSteamBusOutput: ['itemOut'],
  addDataAccessToMachineList: ['dataAccess'],
};

/** Calls whose argument at index `at` is a hint dot. */
const DOT_ARG = { newAny: 1, ofHatchAdder: 2, ofHatchAdderOptional: 2 };

/**
 * Kinds an adder method of the controller accepts, from its body: the hatch classes it tests with `instanceof`
 * (CLASS_KIND), except those it turns away (`if (x instanceof Foo) return false;`).
 */
function adderKinds(body) {
  if (!body) return [];
  const out = new Set();
  for (const m of body.matchAll(/instanceof\s+(\w+)(?:\s+\w+)?\s*\)\s*(\{\s*)?(return\s+false)?/g))
    if (CLASS_KIND[m[1]] && !m[3]) out.add(CLASS_KIND[m[1]]);
  return [...out];
}

const words = (text) => text.match(/[A-Za-z_]\w*/g) ?? [];

/** A dot argument: an integer literal or an `int` constant of the class. */
function dotOf(arg, ints) {
  const t = (arg ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const v = ints.get(t.replace(/^.*\./, ''));
  return typeof v === 'number' ? v : null;
}

/** `{ dot, kinds }` of a single (non-chain) element expression; `dot` is null without one. */
export function leaf(text, ctx) {
  const { ints } = ctx;
  let dot = null;
  const found = (n) => {
    if (dot === null && n !== null) dot = n;
  };
  for (const name of ['hint', 'dot'])
    for (const c of findCalls(text, name)) if (text[c.start - 1] === '.') found(dotOf(c.args, ints));
  for (const [name, at] of Object.entries(DOT_ARG))
    for (const c of findCalls(text, name)) found(dotOf(splitArgs(c.args)[at], ints));
  const kinds = new Set();
  for (const w of words(text.replace(/\.class\b/g, ''))) {
    if (ELEMENT_KIND[w]) kinds.add(ELEMENT_KIND[w]);
    // A local `IHatchElement` (the Distillation Tower's layered output hatch) is read through its initialiser.
    else for (const v of words(ctx.elementOf?.(w) ?? '')) if (ELEMENT_KIND[v]) kinds.add(ELEMENT_KIND[v]);
  }
  for (const c of findCalls(text, 'hatchClass')) {
    const cls = c.args.replace(/\.class\s*$/, '').trim();
    if (CLASS_KIND[cls]) kinds.add(CLASS_KIND[cls]);
  }
  // An adder method decides what the call takes only when no element names the hatches
  // (`atLeast(InputHatch.withAdder(Foo::bar))` only changes where an Input Hatch is registered).
  if (!kinds.size)
    for (const m of text.matchAll(/::\s*(\w+)/g))
      for (const k of ADDER_KIND[m[1]] ?? adderKinds(ctx.bodyOf(m[1]))) kinds.add(k);
  return { dot, kinds };
}

/**
 * The members of a chain (`ofChain(a, b, ...)`, `x.buildAndChain(a, b, ...)`), or null for a single element. The
 * receiver of `buildAndChain` is the first member (it keeps its own `.allowOnly(...)`).
 */
export function chainMembers(expr) {
  const t = expr.trim();
  const members = [];
  const chain = /^(?:[\w.]*\.)?ofChain\s*\(/.exec(t);
  const build = /\.buildAndChain\s*\(/.exec(t);
  if (chain) {
    const open = t.indexOf('(', chain.index);
    members.push(...splitArgs(t.slice(open + 1, matchClose(t, open))));
  } else if (build) {
    members.push(t.slice(0, build.index));
    const open = t.indexOf('(', build.index);
    members.push(...splitArgs(t.slice(open + 1, matchClose(t, open))));
  }
  return members.length ? members : null;
}

/** `{ dot, kinds }` of an element expression; chains are one cell (see the file comment). */
export function readElement(expr, ctx = { ints: new Map(), bodyOf: () => null }) {
  const members = chainMembers(expr);
  if (!members) return leaf(expr.trim(), ctx);
  const parts = members.map((m) => readElement(m, ctx));
  return {
    dot: parts.find((p) => p.dot !== null)?.dot ?? null,
    kinds: new Set(parts.flatMap((p) => [...p.kinds])),
  };
}

/**
 * The `.addElement('c', expr)` calls of the nearest class of the chain that has any: `{ from, calls, ctx }`, with
 * `calls` as `{ char, expr }` and `ctx` (`{ ints, bodyOf, elementOf }`) for `readElement` / `leaf`.
 */
export function elementCalls(rules, sourceClass) {
  const chain = rules.chain(sourceClass);
  for (const c of chain) {
    const calls = findCalls(c.body, 'addElement').filter((x) => c.body[x.start - 1] === '.');
    if (!calls.length) continue;
    const ctx = {
      ints: new Map(chain.flatMap((x) => [...intFields(rules.src(x.file))])),
      bodyOf: (name) => chain.map((x) => methodBody(x.body, name)).find((b) => b !== null) ?? null,
      elementOf: (name) => {
        const re = new RegExp(`\\bIHatchElement\\s*(?:<[^>]*>)?\\s+${name}\\s*=\\s*([^;]+);`);
        return chain.map((x) => re.exec(x.body)?.[1]).find((e) => e !== undefined) ?? null;
      },
    };
    const found = [];
    for (const call of calls) {
      const args = splitArgs(call.args);
      if (args.length < 2) continue;
      found.push({ char: /^'(.)'$/.exec(args[0])?.[1] ?? null, expr: args.slice(1).join(',') });
    }
    return { from: c.name, calls: found, ctx };
  }
  return { from: null, calls: [], ctx: null };
}

/**
 * Dot → the hatch elements that carry it (`Map<number, Set<string>[]>`, one kind set per distinct element; tooltip
 * dot numbering; each set has a `foreign` property, see below), plus `from`, the class the elements were read in.
 */
export function elementKinds(rules, sourceClass) {
  const out = new Map();
  const { from, calls, ctx } = elementCalls(rules, sourceClass);
  for (const { expr } of calls) {
    const { dot, kinds } = readElement(expr, ctx);
    if (dot === null || !kinds.size) continue;
    // A chain member that names a dot of its own (the muffler on the Dangote Distillus's rings, dot 3) is counted in
    // the chain's kinds; `kinds.foreign` holds the kinds only such members bring.
    const members = chainMembers(expr)?.map((m) => readElement(m, ctx)) ?? [];
    const here = members.filter((p) => p.dot === null || p.dot === dot).flatMap((p) => [...p.kinds]);
    kinds.foreign = new Set([...kinds].filter((k) => members.length && !here.includes(k)));
    const sets = out.get(dot) ?? [];
    if (!sets.some((x) => x.size === kinds.size && [...kinds].every((k) => x.has(k)))) sets.push(kinds);
    out.set(dot, sets);
  }
  return { dots: out, from };
}

/**
 * The kinds to add to a cell that shows dot N, given the elements carrying N (`sets`) and the kinds the dump
 * already gives the cell. Elements may share a dot (the Circuit Assembly Line's energy hatch and first input bus
 * are both dot 3), so a cell takes the elements whose kind set contains all the dump's kinds for it, the smallest
 * one (the most specific; the union of those tied). If none contains them the cell keeps the dump's kinds. A cell
 * the dump gave no kinds takes the element only when it is the dot's only one.
 */
export function kindsForCell(sets, dumpKinds) {
  if (!sets?.length) return [];
  if (!dumpKinds.length) return sets.length === 1 ? [...sets[0]] : [];
  const fits = sets.filter((x) => dumpKinds.every((k) => x.has(k)));
  const least = Math.min(...fits.map((x) => x.size));
  return [...new Set(fits.filter((x) => x.size === least).flatMap((x) => [...x]))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, ...classes] = process.argv.slice(2);
  const rules = new HatchRules(root);
  for (const cls of classes) {
    const { dots, from } = elementKinds(rules, cls);
    console.log(cls, `(read in ${from})`);
    for (const [dot, kinds] of [...dots].sort((a, b) => a[0] - b[0]))
      console.log(`  dot ${dot}: ${kinds.map((k) => [...k].join(', ')).join(' | ')}`);
  }
}
