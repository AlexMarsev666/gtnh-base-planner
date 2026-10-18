#!/usr/bin/env node
/**
 * Which orientations of a multiblock GT allows, read from the controller's alignment limits and written into the
 * catalog as `MultiblockDef.variants`:
 *
 *   node tools/gt-source/orientation.mjs <GT5-Unofficial checkout> [--write]
 *
 * StructureLib keeps a controller's `ExtendedFacing` (direction, rotation = the roll about the facing axis, flip) and
 * asks `IAlignmentLimits.isNewExtendedFacingValid(direction, rotation, flip)`. `MTEEnhancedMultiBlockBase` starts from
 * `getInitialAlignmentLimits()` (`(d, r, f) -> !f.isVerticallyFliped()`) and a controller may override that, or
 * `getAlignmentLimits()`, with a lambda over `d`, `r`, `f`, one of the `IAlignmentLimits` constants or an
 * `IAlignmentLimits.Builder` chain. `isRotationChangeAllowed()` / `isFlipChangeAllowed()` returning a plain value
 * replace StructureLib's default of the wrench tools. Every class is read the same way, nothing is listed per machine; the class of a catalog
 * entry comes from its `source`.
 *
 * The planner keeps the controller facing horizontally and has four variants (`variant` 0..3, see `MultiblockDef`):
 * 0 as built, 1 mirrored left-right, 2 upside down (roll 180), 3 mirrored top-bottom. A state (rotation, flip) is the
 * variant of the mirror along X (`flip` horizontal XOR roll 180) and along Y (`flip` vertical XOR roll 180); rolls of
 * 90 degrees are not variants. `variantsOf` replays what a player can set with the wrench from placement, filtered by
 * the limits. An entry that allows all four has no field. Facing up (`d == UP`, no horizontal direction allowed) can
 * only keep the world's vertical axis: variants 0 and, when GT lets a flip through, 1.
 *
 * What it cannot know is listed: a lock that depends on the run time (`MTEForgeOfGods` while formed) counts as
 * StructureLib's default (the orientation is set before the machine forms). A class whose limits it cannot read is an error: the tool lists the classes and writes nothing
 * (`--partial` writes the rest).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceClassOf } from './casing-min.mjs';
import { HatchRules } from './hatch-rules.mjs';
import { methodBody } from './java.mjs';
import { openOf, removeProp, setProp } from './json-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MULTI_DIR = join(ROOT, 'src/data/multiblocks');

const DIRECTIONS = ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'];
const HORIZONTAL = ['NORTH', 'SOUTH', 'WEST', 'EAST'];
const ROTATIONS = ['NORMAL', 'CLOCKWISE', 'UPSIDE_DOWN', 'COUNTER_CLOCKWISE'];
const FLIPS = ['NONE', 'HORIZONTAL', 'VERTICAL', 'BOTH'];

const flippedH = (f) => f === 'HORIZONTAL' || f === 'BOTH';
const flippedV = (f) => f === 'VERTICAL' || f === 'BOTH';

/** `IAlignmentLimits`' own constants (StructureLib 1.4.45, read from its byte code). */
const CONSTANTS = {
  UNLIMITED: () => true,
  // Horizontal, and the way up is up: not rolled, or rolled 180 and flipped vertically.
  UPRIGHT: (d, r, f) => d !== 'UP' && d !== 'DOWN' && (flippedV(f) ? r === 'UPSIDE_DOWN' : r === 'NORMAL'),
  NOT_UPSIDE_DOWN: (d, r, f) =>
    d === 'UP' || d === 'DOWN' || (flippedV(f) ? r !== 'NORMAL' : r !== 'UPSIDE_DOWN'),
  FACING_UP: (d) => d === 'UP',
};

const ROTATION_TESTS = {
  isNotRotated: (r) => r === 'NORMAL',
  isUpsideDown: (r) => r === 'UPSIDE_DOWN',
  isClockwise: (r) => r === 'CLOCKWISE',
  isCounterClockwise: (r) => r === 'COUNTER_CLOCKWISE',
};
const FLIP_TESTS = {
  isNotFlipped: (f) => f === 'NONE',
  isVerticallyFliped: flippedV,
  isHorizontallyFlipped: flippedH,
  isBothFlipped: (f) => f === 'BOTH',
};

/** The predicate `(d, r, f) => boolean` of the body of an alignment lambda (`d.offsetY == 0 && r.isNotRotated()`). */
export function parseLambda(expr) {
  let rest = expr.trim();
  const eat = (re) => {
    const m = re.exec(rest);
    if (m) rest = rest.slice(m[0].length);
    return m;
  };
  const fail = () => {
    throw new Error(`cannot read "${expr.replace(/\s+/g, ' ').trim()}" at "${rest.slice(0, 40)}"`);
  };
  const or = () => {
    let p = and();
    while (eat(/^\s*\|\|/)) {
      const a = p;
      const b = and();
      p = (d, r, f) => a(d, r, f) || b(d, r, f);
    }
    return p;
  };
  const and = () => {
    let p = unary();
    while (eat(/^\s*&&/)) {
      const a = p;
      const b = unary();
      p = (d, r, f) => a(d, r, f) && b(d, r, f);
    }
    return p;
  };
  const unary = () => {
    rest = rest.trimStart();
    if (eat(/^!/)) {
      const p = unary();
      return (d, r, f) => !p(d, r, f);
    }
    return atom();
  };
  const atom = () => {
    rest = rest.trimStart();
    let m = eat(/^\(\s*d\.flag\s*&\s*\(\s*((?:ForgeDirection\.\w+\.flag\s*\|?\s*)+)\)\s*\)\s*==\s*0/);
    if (m) {
      const named = [...m[1].matchAll(/ForgeDirection\.(\w+)\.flag/g)].map((x) => x[1]);
      if (named.some((n) => !DIRECTIONS.includes(n))) fail();
      return (d) => !named.includes(d);
    }
    if ((m = eat(/^d\.offsetY\s*(==|!=)\s*0/)))
      return (d) => (d === 'UP' || d === 'DOWN') === (m[1] === '!=');
    if ((m = eat(/^d\s*(==|!=)\s*ForgeDirection\.(\w+)/))) {
      if (!DIRECTIONS.includes(m[2])) fail();
      return (d) => (d === m[2]) === (m[1] === '==');
    }
    if ((m = eat(/^r\.(\w+)\(\)/))) {
      const t = ROTATION_TESTS[m[1]];
      if (!t) fail();
      return (d, r) => t(r);
    }
    if ((m = eat(/^f\.(\w+)\(\)/))) {
      const t = FLIP_TESTS[m[1]];
      if (!t) fail();
      return (d, r, f) => t(f);
    }
    if ((m = eat(/^(true|false)\b/))) return () => m[1] === 'true';
    if (eat(/^\(/)) {
      const p = or();
      if (!eat(/^\s*\)/)) fail();
      return p;
    }
    return fail();
  };
  const p = or();
  if (rest.trim()) fail();
  return p;
}

/**
 * The predicate of an alignment limits expression: a lambda `(d, r, f) -> ...`, an `IAlignmentLimits.<CONSTANT>` or an
 * `IAlignmentLimits.Builder.allowAll()/denyAll()` chain of `.allow/.deny(ForgeDirection.X | Rotation.X | Flip.X)` ending
 * in `.build()`. Throws on anything else.
 */
export function parseLimits(expr) {
  const text = expr.trim();
  let m = /^\(\s*d\s*,\s*r\s*,\s*f\s*\)\s*->\s*([\s\S]+)$/.exec(text);
  if (m) return parseLambda(m[1]);
  m = /^(?:IAlignmentLimits\.)?(\w+)$/.exec(text);
  if (m && CONSTANTS[m[1]]) return CONSTANTS[m[1]];
  m = /^(?:IAlignmentLimits\.)?Builder\s*\.\s*(allowAll|denyAll)\s*\(\s*\)([\s\S]*)\.build\s*\(\s*\)$/.exec(
    text,
  );
  if (m) {
    const ops = [...m[2].matchAll(/\.\s*(allow|deny)\s*\(\s*(ForgeDirection|Rotation|Flip)\.(\w+)\s*\)/g)];
    const names = { ForgeDirection: DIRECTIONS, Rotation: ROTATIONS, Flip: FLIPS };
    const rebuilt = ops.map((o) => o[0]).join('');
    if (
      rebuilt.replace(/\s+/g, '') !== m[2].replace(/\s+/g, '') ||
      ops.some((o) => !names[o[2]].includes(o[3]))
    )
      throw new Error(`cannot read the builder chain "${m[2].replace(/\s+/g, ' ').trim()}"`);
    const allowed = new Map();
    const key = (d, r, f) => `${d}/${r}/${f}`;
    for (const d of DIRECTIONS)
      for (const r of ROTATIONS) for (const f of FLIPS) allowed.set(key(d, r, f), m[1] === 'allowAll');
    for (const [, op, kind, name] of ops)
      for (const d of DIRECTIONS)
        for (const r of ROTATIONS)
          for (const f of FLIPS) {
            const hit =
              kind === 'ForgeDirection' ? d === name : kind === 'Rotation' ? r === name : f === name;
            if (hit) allowed.set(key(d, r, f), op === 'allow');
          }
    return (d, r, f) => allowed.get(key(d, r, f));
  }
  throw new Error(`unknown alignment limits "${text.replace(/\s+/g, ' ').slice(0, 80)}"`);
}

/** The variant (0..3) of a mirror along X and along Y: 0 as built, 1 X, 2 both (upside down), 3 Y. */
const VARIANT = { '0,0': 0, '1,0': 1, '1,1': 2, '0,1': 3 };

/**
 * `{ variants, up }`: the variants (sorted) a player can set with the controller facing horizontally, found by
 * replaying the tools from placement (rotation NORMAL, flip NONE) as `MTEEnhancedMultiBlockBase.onWrenchRightClick`
 * and StructureLib's `IAlignment` do (decompiled 1.4.45):
 *
 *   - a wrench click on the front, when `isRotationChangeAllowed()`, is `toolSetRotation(null)`: for flip offsets 0..3
 *     and rotation offsets 1..3 (in that nesting) the first (rotation, flip) the limits allow, so it moves on to a
 *     flipped state, vertical flips included, when no other roll is valid at the current flip;
 *   - a sneaking click, when `isFlipChangeAllowed()`, is `toolSetFlip(horizontally flipped ? NONE : HORIZONTAL)`,
 *     applied when the limits allow it (a vertical flip is only ever the result of the first tool).
 *
 * `rotation` / `flip` are the controller's own override of the `...ChangeAllowed()` check: true or false when it
 * returns a plain value, null for StructureLib's default (some other roll / flip is valid at the current state).
 * Only states with rotation NORMAL or UPSIDE_DOWN are variants. `up` is set when only a facing up is allowed (nothing
 * to replay: the roll turns about the vertical axis, a flip is a mirror in the horizontal plane); the variants are then
 * the ones that keep the vertical axis.
 */
export function variantsOf(pred, { rotation = null, flip = null } = {}) {
  const found = new Set();
  let started = false;
  for (const d of HORIZONTAL) {
    if (!pred(d, 'NORMAL', 'NONE')) continue;
    started = true;
    const allowed = (lock, kind, r, f) =>
      lock ??
      (kind === 'rotation'
        ? ROTATIONS.some((x) => x !== r && pred(d, x, f))
        : FLIPS.some((x) => x !== f && pred(d, r, x)));
    const seen = new Set();
    const todo = [['NORMAL', 'NONE']];
    while (todo.length) {
      const [r, f] = todo.pop();
      if (seen.has(r + f)) continue;
      seen.add(r + f);
      if (r === 'NORMAL' || r === 'UPSIDE_DOWN') {
        const u = r === 'UPSIDE_DOWN';
        found.add(VARIANT[`${Number(flippedH(f) !== u)},${Number(flippedV(f) !== u)}`]);
      }
      if (allowed(rotation, 'rotation', r, f)) {
        const at = ROTATIONS.indexOf(r);
        const to = FLIPS.indexOf(f);
        search: for (let i = 0; i < 4; i++)
          for (let j = 1; j < 4; j++) {
            const next = [ROTATIONS[(at + j) % 4], FLIPS[(to + i) % 4]];
            if (!pred(d, ...next)) continue;
            todo.push(next);
            break search;
          }
      }
      if (allowed(flip, 'flip', r, f)) {
        const next = flippedH(f) ? 'NONE' : 'HORIZONTAL';
        if (pred(d, r, next)) todo.push([r, next]);
      }
    }
  }
  if (started) return { variants: [...found].sort(), up: false };
  const mirrored = ROTATIONS.some((r) => FLIPS.some((f) => pred('UP', r, f) && flippedH(f) !== flippedV(f)));
  const plain = ROTATIONS.some((r) => FLIPS.some((f) => pred('UP', r, f) && flippedH(f) === flippedV(f)));
  return { variants: [...(plain ? [0] : []), ...(mirrored ? [1] : [])], up: plain || mirrored };
}

/** The name of the superclass of `class <name>` in a source, past its type parameters; null when it has none. */
function superOf(src, name) {
  const m = new RegExp(`\\bclass\\s+${name}\\b`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (/\s/.test(src[i] ?? '')) i++;
  if (src[i] === '<')
    for (let depth = 0; i < src.length; i++) {
      if (src[i] === '<') depth++;
      else if (src[i] === '>' && --depth === 0) {
        i++;
        break;
      }
    }
  const e = /^\s*extends\s+([\w.]+)/.exec(src.slice(i));
  return e ? e[1].split('.').pop() : null;
}

/**
 * The class chain of `HatchRules.chain`, continued where it stopped at a class whose type parameters
 * (`<T extends Base<T>>`) hid its superclass.
 */
export function chainOf(rules, sourceClass) {
  let chain = rules.chain(sourceClass);
  for (let guard = 0; guard < 20 && chain.length; guard++) {
    const tail = chain[chain.length - 1];
    const sup = superOf(rules.src(tail.file), tail.name);
    if (!sup || chain.some((c) => c.name === sup)) break;
    const next = rules.chain(sup);
    if (!next.length || next[0].name !== sup) break;
    chain = [...chain, ...next];
  }
  return chain;
}

/** `return <expr>;` of a method body, the expression; null for any other body. */
const returned = (body) => /^\s*return\s+([\s\S]+?)\s*;\s*$/.exec(body)?.[1] ?? null;

/** `{ expr, from }` of the alignment limits a chain gives its controller, or null. */
function limitsExpr(chain) {
  // A `getAlignmentLimits()` override replaces the field `getInitialAlignmentLimits()` fills.
  for (const method of ['getAlignmentLimits', 'getInitialAlignmentLimits'])
    for (const c of chain) {
      const body = methodBody(c.body, method);
      // A body that is no plain `return` stays text the parser rejects: it must not fall back to the default.
      const expr = body === null ? null : (returned(body) ?? body.trim());
      if (expr === null || expr === 'mLimits') continue;
      return { expr, from: `${c.name}.${method}` };
    }
  return null;
}

/** `false` / `true` for a tool lock written as `return false;`, `'conditional'` for any other body, null when absent. */
function lockOf(chain, method) {
  for (const c of chain) {
    const body = methodBody(c.body, method);
    if (body === null) continue;
    const v = /^\s*return\s+(true|false)\s*;\s*$/.exec(body);
    return v ? v[1] === 'true' : 'conditional';
  }
  return null;
}

/** The controller classes nested in the body of a container class (`MTEVoidMiners.VMLUV`): `Outer$Inner` names. */
function nestedControllers(rules, sourceClass) {
  const [outer] = rules.chain(sourceClass);
  if (!outer) return [];
  return [...outer.body.matchAll(/\bclass\s+(\w+)\b/g)]
    .map((m) => m[1])
    .filter((n) => superOf(outer.body, n))
    .map((n) => `${sourceClass}$${n}`);
}

/**
 * `{ variants, from, notes, problems }` of one controller class. `variants` is null (not an error) when GT allows all
 * four; `from` says where the limits are written. A class that is no alignable controller, an expression it cannot
 * read or a limit that forbids the shape as built is a problem.
 */
export function orientationOf(rules, sourceClass) {
  const notes = [];
  const chain = chainOf(rules, sourceClass);
  const reaches = chain.some((c) => c.name === 'MTEEnhancedMultiBlockBase');
  const found = chain.length ? limitsExpr(chain) : null;
  if (!found && !reaches) {
    // A container class whose nested controllers share one reading.
    const nested = nestedControllers(rules, sourceClass);
    const each = nested.map((n) => orientationOf(rules, n));
    const first = each[0];
    if (!first || each.some((o) => o.problems.length || o.variants?.join() !== first.variants?.join()))
      return { variants: null, from: null, notes, problems: [`${sourceClass}: no alignment limits found`] };
    return {
      ...first,
      notes: [...first.notes, `${sourceClass}: read from its ${nested.length} nested classes`],
    };
  }
  if (!found)
    return {
      variants: null,
      from: null,
      notes,
      problems: [`${sourceClass}: no alignment limits expression`],
    };
  let pred;
  try {
    pred = parseLimits(found.expr);
  } catch (e) {
    return {
      variants: null,
      from: found.from,
      notes,
      problems: [`${sourceClass} (${found.from}): ${e.message}`],
    };
  }
  const locks = {};
  for (const [key, method] of [
    ['rotation', 'isRotationChangeAllowed'],
    ['flip', 'isFlipChangeAllowed'],
  ]) {
    const lock = lockOf(chain, method);
    if (lock === 'conditional')
      notes.push(`${sourceClass}: ${method}() depends on the run time, StructureLib default used`);
    // A plain value replaces the default; a body that depends on the run time keeps it.
    locks[key] = typeof lock === 'boolean' ? lock : null;
  }
  const { variants, up } = variantsOf(pred, locks);
  if (up) notes.push(`${sourceClass}: the controller can only face up (${found.from})`);
  if (!variants.includes(0))
    return {
      variants: null,
      from: found.from,
      notes,
      problems: [`${sourceClass}: the shape as built is not allowed`],
    };
  return { variants: variants.length === 4 ? null : variants, from: found.from, notes, problems: [] };
}

/** A def with `variants` in its place in the key order (before `wallshare`), or without it when null. */
export function withVariants(def, variants) {
  const out = {};
  for (const [k, v] of Object.entries(def)) {
    if (k === 'variants') continue;
    if (k === 'wallshare' && variants) out.variants = variants;
    out[k] = v;
  }
  return out;
}

/** The JSON text of a def with `variants` set (or removed), just before `wallshare`; nothing else changes. */
export function patchDef(text, variants) {
  const open = openOf(text, []);
  return variants
    ? setProp(text, open, 'variants', variants, { before: 'wallshare' })
    : removeProp(text, open, 'variants');
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

export async function run(
  checkout,
  { write = false, partial = false, dir = MULTI_DIR, log = console.log } = {},
) {
  const rules = new HatchRules(checkout);
  const results = [];
  const problems = [];
  const memo = new Map();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const file = join(dir, f);
    const text = readFileSync(file, 'utf8');
    const def = JSON.parse(text);
    const cls = sourceClassOf(def);
    if (!cls) continue;
    if (!memo.has(cls)) memo.set(cls, orientationOf(rules, cls));
    const r = memo.get(cls);
    problems.push(...r.problems);
    results.push({ file, text, def, cls, ...r });
  }
  const restricted = results.filter((r) => r.variants);
  const groups = new Map();
  for (const r of restricted) {
    const key = `${r.variants.join(',')}  ${r.from}`;
    groups.set(key, [...(groups.get(key) ?? []), r.def.id]);
  }
  log(`variants: ${restricted.length} of ${results.length} entries restricted`);
  for (const [key, ids] of [...groups].sort()) log(`  [${key.replace('  ', '] ')}: ${ids.join(', ')}`);
  for (const n of new Set(results.flatMap((r) => r.notes))) log(`note: ${n}`);
  if (problems.length) {
    log(`\n${problems.length} problems:`);
    for (const p of new Set(problems)) log(`  ${p}`);
    if (!partial) return { ok: false, results };
  }
  if (!write) return { ok: true, results };
  for (const r of results) {
    if (r.problems.length) continue;
    const out = await formatted(r.file, patchDef(r.text, r.variants));
    if (out !== r.text) writeFileSync(r.file, out);
  }
  // The catalog ids that carry the field, for src/data/orientation.test.ts.
  const snapshot = {
    variants: Object.fromEntries(
      restricted.filter((r) => !r.problems.length).map((r) => [r.def.id, r.variants]),
    ),
  };
  const file = join(dir, '../orientation.snapshot.json');
  writeFileSync(file, await formatted(file, JSON.stringify(snapshot)));
  return { ok: true, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkout = args.find((a) => !a.startsWith('--'));
  if (!checkout) {
    console.error(
      'usage: node tools/gt-source/orientation.mjs <GT5-Unofficial checkout> [--write] [--partial]',
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
