#!/usr/bin/env node
/**
 * What GT demands of a formed multiblock beyond its hatch counts, read from the controller's structure check and
 * written into the catalog:
 *
 *   node tools/gt-source/casing-min.mjs <GT5-Unofficial checkout> [--write]
 *
 * `minCasings`: `checkCasingMin(errors, counter, min)` in `checkMachine` (or a method it calls, or a superclass).
 * The counter is an `int` the structure definition bumps when a casing is matched, so the minimum is "at least
 * `min` cells of the blocks that bump it": a hatch standing in a casing cell does not count, which is how many
 * hatches a casing wall can take. See `MultiblockDef.minCasings` for the written shape. Every part is read the same way
 * for every class, nothing is listed per machine:
 *
 *   - `min` is an `int` expression: literals, `static final int` constants of the class chain (or an `int` local with
 *     an initialiser), zero-argument methods that return one (`minCasingAmount()`), `+ - * /` and parentheses. A
 *     name that is a field without an initialiser is the machine's size (`mHeight`, `width`, `mLength`): the minimum
 *     then grows with it. The value at the smallest size is the lower bound of the casing's tooltip line
 *     (`addCasing("16-79", ...)`, `addCasingInfoRange`), which must be the formula at a whole size, and `perSlab`
 *     is the formula's coefficient (a repeating slab adds one to the size, as in `beginVariableStructureBlock`).
 *     Alternatives (`cond ? a : b`, one `checkCasingMin` per structure tier) give the largest one the structure
 *     can meet; those are listed so they can be looked at.
 *   - the counter's blocks: `onElementPass(x -> ++x.counter, <element>)` names them (`ofBlock(field, meta)`,
 *     `Casings.X.asElement()`, `ofBlocksTiered(...)` with `Pair.of(block, meta)`, a method or constructor argument
 *     that returns one), and so do the `if (block == X && meta == N) counter++` checks of the steam machines and
 *     hand-written `IStructureElement`s. A block is matched to the catalog's block ids by registry name and meta.
 *   - `checkCasingMin(errors, a + CONSTANT, min)` lowers the minimum by the constant.
 *
 * `requiredAny`: `checkHasAnyInput(errors)` / `checkHasAnyOutput(errors)`: at least one input bus or hatch
 * (`itemIn` or `fluidIn`), or one output bus or hatch, whichever kinds the machine can take. Left out when a
 * kind of the group is already required.
 *
 * Only calls that always run are read (see `HatchRules.checksOf`); a controller whose only calls sit under
 * conditions (one per structure tier) gets those as alternatives. A minimum or counter it cannot read is an
 * error: the tool lists the classes and writes nothing.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import {
  arrayFields,
  findCalls,
  matchClose,
  methodBody,
  splitArgs,
  stringExpr,
  stringFields,
} from './java.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MULTI_DIR = join(ROOT, 'src/data/multiblocks');

const ANY_KINDS = { input: ['itemIn', 'fluidIn'], output: ['itemOut', 'fluidOut'] };

// ------------------------------------------------------------------------------------------------------------
// Int expressions

/** Text up to the first top-level `ch` (outside brackets and literals), and the rest after it; rest is null when none. */
function splitTop(text, ch) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ch && depth === 0) return [text.slice(0, i), text.slice(i + 1)];
  }
  return [text, null];
}

const PAREN_CHOICE = /\(([^()]*\?[^()]*)\)/;
const lin = (c, vars = {}) => ({ c, vars });
const isConst = (a) => Object.keys(a.vars).length === 0;
const unique = (alts) => {
  const seen = new Set();
  return alts.filter((a) => {
    const k = JSON.stringify([a.c, Object.entries(a.vars).sort(), a.when]);
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

/**
 * Evaluates a Java `int` expression to its alternatives `{ c, vars }` (`c + sum(vars[name] * name)`); more than
 * one when a ternary or an `if` chooses. `names` resolves an identifier: `{ init: string }` (a constant expression),
 * `{ variable: true }` (a field with no initialiser) or null (unknown: an error); `call(name)` gives the returned
 * expression of a zero-argument method, or null. Throws on anything else.
 */
export function evalInt(expr, names, call = () => null, depth = 0) {
  if (depth > 8) throw new Error(`too deep: ${expr}`);
  const text = expr
    .replace(/\(\s*(?:int|byte|short|long)\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const [cond, rest] = splitTop(text, '?');
  if (rest !== null) {
    const [a, b] = splitTop(rest, ':');
    if (b === null) throw new Error(`bad ternary: ${expr}`);
    // Each alternative remembers the condition that picks it (`when`), for tier checks.
    const pick = (alts, negate) => alts.map((x) => ({ ...x, when: x.when ?? { cond: cond.trim(), negate } }));
    return unique([
      ...pick(evalInt(a, names, call, depth), false),
      ...pick(evalInt(b, names, call, depth), true),
    ]);
  }
  // `a + (cond ? b : c)`: the parenthesised choice is evaluated on its own.
  const groups = [];
  let flat = text;
  for (let m; (m = PAREN_CHOICE.exec(flat));)
    flat = `${flat.slice(0, m.index)}__alt${groups.push(m[1]) - 1}${flat.slice(m.index + m[0].length)}`;
  const toks = [...flat.matchAll(/\s*(\d+|[A-Za-z_$][\w$.]*(?:\s*\(\s*\))?|[-+*/()])/g)];
  if (
    toks
      .map((t) => t[1])
      .join('')
      .replace(/\s/g, '') !== flat.replace(/\s/g, '')
  )
    throw new Error(`cannot read: ${expr}`);
  const tokens = toks.map((t) => t[1].replace(/\s+/g, ''));
  let pos = 0;
  const peek = () => tokens[pos];
  const combine = (xs, ys, f) => unique(xs.flatMap((x) => ys.map((y) => f(x, y))));
  const sum = (x, y, s) => {
    const vars = { ...x.vars };
    for (const [k, v] of Object.entries(y.vars)) vars[k] = (vars[k] ?? 0) + s * v;
    return lin(x.c + s * y.c, vars);
  };
  const scale = (x, k) =>
    lin(x.c * k, Object.fromEntries(Object.entries(x.vars).map(([n, v]) => [n, v * k])));
  const primary = () => {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`unexpected end: ${expr}`);
    if (t === '(') {
      const v = additive();
      if (tokens[pos++] !== ')') throw new Error(`missing ): ${expr}`);
      return v;
    }
    if (t === '-') return primary().map((x) => scale(x, -1));
    if (/^\d+$/.test(t)) return [lin(Number(t))];
    if (/^__alt\d+$/.test(t)) return evalInt(groups[Number(t.slice(5))], names, call, depth + 1);
    if (/\(\)$/.test(t)) {
      const body = call(t.replace(/\(\)$/, '').replace(/^.*\./, ''));
      if (body === null || body === undefined) throw new Error(`unknown method ${t}`);
      return evalInt(body, names, call, depth + 1);
    }
    const n = names(t.replace(/^(?:this|[A-Za-z_]\w*)\./, ''));
    if (!n) throw new Error(`unknown name ${t}`);
    if (n.variable) return [lin(0, { [t.replace(/^.*\./, '')]: 1 })];
    return evalInt(n.init, names, call, depth + 1);
  };
  const multiplicative = () => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++];
      const w = primary();
      v = combine(v, w, (x, y) => {
        if (op === '*') {
          if (isConst(x)) return scale(y, x.c);
          if (isConst(y)) return scale(x, y.c);
          throw new Error(`not linear: ${expr}`);
        }
        if (!isConst(x) || !isConst(y) || y.c === 0) throw new Error(`cannot divide: ${expr}`);
        return lin(Math.trunc(x.c / y.c));
      });
    }
    return v;
  };
  const additive = () => {
    let v = multiplicative();
    while (peek() === '+' || peek() === '-') {
      const s = tokens[pos++] === '+' ? 1 : -1;
      const w = multiplicative();
      v = combine(v, w, (x, y) => sum(x, y, s));
    }
    return v;
  };
  const out = additive();
  if (pos !== tokens.length) throw new Error(`cannot read: ${expr}`);
  return out;
}

// ------------------------------------------------------------------------------------------------------------
// The Java context of one controller class

const INT_FIELD = (name) =>
  new RegExp(
    `(?:^|[;{}\\s])(?:(?:public|protected|private|static|final|volatile|transient)\\s+)*(?:int|short|byte|long)\\s+${name}\\s*(=\\s*([^;]+?))?\\s*;`,
    'g',
  );

/** A controller's class chain (most derived first, `HatchRules.chain`) with name lookups across it. */
export class ClassContext {
  constructor(chain) {
    this.chain = chain;
  }

  /** `{ init }` for an int with an initialiser, `{ variable: true }` for one without, null when not declared. */
  intName(name) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    let variable = false;
    for (const c of this.chain) {
      for (const m of c.body.matchAll(INT_FIELD(name))) {
        // A field with an initialiser that the code bumps is a counter (or a size), not a constant.
        if (m[2] !== undefined && !this.chain.some((x) => incrementRe(name).test(x.body)))
          return { init: m[2] };
        variable = true;
      }
    }
    return variable ? { variable: true } : null;
  }

  /** The expression a zero-argument method returns (a lone `return`), most derived class first. */
  methodReturn(name) {
    for (const c of this.chain) {
      const body = methodBody(c.body, name);
      if (body === null) continue;
      const m = /^\s*return\s+([^;]+);\s*$/.exec(body);
      if (m) return m[1].trim();
    }
    return null;
  }

  /** Initialiser of a field or local (any type) named `name`, or null. */
  initOf(name) {
    for (const c of this.chain) {
      const re = new RegExp(`\\b(?!return\\b)[\\w<>\\[\\]]+\\s+${name}\\s*=(?!=)\\s*([^;]+);`);
      const m = re.exec(c.body);
      if (m) return m[1].trim();
    }
    return null;
  }

  /**
   * The expression a constructor parameter receives: a field assigned from a parameter (`this.casing = casing`)
   * takes the argument of the `super(...)` call of a more derived constructor.
   */
  fromConstructor(field) {
    for (let i = 0; i < this.chain.length; i++) {
      const body = this.chain[i].body;
      const cls = this.chain[i].name;
      const ctor = new RegExp(`\\b${cls}\\s*\\(([^)]*)\\)\\s*\\{`, 'g');
      for (const m of body.matchAll(ctor)) {
        const params = splitArgs(m[1]).map((p) => p.trim().split(/\s+/).pop());
        const end = matchClose(body, m.index + m[0].length - 1);
        const inner = body.slice(m.index + m[0].length, end);
        const as = new RegExp(`(?:this\\.)?\\b${field}\\s*=\\s*(\\w+)\\s*;`).exec(inner);
        const at = as ? params.indexOf(as[1]) : -1;
        if (at < 0) continue;
        for (let j = 0; j < i; j++)
          for (const call of findCalls(this.chain[j].body, 'super')) {
            const args = splitArgs(call.args);
            if (args.length === params.length) return args[at];
          }
      }
    }
    return null;
  }

  /** The body of the method `name` (any arguments) in the nearest class of the chain that has it, or null. */
  bodyOf(name) {
    for (const c of this.chain) {
      const body = methodBody(c.body, name);
      if (body !== null) return body;
    }
    return null;
  }

  /** `evalInt` with this class's names and methods. */
  eval(expr) {
    return evalInt(
      expr,
      (n) => this.intName(n),
      (n) => this.methodReturn(n),
    );
  }

  /** Strings of the tooltip: a literal, a `+` concatenation of literals and int expressions. */
  stringOf(expr) {
    const lit = stringExpr(expr);
    if (lit !== null) return lit;
    const parts = [];
    let rest = expr;
    for (;;) {
      const [a, b] = splitTop(rest, '+');
      parts.push(a.trim());
      if (b === null) break;
      rest = b;
    }
    let out = '';
    for (const p of parts) {
      const s = stringExpr(p);
      if (s !== null) out += s;
      else {
        const v = this.eval(p);
        if (v.length !== 1 || !isConst(v[0])) return null;
        out += v[0].c;
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Casings of the tooltip

/** `{ name, lo, hi }` of every casing line of the controller's tooltip (`addCasing("8-33", "Name", false)`, ...). */
export function tooltipCasings(ctx) {
  const out = [];
  const parseCount = (t) => {
    const m = /^(\d+)\s*(?:([-–])\s*(\d+)|(\+))?$/.exec(t.trim());
    return m ? { lo: Number(m[1]), hi: m[3] ? Number(m[3]) : m[4] ? Infinity : Number(m[1]) } : null;
  };
  const int = (a) => {
    const v = ctx.eval(a);
    return v.length === 1 && isConst(v[0]) ? v[0].c : null;
  };
  for (const c of ctx.chain) {
    for (const fn of ['addCasing', 'addCasingInfo']) {
      for (const call of findCalls(c.body, fn)) {
        const [count, name] = splitArgs(call.args);
        const text = count === undefined ? null : safe(() => ctx.stringOf(count));
        const n = name === undefined ? null : stringExpr(name);
        const range = text === null ? null : parseCount(text);
        if (range && n) out.push({ name: n, ...range });
      }
    }
    for (const [fn, shape] of [
      ['addCasingInfoExactly', 'exact'],
      ['addCasingInfoMin', 'min'],
      ['addCasingInfoRange', 'range'],
    ]) {
      for (const call of findCalls(c.body, fn)) {
        const args = splitArgs(call.args);
        const n = stringExpr(args[0] ?? '');
        const a = safe(() => int(args[1]));
        const b = shape === 'range' ? safe(() => int(args[2])) : null;
        if (!n || a === null || a === undefined) continue;
        if (shape === 'exact') out.push({ name: n, lo: a, hi: a });
        else if (shape === 'min') out.push({ name: n, lo: a, hi: Infinity });
        else if (b !== null && b !== undefined) out.push({ name: n, lo: a, hi: b });
      }
    }
  }
  return out;
}

function safe(f) {
  try {
    return f();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------
// Blocks

/**
 * Block references of Java sources: `{ field, meta }` (a `GregTechAPI.sBlockCasings4`-style field and its metadata,
 * `meta` null for any) or `{ vanilla, meta }` (`Blocks.hardened_clay`). `names` says how to map them onto catalog
 * block ids (see `BlockNames`).
 */
export class BlockReader {
  /**
   * @param registry `Registry` (block fields, the `Casings` enum, block names)
   */
  constructor(registry) {
    this.reg = registry;
  }

  /**
   * Registry name of a mod's own `Blocks.<field>` (`field = BlockFoo.registerBlock();`, where `BlockFoo` registers
   * itself under a `blockName` string); null for a field of Minecraft's `Blocks`.
   */
  registeredName(field) {
    this.registered ??= new Map();
    if (!this.registered.has(field)) {
      let name = null;
      for (const [, src] of this.reg.allSources()) {
        const m = new RegExp(`\\b${field}\\s*=\\s*(\\w+)\\.registerBlock\\(\\)`).exec(src);
        const cls = m && this.reg.classSrc(m[1]);
        if (cls) name = /\bblockName\s*=\s*"([^"]+)"/.exec(cls)?.[1] ?? null;
        if (name) break;
      }
      this.registered.set(field, name);
    }
    return this.registered.get(field);
  }

  /** Name of the `Casings` constant an expression stands for: `Casings.X`, `X`, `x.getCasing()`, a field of the chain. */
  casingsConstant(expr, ctx, depth = 0) {
    if (depth > 6) return null;
    const e = expr
      .replace(/\.asElement\(\)\s*$/, '')
      .replace(/\s+/g, '')
      .trim();
    let m = /^(?:Casings\.)?(\w+)$/.exec(e);
    if (m && this.reg.casingsEnum.has(m[1])) return m[1];
    m = /^(?:\w+\.)*(\w+)\(\)$/.exec(e);
    if (m) {
      const body = ctx.methodReturn(m[1]);
      return body ? this.casingsConstant(body, ctx, depth + 1) : null;
    }
    m = /^(?:this\.)?(\w+)$/.exec(e);
    if (m) {
      const init = ctx.initOf(m[1]) ?? ctx.fromConstructor(m[1]);
      if (init) return this.casingsConstant(init, ctx, depth + 1);
    }
    return null;
  }

  /** The block-field name of an expression, or `{ vanilla }`; null when it is not one. */
  blockOf(expr, ctx, depth = 0) {
    if (depth > 6) return null;
    const e = expr.replace(/\s+/g, '').trim();
    let m = /^(?:\w+\.)*?(\w+)\.getBlock\(\)$/.exec(e);
    if (m) {
      const c = this.casingsConstant(m[1], ctx);
      if (c) return { field: this.reg.casingsEnum.get(c).field };
    }
    m = /^Blocks\.(\w+)$/.exec(e);
    if (m) {
      const name = this.registeredName(m[1]);
      return name ? { name } : { vanilla: m[1] };
    }
    m = /^(?:\w+\.)*(\w+)\(\)$/.exec(e);
    if (m) {
      const body = ctx.methodReturn(m[1]);
      return body ? this.blockOf(body, ctx, depth + 1) : null;
    }
    m = /^(?:[\w]+\.)*(\w+)$/.exec(e);
    if (m) {
      if (this.reg.blockClass.has(m[1])) return { field: m[1] };
      const init = ctx.initOf(m[1]);
      if (init) return this.blockOf(init, ctx, depth + 1);
    }
    return null;
  }

  /** The metadata of an expression: an `int`, `X.getBlockMeta()`, or null for none that can be read. */
  metaOf(expr, ctx) {
    const e = expr.replace(/\s+/g, '').trim();
    const m = /^(?:\w+\.)*?(\w+)\.getBlockMeta\(\)$/.exec(e);
    if (m) {
      const c = this.casingsConstant(m[1], ctx);
      return c ? this.reg.casingsEnum.get(c).meta : null;
    }
    const v = safe(() => ctx.eval(e));
    return v && v.length === 1 && isConst(v[0]) ? v[0].c : null;
  }

  /**
   * Blocks other code registers with the controller: calls of a static method of the chain that takes a `Block` and
   * a meta and puts them into a map the structure element reads (the Chemical Plant's per-tier machine casings,
   * `registerMachineCasingForTier(tier, block, meta, texture)`), by every call in the sources.
   */
  registeredBlocks(ctx) {
    const cands = [];
    const errors = [];
    for (const c of ctx.chain) {
      for (const m of c.body.matchAll(/\bstatic\s+[\w<>]+\s+(\w+)\s*\(([^)]*)\)\s*\{/g)) {
        const params = splitArgs(m[2]).map((p) => p.trim().split(/\s+/));
        const block = params.findIndex((p) => p[0] === 'Block');
        const meta = params.findIndex((p) => /meta/i.test(p[p.length - 1] ?? ''));
        const end = matchClose(c.body, m.index + m[0].length - 1);
        if (block < 0 || meta < 0 || !/\.put\(/.test(c.body.slice(m.index, end))) continue;
        for (const [, src] of this.reg.allSources()) {
          if (!src.includes(`${c.name}.${m[1]}(`)) continue;
          for (const call of findCalls(src, `${c.name}.${m[1]}`)) {
            const args = splitArgs(call.args);
            const b = this.blockOf(args[block] ?? '', ctx);
            const v = this.metaOf(args[meta] ?? '', ctx);
            if (b && v !== null) cands.push({ ...b, meta: v });
            else errors.push(`${c.name}.${m[1]}(${call.args})`);
          }
        }
      }
    }
    return { cands, errors };
  }

  /**
   * Blocks an element expression places: every `ofBlock(block, meta)`, `ofBlockAnyMeta(block)`,
   * `Pair.of(block, meta)` (a tiered list) and `Casings.X.asElement()` in it. Returns `{ cands, errors }`.
   */
  elementBlocks(expr, ctx) {
    const cands = [];
    const errors = [];
    const add = (block, meta, what) => {
      if (!block || meta === undefined) errors.push(what);
      else cands.push({ ...block, meta });
    };
    for (const call of findCalls(expr, 'ofBlock')) {
      const [b, m] = splitArgs(call.args);
      add(
        this.blockOf(b ?? '', ctx),
        m === undefined ? undefined : this.metaOf(m, ctx),
        `ofBlock(${call.args})`,
      );
    }
    for (const call of findCalls(expr, 'ofBlockAnyMeta')) {
      const [b] = splitArgs(call.args);
      add(this.blockOf(b ?? '', ctx), null, `ofBlockAnyMeta(${call.args})`);
    }
    for (const call of findCalls(expr, 'Pair.of')) {
      const [b, m] = splitArgs(call.args);
      // Frames and the like in a tiered list carry a material, not a casing meta: not a counted casing.
      if (/\.(?:mMetaItemSubID|getMaterial)\b/.test(m ?? '')) continue;
      add(
        this.blockOf(b ?? '', ctx),
        m === undefined ? undefined : this.metaOf(m, ctx),
        `Pair.of(${call.args})`,
      );
    }
    for (const m of expr.matchAll(/([\w.()]+?)\s*\.\s*asElement\s*\(\s*\)/g)) {
      const c = this.casingsConstant(m[1], ctx);
      if (c) cands.push({ ...this.reg.casingsEnum.get(c), meta: this.reg.casingsEnum.get(c).meta });
      else errors.push(`${m[1]}.asElement()`);
    }
    return { cands, errors };
  }
}

/** Blocks a counter's increments are tied to in `if (block == X && meta == N) counter++`, in a chain's code. */
function blocksOfConditionalIncrements(body, counterRe, blocks, ctx) {
  const cands = [];
  const errors = [];
  for (const call of findCalls(body, 'if')) {
    const brace = body.indexOf('{', call.end);
    if (brace < 0 || body.slice(call.end, brace).trim() !== '') continue;
    const close = matchClose(body, brace);
    const inner = body.slice(brace + 1, close);
    if (!counterRe.test(inner)) continue;
    // Innermost: when a nested `if` holds the increment, it is read on its own.
    if (findCalls(inner, 'if').some((n) => counterRe.test(inner.slice(n.end)))) continue;
    for (const clause of call.args.split('||')) {
      for (const m of clause.matchAll(
        /(?:(\w+(?:\.\w+)*)\s*==\s*(?:block|worldBlock|b)\b|\b(?:block|worldBlock|b)\s*==\s*(\w+(?:\.\w+)*))/g,
      )) {
        const b = blocks.blockOf(m[1] ?? m[2], ctx);
        if (!b) {
          errors.push(`if (${call.args.trim()})`);
          continue;
        }
        const meta =
          /(?:\bmeta\b|getBlockMetadata\([^)]*\)|\baMeta\b)\s*==\s*(\d+)/.exec(clause)?.[1] ??
          /(\d+)\s*==\s*(?:\bmeta\b|getBlockMetadata\([^)]*\))/.exec(clause)?.[1];
        cands.push({ ...b, meta: meta === undefined ? null : Number(meta) });
      }
    }
  }
  return { cands, errors };
}

const incrementRe = (counter) =>
  new RegExp(`(?:\\+\\+\\s*(?:\\w+\\.)?${counter}\\b|(?:\\b\\w+\\.)?\\b${counter}\\s*(?:\\+\\+|\\+=))`);

/**
 * Blocks whose cells bump `counter` (a bare name): `{ cands, errors }`. The element of every `onElementPass(f, e)`
 * whose `f` (a lambda, or a method of the chain) bumps it, and the blocks named by an `if` around a bump.
 */
export function countedBlocks(counter, ctx, blocks) {
  const re = incrementRe(counter);
  const counting = [];
  const cands = [];
  const errors = [];
  const opaque = [];
  let found = false;
  const take = (r) => {
    cands.push(...r.cands);
    errors.push(...r.errors);
  };
  for (const c of ctx.chain) {
    for (const call of findCalls(c.body, 'onElementPass')) {
      const [f, ...rest] = splitArgs(call.args);
      if (!bumpsText(f ?? '', ctx, re)) continue;
      found = true;
      const r = blocks.elementBlocks(rest.join(','), ctx);
      take(r);
      const el = enclosingElement(c.body, call.start);
      counting.push({
        char: el?.char ?? null,
        hatch: el ? HATCH_ELEMENT.test(el.expr) : null,
        cands: r.cands,
      });
      if (!r.cands.length && !r.errors.length) opaque.push(`onElementPass(${call.args.slice(0, 60)}...)`);
    }
    const r = blocksOfConditionalIncrements(c.body, re, blocks, ctx);
    if (r.cands.length || r.errors.length) {
      found = true;
      take(r);
    }
  }
  if (!found && ctx.chain.some((c) => re.test(c.body))) {
    const r = blocks.registeredBlocks(ctx);
    if (r.cands.length) {
      found = true;
      take(r);
    }
  }
  if (!found) errors.push(`no element bumps ${counter}`);
  // An element that names no block (a hand-written one) is read through its own `if (block == X)` checks.
  if (!cands.length) errors.push(...opaque);
  return { cands, errors, counting };
}

/**
 * Whether code text bumps a counter, directly or through the methods it calls or refers to (`Foo::bar`), a few
 * levels deep: `t -> t.onTopLayerFound(true)` bumps through `onCasingFound()`.
 */
function bumpsText(text, ctx, re, depth = 0) {
  if (re.test(text)) return true;
  if (depth > 3) return false;
  for (const m of text.matchAll(
    /(?:::([A-Za-z_][A-Za-z_0-9]*))|(?:(?:^|[^A-Za-z_0-9])([A-Za-z_][A-Za-z_0-9]*)[ ]*[(])/g,
  )) {
    const body = ctx.bodyOf(m[1] ?? m[2]);
    if (body && bumpsText(body, ctx, re, depth + 1)) return true;
  }
  return false;
}

/**
 * The structure characters of the shapes the structure check runs (`checkPiece(name, ...)`), or null when that
 * cannot be told: hint-only shapes then do not make an element count as placed.
 */
function checkedChars(ctx) {
  const strings = new Map();
  const arrays = new Map();
  for (const c of ctx.chain) {
    for (const [k, v] of stringFields(c.body)) strings.set(k, v);
    for (const [k, v] of arrayFields(c.body)) arrays.set(k, v);
  }
  const nameOf = (arg) => {
    const t = (arg ?? '').trim();
    return stringExpr(t) ?? strings.get(t.replace(/^.*[.]/, '')) ?? null;
  };
  const used = new Set();
  for (const c of ctx.chain)
    for (const call of findCalls(c.body, 'checkPiece')) {
      const n = nameOf(splitArgs(call.args)[0]);
      if (n === null) return null;
      used.add(n);
    }
  if (!used.size) return null;
  const chars = new Set();
  for (const c of ctx.chain)
    for (const call of findCalls(c.body, 'addShape')) {
      const [name, ...rest] = splitArgs(call.args);
      if (!used.has(nameOf(name))) continue;
      let text = rest.join(',');
      if (!text.includes('"')) text = arrays.get(text.trim()) ?? '';
      if (!text.includes('"')) return null;
      for (const m of text.matchAll(/"([^"]*)"/g)) for (const ch of m[1]) chars.add(ch);
    }
  return chars.size ? chars : null;
}

/** A hatch-bearing structure element: GT's hatch adders and hint dots. */
const HATCH_ELEMENT = /buildHatchAdder|buildSteamInput|ofHatchAdder|[.]newAny[(]|[.]hint[(]|[.]dot[(]/;

/** The `.addElement('c', expr)` of a class body that contains the position `at`: `{ char, expr }`, or null. */
function enclosingElement(body, at) {
  const call = findCalls(body, 'addElement').find((a) => a.open < at && at < a.end);
  if (!call) return null;
  const [ch, ...rest] = splitArgs(call.args);
  return { char: /^'(.)'$/.exec(ch ?? '')?.[1] ?? null, expr: rest.join(',') };
}

/**
 * The structure elements that do not bump `counter`, with the blocks they place and whether they take hatches:
 * `{ char, hatch, cands }`. They matter when one of them places a block of the counted casing: GT does not count
 * those cells.
 */
export function uncountedElements(counter, ctx, blocks) {
  const re = incrementRe(counter);
  const checked = checkedChars(ctx);
  const out = [];
  for (const c of ctx.chain)
    for (const call of findCalls(c.body, 'addElement')) {
      const [ch, ...rest] = splitArgs(call.args);
      const expr = rest.join(',');
      const char = /^'(.)'$/.exec(ch ?? '')?.[1] ?? null;
      // Elements the structure check never places (the hologram's hint shapes) count for nothing either way.
      if (bumpsText(expr, ctx, re) || char === null || (checked && !checked.has(char))) continue;
      const r = blocks.elementBlocks(expr, ctx);
      if (r.cands.length) out.push({ char, hatch: HATCH_ELEMENT.test(expr), cands: r.cands });
    }
  return out;
}

// ------------------------------------------------------------------------------------------------------------
// Catalog ids

/** Display names of the planner's own block ids (`gt.casing.cleanStainless`) from `src/data/blocks.ts`. */
export function plannerBlockNames(root = ROOT) {
  const file = join(root, 'src/data/blocks.ts');
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const m of readFileSync(file, 'utf8').matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)'/g))
    out.set(m[1], m[2].replace(/\\'/g, "'"));
  return out;
}

/**
 * Maps `{ field, meta }` / `{ vanilla, meta }` onto catalog block ids: `mod:registry.name@meta` (the dump) by the
 * registry name of the field, `gt5u.name.meta` (the old converter) by its unlocalized name or field, and the
 * planner's own ids (`gt.casing.*`) by display name.
 *
 * @param fieldOfName registry name -> block field (`StaticTextures.byUnloc` / `registered`)
 */
export class BlockNames {
  constructor(registry, fieldOfName, plannerNames = plannerBlockNames()) {
    this.reg = registry;
    this.fieldOfName = fieldOfName;
    this.planner = plannerNames;
  }

  displayName(c) {
    if (c.vanilla || c.name) return null;
    const info = this.reg.blockInfo(c.field);
    return info && c.meta !== null ? info.name(c.meta) : null;
  }

  /** Whether the block candidate is the catalog block `id`. */
  matches(c, id) {
    const metaOk = (m) => c.meta === null || c.meta === m;
    let m = /^(\w+):([^@]+)@(\d+)$/.exec(id);
    if (m) {
      if (c.vanilla) return m[1] === 'minecraft' && c.vanilla === m[2] && metaOk(Number(m[3]));
      if (c.name) return c.name === m[2] && metaOk(Number(m[3]));
      return this.fieldOfName(m[2]) === c.field && metaOk(Number(m[3]));
    }
    if (c.vanilla || c.name) return false;
    m = /^gt5u\.(\w+)\.(\d+)$/.exec(id);
    if (m) {
      const unloc = this.reg.blockInfo(c.field)?.unloc ?? '';
      const camel = unloc.replace(/\.(\w)/g, (_, ch) => ch.toUpperCase());
      return (m[1] === camel || m[1] === c.field) && metaOk(Number(m[2]));
    }
    const planner = this.planner.get(id);
    const own = this.displayName(c);
    return !!planner && !!own && planner === own;
  }
}

// ------------------------------------------------------------------------------------------------------------
// One machine

/** Number of structure cells (at the stored size) drawn with one of the legend characters `chars`. */
function countCells(def, chars) {
  let n = 0;
  for (const layer of def.layers) for (const row of layer) for (const ch of row) if (chars.includes(ch)) n++;
  return n;
}

/**
 * The legend characters whose cells GT counts for a counter: those with the counted blocks `ids`. GT counts only the
 * cells of the elements that bump the counter, so where another element places the same block without bumping it
 * (a plain casing next to the hatch casing), the two are told apart by whether the element takes hatches, which
 * the legend shows (`hatches`). Throws when they cannot be told apart.
 */
export function charsOf(def, ids, counting, uncounted, names) {
  const all = Object.entries(def.legend)
    .filter(([, e]) => ids.includes(e.blockId))
    .map(([c, e]) => ({ c, hatch: !!e.hatches?.length }));
  const touches = (x) => x.cands.some((c) => ids.some((id) => names.matches(c, id)));
  const clash = uncounted.filter(touches);
  if (!clash.length) return all.map((x) => x.c);
  const mine = counting.filter(touches);
  const H = new Set(mine.map((x) => x.hatch));
  const where = `${clash.map((u) => `'${u.char}'`).join(', ')} place${clash.length > 1 ? '' : 's'} ${ids.join(', ')} without counting it`;
  if (H.size !== 1 || H.has(null) || clash.some((u) => u.hatch === [...H][0]))
    throw new Error(`cannot tell the counted cells from the others: ${where}`);
  const chars = all.filter((x) => x.hatch === [...H][0]).map((x) => x.c);
  if (!chars.length) throw new Error(`no legend character takes the counted cells: ${where}`);
  return chars;
}

const normName = (s) =>
  s
    .toLowerCase()
    .replace(/§./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * `{ minCasings, requiredAny, problems, notes }` for one catalog def: `rules` is a `HatchRules`, `blocks` a
 * `BlockReader`, `names` a `BlockNames`. `problems` are unreadable minimums (the class and why); `notes` are
 * readings worth a look (alternatives, tooltip disagreements).
 */
export function constraintsOf(def, sourceClass, rules, blocks, names) {
  const chain = rules.chain(sourceClass);
  const ctx = new ClassContext(chain);
  const problems = [];
  const notes = [];
  const skipped = [];
  const checks = rules.checksOf(sourceClass);
  const legendIds = [...new Set(Object.values(def.legend).map((e) => e.blockId))];

  // Calls that always run; failing that, every call in the chain (one per structure tier).
  let calls = checks.casing.map((k) => ({ ...k, always: true }));
  if (!calls.length) {
    for (const c of chain)
      for (const call of findCalls(c.body, 'checkCasingMin')) {
        const a = splitArgs(call.args);
        if (a.length === 3 && !/\s/.test(a[0].trim()))
          calls.push({ counter: a[1], min: a[2], always: false });
      }
  }
  // A counter may also be called twice (a legacy structure first): the calls that always run win.
  const minCasings = [];
  const lookup = new Map();
  for (const k of calls) {
    try {
      const entry = readCall(k, def, ctx, blocks, names, legendIds, notes);
      const key = entry.chars.join('');
      const prev = lookup.get(key);
      if (prev && !prev.always && k.always) minCasings.splice(minCasings.indexOf(prev.entry), 1, entry);
      else if (prev) {
        prev.entry.alternatives = [...(prev.entry.alternatives ?? [prev.entry.min]), entry.min];
        continue;
      } else minCasings.push(entry);
      lookup.set(key, { entry, always: k.always });
    } catch (e) {
      const why = `${sourceClass}: checkCasingMin(${k.counter}, ${k.min}): ${e.message}`;
      // A call under a condition (one structure tier) may be for blocks this entry does not have.
      if (e instanceof OtherVariant && !k.always) skipped.push(`${def.id}: ${e.message}`);
      else problems.push(why);
    }
  }
  // Several alternatives for one counter (one per structure tier): the one whose condition holds for the tier of
  // the casing the entry has (the position of its block in the tiered list), else the one the tooltip gives for
  // this casing, else the largest the structure can meet.
  for (const e of minCasings) {
    if (!e.alternatives) continue;
    const count = countCells(def, e.chars);
    const fits = e.alternatives.filter((v) => v <= count);
    const byTier = tierPick(e, names).filter((v) => v <= count);
    const told = tooltipCasings(ctx)
      .filter((l) => casingMatches(l.name, e.ids, names, e.cands))
      .map((l) => l.lo);
    const byTooltip = fits.filter((v) => told.includes(v));
    let how = 'the largest the structure meets';
    if (byTier.length === 1) [e.min, how] = [byTier[0], "the entry's tier"];
    else if (byTooltip.length === 1) [e.min, how] = [byTooltip[0], 'the tooltip'];
    else if (fits.length) e.min = Math.max(...fits);
    notes.push(
      `${sourceClass}: ${e.ids.join(', ')} has minimums ${e.alternatives.join(' / ')}; the structure has ${count}, kept ${fits.length ? e.min : 'none'} (${how})`,
    );
    delete e.alternatives;
  }
  // A minimum the stored structure cannot meet belongs to a variant the entry does not hold: not written.
  for (const e of [...minCasings]) {
    const count = countCells(def, e.chars);
    if (e.min <= count) continue;
    minCasings.splice(minCasings.indexOf(e), 1);
    skipped.push(`${def.id}: needs ${e.min} of ${e.ids.join(', ')}, the entry has ${count}`);
  }
  let checked = 0;
  for (const e of minCasings) {
    const t = tooltipCheck(def, e, ctx, names);
    if (t.compared) checked++;
    if (t.note) notes.push(t.note);
    delete e.always;
    delete e.cands;
    delete e.ids;
    delete e.alts;
  }
  // A class that checks a casing minimum must give one, unless the entry is listed as one the check cannot be
  // written for.
  const callsMin = chain.some((c) =>
    findCalls(c.body, 'checkCasingMin').some((call) => {
      const a = splitArgs(call.args);
      return a.length === 3 && !/ /.test(a[0].trim());
    }),
  );
  if (callsMin && !minCasings.length && !problems.length) {
    if (UNWRITTEN[def.id]) notes.push(`${def.id}: no minimum written, ${UNWRITTEN[def.id]}`);
    else problems.push(`${sourceClass}: calls checkCasingMin but no minimum could be written for ${def.id}`);
  }

  // Any input / output: the calls that always run; failing that, the ones under conditions (a per-tier loop).
  const anyOf = (group) => {
    if (checks.any[group]) return true;
    const fn = group === 'input' ? 'checkHasAnyInput' : 'checkHasAnyOutput';
    return chain.some((c) => findCalls(c.body, fn).some((call) => call.args.trim() === 'errors'));
  };
  const placeable = new Set(Object.values(def.legend).flatMap((e) => e.hatches ?? []));
  const requiredAny = [];
  for (const group of ['input', 'output']) {
    if (!anyOf(group)) continue;
    if (!checks.any[group]) notes.push(`${def.id}: any ${group} is only checked under a condition, kept`);
    const kinds = ANY_KINDS[group].filter((k) => placeable.has(k));
    if (!kinds.length) {
      problems.push(`${sourceClass}: needs any ${group}, but no cell takes ${ANY_KINDS[group].join(' or ')}`);
      continue;
    }
    if (ANY_KINDS[group].some((k) => (def.requiredHatches?.[k]?.min ?? 0) >= 1)) continue;
    requiredAny.push({ kinds, min: 1 });
  }
  return { minCasings, requiredAny, problems, notes, skipped, checked, callsMin };
}

/**
 * Entries whose class calls `checkCasingMin` but that carry no `minCasings`, and why. Any other entry without one
 * is an error of the tool (src/data/constraints.test.ts checks the list against the catalog).
 */
export const UNWRITTEN = {
  'exo-foundry':
    'the stored structure is truncated (15x47x15, GT builds 15x55x15), so the minimum of 462 cells cannot be met',
  'nano-forge': 'the check only runs for the tier 4 structure, the stored entry is another tier',
  'pcb-factory': 'the check only runs for the tier 3 structure, the stored entry is another tier',
};

/**
 * The alternatives of a ternary on the structure tier (`structureTier == 2 ? 69 : 26`) that hold for the tier of the
 * entry's casing: the tier is the position (from 1) of its block in the tiered list of counted blocks.
 */
function tierPick(e, names) {
  if (!e.alts || e.cands.length < 2) return [];
  const own = e.cands.findIndex((c) => e.ids.some((id) => names.matches(c, id)));
  if (own < 0) return [];
  const tier = own + 1;
  const picked = [];
  for (const alt of e.alts) {
    const m = /^[ (!]*[A-Za-z_0-9.]+ *(==|>=|<=|>|<|!=) *([0-9]+)[ )]*$/.exec(alt.when?.cond ?? '');
    if (!m) return [];
    const n = Number(m[2]);
    const holds = {
      '==': tier === n,
      '>=': tier >= n,
      '<=': tier <= n,
      '>': tier > n,
      '<': tier < n,
      '!=': tier !== n,
    }[m[1]];
    if (holds !== alt.when.negate) picked.push(alt.c);
  }
  return picked;
}

class OtherVariant extends Error {}

/** One `checkCasingMin` call → a `minCasings` entry (without `text`), or throws why not. */
function readCall(k, def, ctx, blocks, names, legendIds, notes) {
  // `a + CONSTANT`: the constant counts towards the minimum.
  let offset = 0;
  const counters = [];
  let rest = k.counter;
  for (;;) {
    const [a, b] = splitTop(rest, '+');
    const term = a.trim().replace(/^this\./, '');
    const v = /^[A-Za-z_]\w*$/.test(term) ? ctx.intName(term) : null;
    if (v && v.init !== undefined) {
      const c = ctx.eval(term);
      if (c.length !== 1 || !isConst(c[0])) throw new Error(`cannot read counter ${k.counter}`);
      offset += c[0].c;
    } else counters.push(term);
    if (b === null) break;
    rest = b;
  }
  if (!counters.length) throw new Error(`no counter in ${k.counter}`);
  const cands = [];
  const counting = [];
  const uncounted = [];
  for (const counter of counters) {
    if (!/^[A-Za-z_]\w*$/.test(counter)) throw new Error(`cannot read counter ${counter}`);
    const r = countedBlocks(counter, ctx, blocks);
    if (r.errors.length) throw new Error(`blocks of ${counter}: ${[...new Set(r.errors)].join('; ')}`);
    cands.push(...r.cands);
    counting.push(...r.counting);
    uncounted.push(...uncountedElements(counter, ctx, blocks));
  }
  const ids = legendIds.filter((id) => cands.some((c) => names.matches(c, id)));
  if (!ids.length)
    throw new OtherVariant(`none of ${cands.map(describe).join(', ')} is a block of the catalog entry`);
  const chars = charsOf(def, ids, counting, uncounted, names);

  const alts = ctx.eval(k.min).map((a) => ({ ...a, c: a.c - offset }));
  const casingNames = ids.map((id) => names.planner.get(id) ?? null);
  const variable = alts.find((a) => !isConst(a));
  if (alts.some((a) => !isConst(a) !== !!variable)) throw new Error(`mixed variable and constant: ${k.min}`);
  if (variable) {
    // The size-dependent minimum: its value at the smallest size is the tooltip's lower bound for the casing.
    const names1 = Object.keys(variable.vars);
    if (names1.length !== 1 || variable.vars[names1[0]] <= 0)
      throw new Error(`not one growing size in ${k.min}`);
    const slope = variable.vars[names1[0]];
    const lines = tooltipCasings(ctx).filter((l) => casingMatches(l.name, ids, names, cands));
    if (lines.length !== 1)
      throw new Error(`size-dependent minimum ${k.min}: ${lines.length} tooltip lines for the casing`);
    const { lo, hi } = lines[0];
    if ((lo - variable.c) % slope !== 0) throw new Error(`tooltip ${lo} is not ${k.min} at a whole size`);
    const entry = { chars, ids, min: lo };
    if (def.resize) {
      const slabs = (def.resize.max - def.resize.min) / (def.resize.to - def.resize.from);
      entry.perSlab = slope;
      if (hi !== Infinity && lo + slope * slabs !== hi)
        notes.push(
          `${def.id}: tooltip says ${lo}-${hi}, the formula gives ${lo + slope * slabs} at the largest size`,
        );
    }
    return { ...entry, always: k.always, cands };
  }
  const values = alts.map((a) => a.c);
  const entry = { chars, ids, min: Math.max(...values), always: k.always, cands };
  if (values.length > 1) entry.alts = alts.map((a) => ({ c: a.c, when: a.when }));
  if (values.length > 1) entry.alternatives = values;
  return entry;
}

function describe(c) {
  return `${c.vanilla ?? c.name ?? c.field}@${c.meta ?? '*'}`;
}

/** Whether a tooltip casing name is one of the counted blocks' display names. */
function casingMatches(tooltipName, ids, names, cands) {
  const want = normName(tooltipName);
  for (const c of cands) {
    const n = names.displayName(c);
    if (n && normName(n) === want) return true;
  }
  return ids.some((id) => {
    const n = names.planner.get(id);
    return n && normName(n) === want;
  });
}

// ------------------------------------------------------------------------------------------------------------
// Tooltip cross-check

/**
 * Compares a minimum with the tooltip's lowest count of the same casing (the designers write the lower bound of
 * the range as the minimum): `{ compared, note? }`, a note when they differ.
 */
export function tooltipCheck(def, entry, ctx, names) {
  const hits = tooltipCasings(ctx).filter((l) => casingMatches(l.name, entry.ids, names, entry.cands));
  if (!hits.length) return { compared: false };
  if (hits.some((l) => l.lo === entry.min)) return { compared: true };
  const says = hits.map((l) => `${l.name} ${l.lo}`).join('; ');
  return {
    compared: true,
    note: `tooltip: ${def.id}: min ${entry.min} for ${entry.ids.join(', ')}, the tooltip says ${says}`,
  };
}

// ------------------------------------------------------------------------------------------------------------
// Catalog

/** Source class (`a.b.Outer`, for `HatchRules.chain`) of a catalog def from its `source` URL, or null. */
export function sourceClassOf(def) {
  const m = /\/java\/(.+)\.java$/.exec(def.source ?? '');
  return m ? m[1].replace(/\//g, '.') : null;
}

const jsonLine = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ');

/** Removes the top-level property `key` from a JSON text, with its comma; the text unchanged when absent. */
export function removeProperty(text, key) {
  const m = new RegExp(`\\n(\\s*)"${key}"\\s*:\\s*`).exec(text);
  if (!m) return text;
  const start = m.index;
  const open = m.index + m[0].length;
  const end = '[{'.includes(text[open]) ? matchClose(text, open) + 1 : text.indexOf('\n', open);
  const after = /^\s*,/.exec(text.slice(end));
  // The last property takes the comma before it along.
  const head = after ? text.slice(0, start) : text.slice(0, start).replace(/,\s*$/, '');
  return head + text.slice(end + (after ? after[0].length : 0));
}

/** The JSON text of a def with `minCasings` and `requiredAny` set (or removed) just before `defaultHatches`. */
export function patchDef(text, { minCasings, requiredAny }) {
  let out = removeProperty(removeProperty(text, 'minCasings'), 'requiredAny');
  const add = [];
  if (requiredAny.length)
    add.push(`"requiredAny": [\n${requiredAny.map((r) => '    ' + jsonLine(r)).join(',\n')}\n  ]`);
  if (minCasings.length)
    add.push(`"minCasings": [\n${minCasings.map((r) => '    ' + jsonLine(r)).join(',\n')}\n  ]`);
  if (!add.length) return out;
  const at = out.indexOf('\n  "defaultHatches"');
  if (at < 0) throw new Error('no defaultHatches to insert before');
  return out.slice(0, at) + '\n  ' + add.join(',\n  ') + ',' + out.slice(at);
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
 * A def with `minCasings` and `requiredAny` in their place in the key order (after `requiredHatches`), as
 * `patchDef` writes them; used by tools/game-dump/build.mjs for the entries it writes.
 */
export function withConstraints(def, { minCasings, requiredAny }) {
  const out = {};
  const put = (key, value) => {
    if (value.length) out[key] = value;
  };
  for (const [k, v] of Object.entries(def)) {
    if (k === 'minCasings' || k === 'requiredAny') continue;
    if (k === 'defaultHatches') {
      put('requiredAny', requiredAny);
      put('minCasings', minCasings);
    }
    out[k] = v;
  }
  return out;
}

/**
 * Readers over a checkout: `of(def)` is `constraintsOf` for a catalog def, whose class comes from its `source`.
 * Block names come from `tools/game-dump/static-textures.mjs` (registry name of every block field).
 */
export async function createConstraints(checkout, rules = new HatchRules(checkout)) {
  const { StaticTextures } = await import('../game-dump/static-textures.mjs');
  const st = new StaticTextures(checkout, null);
  const blocks = new BlockReader(st.reg);
  const names = new BlockNames(st.reg, (n) => st.byUnloc.get(n) ?? st.registered.get(n));
  return {
    of(def) {
      const cls = sourceClassOf(def);
      return cls ? constraintsOf(def, cls, rules, blocks, names) : null;
    },
  };
}

export async function run(
  checkout,
  { write = false, partial = false, dir = MULTI_DIR, log = console.log } = {},
) {
  const constraints = await createConstraints(checkout);
  const results = [];
  const problems = [];
  const notes = [];
  const skipped = [];
  let checked = 0;
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const file = join(dir, f);
    const text = readFileSync(file, 'utf8');
    const def = JSON.parse(text);
    const r = constraints.of(def);
    if (!r) continue;
    problems.push(...r.problems);
    notes.push(...r.notes);
    skipped.push(...r.skipped);
    checked += r.checked;
    results.push({ file, text, def, ...r });
  }
  const withMin = results.filter((r) => r.minCasings.length);
  const withAny = results.filter((r) => r.requiredAny.length);
  const total = results.reduce((n, r) => n + r.minCasings.length, 0);
  log(`minCasings: ${withMin.length} entries; requiredAny: ${withAny.length} entries`);
  log(`tooltip cross-check: ${checked} of ${total} minimums found a tooltip line for their casing`);
  for (const n of notes) log(`note: ${n}`);
  for (const n of skipped) log(`not written: ${n}`);
  if (problems.length) {
    log(`\n${problems.length} problems:`);
    for (const p of problems) log(`  ${p}`);
    if (!partial) return { ok: false, results };
  }
  if (write)
    for (const r of results) {
      // With --partial, an entry whose minimums could not all be read keeps what it has.
      if (r.problems.length) continue;
      const out = await formatted(r.file, patchDef(r.text, r));
      if (out !== r.text) writeFileSync(r.file, out);
    }
  // The catalog ids that carry each field, for src/data/constraints.test.ts.
  if (write) {
    const ids = (pick) =>
      results
        .filter(pick)
        .map((r) => r.def.id)
        .sort();
    const file = join(dir, '../constraints.snapshot.json');
    const snapshot = {
      checksCasingMin: ids((r) => r.callsMin),
      minCasings: ids((r) => r.minCasings.length),
      requiredAny: ids((r) => r.requiredAny.length),
    };
    writeFileSync(file, await formatted(file, JSON.stringify(snapshot)));
  }
  return { ok: true, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const checkout = args.find((a) => !a.startsWith('--'));
  if (!checkout) {
    console.error(
      'usage: node tools/gt-source/casing-min.mjs <GT5-Unofficial checkout> [--write] [--partial]',
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
