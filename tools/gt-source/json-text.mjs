/**
 * Edits of the catalog's JSON text that keep every other byte as it is: the files are Prettier-formatted by hand and
 * a re-serialised def would reflow all of it. Used by the tools that patch fields into `src/data/multiblocks/*.json`
 * (`hatch-extras.mjs`).
 */
import { matchClose } from './java.mjs';

/** One-line JSON (`{ "a": [ 1, 2 ] }`); Prettier breaks it where it does not fit. */
export const jsonLine = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ');

/** `{ key, start, end }` of every property of the object whose `{` is at `open`: `start` at the key's quote. */
export function props(text, open) {
  const close = matchClose(text, open);
  const out = [];
  let i = open + 1;
  while (i < close) {
    while (i < close && /[\s,]/.test(text[i])) i++;
    if (i >= close) break;
    const start = i;
    const keyEnd = matchString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd));
    i = text.indexOf(':', keyEnd) + 1;
    while (/\s/.test(text[i])) i++;
    let end;
    if ('[{'.includes(text[i])) end = matchClose(text, i) + 1;
    else if (text[i] === '"') end = matchString(text, i);
    else end = /[,}\s]/.exec(text.slice(i)).index + i;
    out.push({ key, start, end, valueStart: i });
    i = end;
  }
  return out;
}

/** Index just past the JSON string starting at `i`. */
function matchString(text, i) {
  let j = i + 1;
  while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** Index of the `{` of the top-level property `key` of a def's text, or -1; `{` of the def itself is at 0. */
export function openOf(text, path) {
  let open = text.indexOf('{');
  for (const key of path) {
    const p = props(text, open).find((x) => x.key === key);
    if (!p || text[p.valueStart] !== '{') return -1;
    open = p.valueStart;
  }
  return open;
}

/** The text without property `key` of the object at `open` (with its comma); unchanged when absent. */
export function removeProp(text, open, key) {
  const all = props(text, open);
  const at = all.findIndex((p) => p.key === key);
  if (at < 0) return text;
  let { start: from, end: to } = all[at];
  // Take the comma after the property, or for the last one the comma before it.
  if (at < all.length - 1) to = text.indexOf(',', to) + 1;
  else if (at > 0) from = all[at - 1].end;
  const out = text.slice(0, from) + text.slice(to);
  // A line the property had to itself goes with it.
  const lineStart = out.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = out.indexOf('\n', from);
  return lineEnd >= 0 && /^\s*$/.test(out.slice(lineStart, lineEnd))
    ? out.slice(0, lineStart) + out.slice(lineEnd + 1)
    : out;
}

/**
 * The text with `key: value` set on the object at `open`: replaced in place when present, else inserted before the
 * property `before` (when it exists) or after the last one.
 */
export function setProp(text, open, key, value, { before } = {}) {
  const all = props(text, open);
  const own = all.find((p) => p.key === key);
  const literal = typeof value === 'string' ? value : jsonLine(value);
  if (own) return text.slice(0, own.valueStart) + literal + text.slice(own.end);
  const next = before && all.find((p) => p.key === before);
  const expanded = /^\s*\n/.test(text.slice(open + 1));
  if (next) {
    const indent = /[ \t]*$/.exec(text.slice(0, next.start))[0];
    const head = text.slice(0, next.start);
    return expanded && /\n[ \t]*$/.test(head)
      ? `${head}"${key}": ${literal},\n${indent}${text.slice(next.start)}`
      : `${head}"${key}": ${literal}, ${text.slice(next.start)}`;
  }
  if (!all.length) return `${text.slice(0, open + 1)} "${key}": ${literal} ${text.slice(open + 1)}`;
  const last = all[all.length - 1];
  const indent = /[ \t]*$/.exec(text.slice(0, last.start))[0];
  const sep = expanded ? `,\n${indent}` : ', ';
  return `${text.slice(0, last.end)}${sep}"${key}": ${literal}${text.slice(last.end)}`;
}

/** `{` of the legend entry `ch` of a def's text, or -1. */
export function legendOpen(text, ch) {
  const legend = openOf(text, ['legend']);
  if (legend < 0) return -1;
  const p = props(text, legend).find((x) => x.key === ch);
  return p && text[p.valueStart] === '{' ? p.valueStart : -1;
}
