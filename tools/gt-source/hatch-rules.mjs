#!/usr/bin/env node
/**
 * Hatch rules of every GT controller class, read from the structure lines of its tooltip:
 *
 *   .addInputHatch("2", "Any middle casing (cracking fluid), any side casing (hydrocarbon)", 1, 2, 3)
 *
 * is "2 Input Hatches, described like this, on the cells the hologram marks with hint dots 1, 2 and 3". The
 * builder is `MultiblockTooltipBuilder` (its overloads: `(count, info, dots...)`, the deprecated `(info,
 * dots...)` and `(info)`; `addMiscHatch(count, name, info, dots...)` and `addOtherStructurePart(name, info,
 * dots...)` name the hatch themselves). Nothing is listed per machine: every class is read the same way.
 *
 *   node tools/gt-source/hatch-rules.mjs <GT5-Unofficial checkout> [<dump>/multiblocks]
 *
 * prints the controllers whose tooltip gave no rule. Dot numbers and the dump: a tooltip dot `N` is the dump's
 * `hint` value `N - 1` (see `README.md`; `MultiblockTooltipBuilder.toolTipFinisher` says "e.getKey() - 1
 * because 1 hint is meta 0").
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  findCalls,
  intFields,
  matchClose,
  methodBody,
  splitArgs,
  stringExpr,
  stripComments,
} from './java.mjs';

/**
 * Builder method → what it names. `kinds` are planner hatch kinds (empty for a machine-specific part); `label` is
 * the name the game prints (lang keys `GT5U.MBTT.*`, `GTPP.MBTT.*`) unless the call carries its own.
 */
const METHODS = {
  addInputBus: { kinds: ['itemIn'], label: 'Input Bus' },
  addSteamInputBus: { kinds: ['itemIn'], label: 'Steam Input Bus' },
  addOutputBus: { kinds: ['itemOut'], label: 'Output Bus' },
  addSteamOutputBus: { kinds: ['itemOut'], label: 'Steam Output Bus' },
  addInputHatch: { kinds: ['fluidIn'], label: 'Input Hatch' },
  addOutputHatch: { kinds: ['fluidOut'], label: 'Output Hatch' },
  addInputAny: { kinds: ['itemIn', 'fluidIn'], label: 'Input Bus/Hatch', any: true },
  addOutputAny: { kinds: ['itemOut', 'fluidOut'], label: 'Output Bus/Hatch', any: true },
  addEnergyHatch: { kinds: ['energy'], label: 'Energy Hatch' },
  addDynamoHatch: { kinds: ['dynamo'], label: 'Dynamo Hatch' },
  addMaintenanceHatch: { kinds: ['maintenance'], label: 'Maintenance Hatch' },
  addMufflerHatch: { kinds: ['muffler'], label: 'Muffler Hatch' },
  addSteamHatch: { kinds: ['steamIn'], label: 'Steam Hatch' },
  addMiscHatch: { kinds: [], named: true },
  addOtherStructurePart: { kinds: [], named: true, noCount: true },
};

/** Tooltip dot → dump `hint` value (and back). */
export const hintOfDot = (dot) => dot - 1;
export const dotOfHint = (hint) => hint + 1;

/**
 * A count string as the tooltips write it: `1`, `2-11`, `1+`, `0+`. Returns `{ min, max? }`, or null for free
 * text ("1 per layer", "Up to 4").
 */
export function parseCount(count) {
  const t = (count ?? '').trim();
  let m = /^(\d+)\+$/.exec(t);
  if (m) return { min: Number(m[1]) };
  m = /^(\d+)$/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(t);
  if (m && Number(m[1]) <= Number(m[2])) return { min: Number(m[1]), max: Number(m[2]) };
  return null;
}

/** An index of the Java sources of a checkout and the hatch rules of their controller classes. */
export class HatchRules {
  /** @param root checkout root (with `src/main/java`) */
  constructor(root) {
    this.javaRoot = join(root, 'src/main/java');
    /** simple class name → [path] */
    this.files = new Map();
    this.cache = new Map();
    this.walk(this.javaRoot);
    this.lang = readLang(join(root, 'src/main/resources/assets'));
  }

  walk(dir) {
    for (const e of readdirSync(dir).sort()) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) this.walk(p);
      else if (e.endsWith('.java')) {
        const c = e.slice(0, -5);
        this.files.set(c, [...(this.files.get(c) ?? []), p]);
      }
    }
  }

  src(path) {
    if (!this.cache.has(path)) this.cache.set(path, stripComments(readFileSync(path, 'utf8')));
    return this.cache.get(path);
  }

  /** The source file of a dump `source_class` (`a.b.Outer$Inner`), by package, or by simple name. */
  fileOf(sourceClass) {
    const outer = sourceClass.split('$')[0];
    const byPackage = join(this.javaRoot, ...outer.split('.')) + '.java';
    if (existsSync(byPackage)) return byPackage;
    return this.files.get(outer.split('.').pop())?.[0] ?? null;
  }

  /**
   * Class chain of a controller, most derived first: `{ name, body, file }` (the class body without its braces; a
   * nested controller comes before the outer class it usually extends).
   */
  chain(sourceClass) {
    const out = [];
    const file = this.fileOf(sourceClass);
    if (!file) return out;
    const src = this.src(file);
    const [outerName, innerName] = [sourceClass.split('$')[0].split('.').pop(), sourceClass.split('$')[1]];
    let name = innerName ?? outerName;
    let cur = classBody(src, name);
    let curFile = file;
    for (let guard = 0; cur && guard < 12; guard++) {
      out.push({ name, body: cur.body, file: curFile });
      const sup = cur.extends;
      if (!sup) break;
      // The superclass: another class in this file (a nested controller extends its outer one), or by name.
      const here = classBody(this.src(curFile), sup);
      if (here) {
        cur = here;
        name = sup;
        continue;
      }
      const f = this.files.get(sup)?.[0];
      if (!f) break;
      curFile = f;
      cur = classBody(this.src(f), sup);
      name = sup;
    }
    return out;
  }

  /**
   * The hatch rules of a controller class: the structure lines of the nearest class in its chain that has any.
   * `{ rules, from }`; `rules` is empty when no tooltip line was found.
   */
  rulesOf(sourceClass) {
    const chain = this.chain(sourceClass);
    const ctx = this.context(chain.map((x) => this.src(x.file)));
    for (const c of chain) {
      const rules = tooltipRules(c.body, ctx);
      if (rules.length) return { rules, from: c.name };
    }
    return { rules: [], from: null };
  }

  /**
   * What the controller's structure check demands, which wins over the tooltip: `{ kinds, any, noMaintenance }`.
   * `kinds[kind]` is `{ min?, max? }` from `checkHatchExact/Min/Max` and the `checkHas*` / `checkOne*` helpers
   * `checkMachine` calls (directly or through methods it calls, `super.checkMachine` included); `any` lists the
   * "any input / any output" checks (`{ input: true }`), whose kind is only known per machine;
   * `noMaintenance` is set when `getDefaultHasMaintenanceChecks()` returns false. Only calls that always run count
   * (a condition that is not a plain true/false method of the chain skips its branch).
   */
  checksOf(sourceClass) {
    const chain = this.chain(sourceClass);
    const ctx = this.context(chain.map((x) => this.src(x.file)));
    const out = { kinds: {}, any: {}, noMaintenance: false };
    const need = (kind, min, max) => {
      const r = (out.kinds[kind] ??= {});
      if (min !== undefined) r.min = Math.max(r.min ?? 0, min);
      if (max !== undefined) r.max = Math.min(r.max ?? Infinity, max);
    };
    const find = (name, from = 0) => {
      for (let i = from; i < chain.length; i++) {
        const body = methodBody(chain[i].body, name);
        if (body !== null) return { body, index: i };
      }
      return null;
    };
    const literal = (name) => {
      const m = find(name);
      const v = m && /^\s*return\s+(true|false)\s*;\s*$/.exec(m.body);
      return v ? v[1] === 'true' : null;
    };
    const holds = (cond) => {
      const c = cond.trim();
      if (c === 'true' || c === 'false') return c === 'true';
      const m = /^(!?)\s*(?:this\.)?(\w+)\s*\(\s*\)$/.exec(c);
      const v = m ? literal(m[2]) : null;
      return v === null ? null : m[1] ? !v : v;
    };
    const seen = new Set();
    const run = (name, from = 0, depth = 0) => {
      const m = find(name, from);
      const key = m && `${name}@${m.index}`;
      if (!m || seen.has(key) || depth > 6) return;
      seen.add(key);
      const walk = (body) => {
        for (const st of statements(body)) {
          if (st.cond !== undefined) {
            if (holds(st.cond) === true) walk(st.then);
            continue;
          }
          const call = /^(super\.)?(?:this\.)?(\w+)\s*\(([\s\S]*)\)$/.exec(st.text.trim());
          if (!call) continue;
          const [, sup, fn, argText] = call;
          const args = splitArgs(argText);
          if (sup && fn === name) run(name, m.index + 1, depth + 1);
          else if (!checkCall(fn, args, ctx, need, out) && args.includes('errors')) run(fn, 0, depth + 1);
        }
      };
      walk(m.body);
    };
    run('checkMachine');
    if (
      literal('getDefaultHasMaintenanceChecks') === false &&
      !chain.some((c) => /\bhasMaintenanceChecks\s*=\s*true/.test(c.body))
    )
      out.noMaintenance = true;
    return out;
  }

  /**
   * What a tooltip argument can name: String fields and zero-argument String methods of the classes in `srcs`,
   * then of any class (when the name is unique), int constants, and the English lang file.
   */
  context(srcs) {
    this.globals ??= indexNames([...this.files.values()].flat().map((f) => this.src(f)));
    const own = indexNames(srcs);
    return {
      lang: this.lang,
      ints: new Map(srcs.flatMap((s) => [...intFields(s)])),
      field: (name) => own.fields.get(name) ?? this.globals.fields.get(name) ?? null,
      method: (name) => own.methods.get(name) ?? this.globals.methods.get(name) ?? null,
    };
  }
}

/**
 * `String NAME = expr;` fields and `String name() { return expr; }` methods of some sources: name → expression.
 * A name declared twice with different expressions is ambiguous and left out.
 */
function indexNames(srcs) {
  const fields = new Map();
  const methods = new Map();
  const add = (map, name, expr) => {
    if (map.has(name) && map.get(name) !== expr) map.set(name, null);
    else map.set(name, expr);
  };
  for (const src of srcs) {
    for (const m of src.matchAll(/\bString\s+(\w+)\s*=\s*([^;]+);/g)) add(fields, m[1], m[2].trim());
    for (const m of src.matchAll(/\bString\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+([^;]+);\s*\}/g))
      add(methods, m[1], m[2].trim());
  }
  for (const map of [fields, methods]) for (const [k, v] of map) if (v === null) map.delete(k);
  return { fields, methods };
}

/** `HatchElement` names the structure checks use → planner hatch kinds. */
const ELEMENT_KIND = {
  InputBus: 'itemIn',
  OutputBus: 'itemOut',
  InputHatch: 'fluidIn',
  OutputHatch: 'fluidOut',
  Energy: 'energy',
  Dynamo: 'dynamo',
  Maintenance: 'maintenance',
  Muffler: 'muffler',
};
/** The suffix of `checkHas<X>` / `checkOne<X>` → planner hatch kind. */
const HELPER_KIND = {
  EnergyHatch: 'energy',
  AnyEnergy: 'energy',
  DynamoHatch: 'dynamo',
  AnyDynamo: 'dynamo',
  MaintenanceHatch: 'maintenance',
  MufflerHatch: 'muffler',
  InputBus: 'itemIn',
  InputHatch: 'fluidIn',
  OutputBus: 'itemOut',
  OutputHatch: 'fluidOut',
  SteamInput: 'steamIn',
  SteamInputBus: 'itemIn',
  SteamOutputBus: 'itemOut',
  EnergyHatchMaybeExotic: 'energy',
};

/** Records the demand of one structure-check call; false when the call is not one. */
function checkCall(fn, args, ctx, need, out) {
  let m = /^checkHatch(Exact|Min|Max)$/.exec(fn);
  if (m) {
    const kind = ELEMENT_KIND[(args[1] ?? '').replace(/^.*\./, '')];
    const n = args[2] === undefined ? null : intOf(args[2], ctx);
    if (kind && n !== null) {
      if (m[1] === 'Exact') need(kind, n, n);
      else if (m[1] === 'Min') need(kind, n, undefined);
      else need(kind, undefined, n);
    }
    return true;
  }
  m = /^checkHas(Any)(Input|Output)$/.exec(fn);
  if (m) {
    out.any[m[2].toLowerCase()] = true;
    return true;
  }
  m = /^check(Has|One)(\w+)$/.exec(fn);
  if (m && HELPER_KIND[m[2]] && args.includes('errors')) {
    if (m[1] === 'Has') need(HELPER_KIND[m[2]], 1, undefined);
    else need(HELPER_KIND[m[2]], 1, 1);
    return true;
  }
  return false;
}

/**
 * The statements of a method body at its top level: `{ cond, then }` for an `if` (its `else` is dropped) and
 * `{ text }` for anything else; blocks of loops, `try` and the like are skipped.
 */
function* statements(body) {
  const end = (j) => {
    for (let k = j; k < body.length; k++) {
      const c = body[k];
      if (c === ';') return k;
      if (c === '"' || c === "'") {
        const q = c;
        for (k++; k < body.length && body[k] !== q; k++) if (body[k] === '\\') k++;
      } else if ('([{'.includes(c)) {
        const close = matchClose(body, k);
        if (close < 0) return body.length;
        if (c === '{') return close;
        k = close;
      }
    }
    return body.length;
  };
  const ws = (j) => {
    while (j < body.length && /\s/.test(body[j])) j++;
    return j;
  };
  const branch = (j) => {
    j = ws(j);
    if (body[j] === '{') {
      const close = matchClose(body, j);
      return { text: body.slice(j + 1, close), next: close + 1 };
    }
    if (/^if\s*\(/.test(body.slice(j, j + 12))) {
      const p = parseIf(j);
      return { text: body.slice(j, p.next), next: p.next };
    }
    const e = end(j);
    return { text: body.slice(j, e + 1), next: e + 1 };
  };
  const parseIf = (j) => {
    const open = body.indexOf('(', j);
    const close = matchClose(body, open);
    const then = branch(close + 1);
    let next = ws(then.next);
    if (body.startsWith('else', next) && !/\w/.test(body[next + 4] ?? '')) next = branch(next + 4).next;
    else next = then.next;
    return { cond: body.slice(open + 1, close), then: then.text, next };
  };
  let i = ws(0);
  while (i < body.length) {
    if (/^if\s*\(/.test(body.slice(i, i + 12))) {
      const p = parseIf(i);
      yield { cond: p.cond, then: p.then };
      i = ws(p.next);
      continue;
    }
    const e = end(i);
    const text = body.slice(i, e + 1);
    // A statement ending in a block (a loop, `try`) has no call of its own to read.
    if (body[e] === ';') yield { text: text.replace(/;$/, '') };
    i = ws(e + 1);
  }
}

/** `{ body, extends }` of `class Name ... {` in a source, or null. */
function classBody(src, name) {
  const re = new RegExp(`\\bclass\\s+${name}\\b(?:<[^{]*?>)?(?:\\s+extends\\s+([\\w.]+))?[^{]*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchClose(src, open);
  return {
    body: src.slice(open + 1, close < 0 ? src.length : close),
    extends: m[1]?.split('.').pop() ?? null,
  };
}

/** Every `MultiblockTooltipBuilder` hatch line in a class body, in source order. */
export function tooltipRules(body, ctx) {
  const found = [];
  for (const [method, spec] of Object.entries(METHODS)) {
    for (const call of findCalls(body, method)) {
      // A call on the builder, not a declaration of the method.
      if (!/[.\s]$/.test(body.slice(Math.max(0, call.start - 1), call.start))) continue;
      if (/\b(?:public|protected|private)[^;{}]*$/.test(body.slice(Math.max(0, call.start - 80), call.start)))
        continue;
      const rule = readCall(method, spec, splitArgs(call.args), ctx);
      if (rule) found.push({ at: call.start, rule });
    }
  }
  const rules = [];
  const seen = new Set();
  for (const { rule } of found.sort((a, b) => a.at - b.at)) {
    const key = JSON.stringify([rule.method, rule.count, rule.text, rule.dots, rule.label]);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }
  return rules;
}

const isInt = (a, c) => /^\d+$/.test(a) || c.ints.has(a);
const intOf = (a, c) => (/^\d+$/.test(a) ? Number(a) : (c.ints.get(a) ?? null));

/** `en_US.lang` of every mod under `assets`: key → text. */
function readLang(assets) {
  const out = new Map();
  if (!existsSync(assets)) return out;
  for (const mod of readdirSync(assets)) {
    const f = join(assets, mod, 'lang/en_US.lang');
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) out.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  }
  return out;
}

/** Splits `a + b + c` at depth 0 outside string literals. */
function splitPlus(expr) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== '"') j += expr[j] === '\\' ? 2 : 1;
      cur += expr.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === '+' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * The text of a string expression: literals, String fields and zero-argument methods (`anyCasingText()`),
 * `StatCollector.translateToLocal("key")` (the English lang entry) and their `+` concatenations. Null when any
 * part is something else (a value only known at run time).
 */
function strOf(a, c, depth = 0) {
  if (a === undefined || depth > 6) return null;
  const out = [];
  for (const raw of splitPlus(a)) {
    const part = raw.replace(/^\((.*)\)$/s, '$1').trim();
    const lit = stringExpr(part);
    if (lit !== null) {
      out.push(lit);
      continue;
    }
    const tr = /^(?:[\w.]*\.)?translateToLocal\s*\(([\s\S]*)\)$/.exec(part);
    if (tr) {
      const key = strOf(tr[1].trim(), c, depth + 1);
      if (key === null || !c.lang.has(key)) return null;
      out.push(c.lang.get(key));
      continue;
    }
    const call = /^(?:[\w.]*\.)?(\w+)\s*\(\s*\)$/.exec(part);
    const expr = call
      ? c.method(call[1])
      : /^(?:[\w.]*\.)?(\w+)$/.test(part)
        ? c.field(/(\w+)$/.exec(part)[1])
        : null;
    const v = expr ? strOf(expr, c, depth + 1) : null;
    if (v === null) return null;
    out.push(v);
  }
  // Colour codes and line breaks are tooltip formatting.
  return out
    .join('')
    .replace(/§./g, '')
    .replace(/\s*\\?\n\s*/g, ' ')
    .trim();
}

function readCall(method, spec, args, ctx) {
  let count = null;
  let name = null;
  let info;
  let rest;
  if (spec.named) {
    if (spec.noCount) [name, info, ...rest] = args;
    else [count, name, info, ...rest] = args;
    if (info === undefined) return null;
  } else if (args.length >= 2 && !isInt(args[1], ctx)) {
    [count, info, ...rest] = args;
  } else {
    [info, ...rest] = args;
    if (info === undefined) return null;
  }
  const dots = rest.map((a) => intOf(a, ctx)).filter((d) => d !== null);
  const text = strOf(info, ctx);
  const countText = count === null ? null : strOf(count, ctx);
  const label = spec.named ? strOf(name, ctx) : spec.label;
  return {
    method,
    kinds: spec.kinds,
    ...(spec.any ? { any: true } : {}),
    label,
    count: countText,
    text,
    dots,
    // Something the reader could not turn into text or a number (a run-time value, a computed dot).
    ...(text === null || (count !== null && countText === null) || dots.length !== rest.length
      ? { partial: true }
      : {}),
  };
}

/** The line the game prints for a rule: `1+ Energy Hatch: Any casing`. */
export function ruleLine(rule) {
  const head = [rule.count, rule.label].filter(Boolean).join(' ');
  return rule.text ? `${head}: ${rule.text}` : head;
}

// ------------------------------------------------------------------------------------------------------------
// CLI: report the controllers that gave no rule

async function main() {
  const [root, dump] = process.argv.slice(2);
  if (!root) {
    console.error(
      'usage: node tools/gt-source/hatch-rules.mjs <GT5-Unofficial checkout> [<dump>/multiblocks]',
    );
    process.exit(1);
  }
  const rules = new HatchRules(root);
  const classes = dump
    ? readdirSync(dump)
        .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
        .map((f) => JSON.parse(readFileSync(join(dump, f), 'utf8')).controller.source_class)
    : [];
  const none = [];
  let partial = 0;
  let lines = 0;
  for (const cls of [...new Set(classes)].sort()) {
    const r = rules.rulesOf(cls);
    if (!r.rules.length) none.push(cls);
    lines += r.rules.length;
    partial += r.rules.filter((x) => x.partial).length;
  }
  console.log(
    `${new Set(classes).size} controller classes, ${lines} hatch lines, ${partial} partly unreadable`,
  );
  console.log(`no hatch line (${none.length}):`);
  for (const c of none) console.log(`  ${c}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
