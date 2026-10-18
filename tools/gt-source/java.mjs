/**
 * A very small Java reader for StructureLib definitions: comment stripping, balanced call extraction,
 * argument splitting and literal String[][] parsing. It does not understand Java; it understands the
 * handful of shapes GT multiblock classes use to declare their structure.
 */

/** Removes // and block comments, keeping string and char literals intact. */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '"' || c === "'") {
      const end = skipLiteral(src, i);
      out += src.slice(i, end);
      i = end - 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
      out += ' ';
    } else out += c;
  }
  return out;
}

/** Index just past the string / char literal starting at `i`. Handles text blocks ("""). */
function skipLiteral(src, i) {
  const q = src[i];
  if (q === '"' && src.startsWith('"""', i)) {
    const end = src.indexOf('"""', i + 3);
    return end < 0 ? src.length : end + 3;
  }
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === q) return j + 1;
  }
  return src.length;
}

/** Index of the bracket closing the one at `open` (any of ( [ {), or -1. */
export function matchClose(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipLiteral(src, i) - 1;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Splits a comma-separated argument list at depth 0. */
export function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const end = skipLiteral(s, i);
      cur += s.slice(i, end);
      i = end - 1;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '<') {
      // Generic type arguments: skip to the matching '>' when it looks like one (no operators in between).
      const m = /^<[\w\s.,<>?[\]]*>/.exec(s.slice(i));
      if (m) {
        cur += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Every call of `name(` (as a word, optionally after `.`), with its raw argument string and span. */
export function findCalls(src, name) {
  const re = new RegExp(`(?<![\\w$])${name.replace('.', '\\.')}\\s*\\(`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    if (close < 0) continue;
    out.push({ start: m.index, open, end: close + 1, args: src.slice(open + 1, close) });
  }
  return out;
}

/**
 * The body of the first method called `name` (text between its braces), or null. A field initialised by a call
 * (`private IAlignmentLimits mLimits = getInitialAlignmentLimits();`) is not a method.
 */
export function methodBody(src, name) {
  const re = new RegExp(`(?:public|protected|private)[^;{}()]*\\b${name}\\s*\\(`, 'g');
  for (let m; (m = re.exec(src));) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const close = matchClose(src, open);
    const brace = src.indexOf('{', close);
    if (close < 0 || brace < 0 || /;/.test(src.slice(close, brace))) continue;
    const end = matchClose(src, brace);
    return end < 0 ? null : src.slice(brace + 1, end);
  }
  return null;
}

/** Decodes a Java string literal (without concatenation). */
export function stringValue(lit) {
  const t = lit.trim();
  if (!t.startsWith('"') || !t.endsWith('"')) return null;
  return JSON.parse(t.replace(/\\'/g, "'"));
}

/** A string expression: one literal or a `+` concatenation of literals. */
export function stringExpr(expr) {
  const parts = [];
  let rest = expr.trim();
  while (rest.length) {
    if (!rest.startsWith('"')) return null;
    const end = skipLiteral(rest, 0);
    const v = stringValue(rest.slice(0, end));
    if (v === null) return null;
    parts.push(v);
    rest = rest.slice(end).trim();
    if (rest.startsWith('+')) rest = rest.slice(1).trim();
    else if (rest.length) return null;
  }
  return parts.join('');
}

/** `{ {"a","b"}, {"c"} }` or `new String[][] {...}` → string[][], or null. */
export function string2D(expr) {
  let t = expr.trim().replace(/^new\s+String\s*\[\s*\]\s*\[\s*\]\s*/, '');
  if (!t.startsWith('{')) return null;
  const close = matchClose(t, 0);
  if (close !== t.length - 1) return null;
  const outer = splitArgs(t.slice(1, -1));
  const rows = [];
  for (const o of outer) {
    let inner = o.trim().replace(/^new\s+String\s*\[\s*\]\s*/, '');
    if (!inner.startsWith('{')) return null;
    const list = splitArgs(inner.slice(1, matchClose(inner, 0)));
    const strs = list.map(stringExpr);
    if (strs.some((s) => s === null)) return null;
    rows.push(strs);
  }
  return rows;
}

/** Static String[][] / String[] field initialisers of a class: name → raw expression. */
export function arrayFields(src) {
  const out = new Map();
  const re = /(?:static\s+)?(?:final\s+)?String\s*\[\s*\]\s*\[\s*\]\s+(\w+)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    let i = start;
    while (i < src.length && src[i] !== '{' && src[i] !== ';') i++;
    if (src[i] !== '{') continue;
    const close = matchClose(src, i);
    out.set(m[1], src.slice(start, close + 1));
  }
  return out;
}

/** String[] field initialisers of a class: name → raw `{...}` expression. */
export function arrayFields1D(src) {
  const out = new Map();
  const re =
    /(?:static\s+)?(?:final\s+)?String\s*\[\s*\]\s+(\w+)\s*=\s*(?:new\s+String\s*\[\s*\]\s*)?(?=\{)/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const close = matchClose(src, start);
    if (close > 0) out.set(m[1], src.slice(start, close + 1));
  }
  return out;
}

/** Integer constants `static final int NAME = 12;` (simple literals only). */
export function intFields(src) {
  const out = new Map();
  for (const m of src.matchAll(/static\s+(?:final\s+)?(?:int|short|byte)\s+(\w+)\s*=\s*(-?\d+)\s*;/g))
    out.set(m[1], Number(m[2]));
  return out;
}

/** String constants `static final String NAME = "x";`. */
export function stringFields(src) {
  const out = new Map();
  for (const m of src.matchAll(/(?:static\s+)?final\s+String\s+(\w+)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g))
    out.set(m[1], stringValue(m[2]));
  return out;
}
