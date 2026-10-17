/**
 * Completes a dump that was cut short with the structure definition's own shape.
 *
 * The extractor builds every controller in a scratch world of limited height, so a tall structure loses its top
 * layers (the Exo Foundry: 47 of its 55). The tooltip's `beginStructureBlock(w, h, d, ...)` /
 * `beginVariableStructureBlock(wMin, wMax, hMin, hMax, dMin, dMax, ...)` says how big the structure is; where the
 * dump is smaller in a fixed dimension, the cells the dump lacks are read from the controller's piece of the
 * structure definition (`addShape(..., transpose(new String[][] {...}))`, see `shape-fit.mjs` for the forms).
 *
 * The shape's letters carry no blocks here: each letter takes the dump's own cell (block, hatch kinds, hint dot)
 * wherever the dump placed that letter, so the legend stays that of the rest of the entry. A letter the dump never
 * placed, or one whose cells differ, cannot be completed and fails with a message.
 *
 * Frame: the shape's first axis runs to the right of a controller seen from its front, west (-X) for the dump's
 * north-facing controller; layers run down from the top; the strings' rows run back from the front (+Z).
 */
import { findCalls, intFields, splitArgs } from './java.mjs';
import { shapesOf } from './shape-fit.mjs';

const vkey = (p) => `${p[0]},${p[1]},${p[2]}`;

/**
 * The structure size the tooltip names, `{ min: [w, h, d], max: [w, h, d] }` (equal for `beginStructureBlock`), from
 * the nearest class of the chain that has the call, or null when there is none or an argument is no literal.
 */
export function structureSize(chain) {
  const consts = new Map();
  for (const c of chain) for (const [k, v] of intFields(c.body)) if (!consts.has(k)) consts.set(k, v);
  const num = (s) => {
    const t = (s ?? '').trim();
    return /^\d+$/.test(t) ? Number(t) : (consts.get(t.replace(/^.*\./, '')) ?? null);
  };
  for (const c of chain) {
    for (const call of findCalls(c.body, 'beginStructureBlock')) {
      const v = splitArgs(call.args).slice(0, 3).map(num);
      if (v.length === 3 && v.every((n) => n !== null)) return { min: v, max: v };
    }
    for (const call of findCalls(c.body, 'beginVariableStructureBlock')) {
      const v = splitArgs(call.args).slice(0, 6).map(num);
      if (v.length === 6 && v.every((n) => n !== null))
        return { min: [v[0], v[2], v[4]], max: [v[1], v[3], v[5]] };
    }
  }
  return null;
}

/**
 * The axes ('y', and 'xz' for both horizontal ones) in which a dump of bounding box `dump` (`[x, y, z]`) is smaller
 * than the tooltip's size in a dimension the tooltip fixes (min equals max). The tooltip's width and depth are in
 * no reliable order: the horizontal axes only count when the dump is too small both ways round.
 */
export function shortAxes(size, dump) {
  const fixed = (a) => size.min[a] === size.max[a];
  const [w, h, d] = size.min;
  const out = [];
  if (fixed(1) && dump[1] < h) out.push('y');
  const fits = (a, b) => dump[0] >= a && dump[2] >= b;
  if (fixed(0) && fixed(2) && !fits(w, d) && !fits(d, w)) out.push('xz');
  return out;
}

/** The controller's piece of the structure definition, `grid[layer from top][z]` (strings along the first axis). */
export function controllerPiece(chain) {
  return shapesOf(chain).find((s) => s.grid.some((r) => r.some((x) => x.includes('~'))))?.grid ?? null;
}

const cellKey = (c) => `${c.blockId}|${(c.hatches ?? []).join(',')}|${c.region ?? ''}`;

/**
 * The cells of `grid` that lie outside the dump's bounding box, built from the dump's cell of the same letter.
 * `cells` is the dump's cells by position key (`{ d, blockId, hatches, region? }`, `d` relative to the controller at
 * `ctrl`); the shape is anchored at its `~`. Returns `{ added, letters, at }`: the new cells, per letter the
 * template cell it took (for every letter the dump placed), and `at(a, layer, z)`, the position of a shape cell. Throws when
 * a letter the new cells need has no or several templates, or when the shape does not agree with the dump where
 * both have a cell.
 */
export function completeFromShape(cells, ctrl, grid) {
  let anchor = null;
  grid.forEach((row, l) =>
    row.forEach((s, z) => (anchor ??= s.includes('~') ? { a: s.indexOf('~'), l, z } : null)),
  );
  if (!anchor) throw new Error('the shape has no controller');
  const at = (a, l, z) => [ctrl[0] - (a - anchor.a), ctrl[1] + (anchor.l - l), ctrl[2] + (z - anchor.z)];
  const all = [...cells.values()].map((c) => c.d).concat([ctrl]);
  const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])));
  const inBox = (p) => p.every((v, i) => v >= lo[i] && v <= hi[i]);

  const templates = new Map(); // letter -> Map(cellKey -> cell)
  const missing = []; // cells of the dump's box the shape has and the dump lacks
  const outside = []; // [letter, position]
  grid.forEach((row, l) =>
    row.forEach((s, z) =>
      [...s].forEach((ch, a) => {
        if (ch === ' ' || ch === '~' || ch === '-') return;
        const p = at(a, l, z);
        if (!inBox(p)) return outside.push([ch, p]);
        const c = cells.get(vkey(p));
        if (!c) return missing.push(`${ch} at ${vkey(p)}`);
        const m = templates.get(ch) ?? new Map();
        m.set(cellKey(c), c);
        templates.set(ch, m);
      }),
    ),
  );
  if (missing.length)
    throw new Error(
      `the shape has ${missing.length} cells the dump lacks inside its box (${missing.slice(0, 3).join('; ')})`,
    );
  const letters = new Map();
  const bad = [];
  for (const [ch, m] of templates) {
    if (m.size === 1) letters.set(ch, [...m.values()][0]);
    else bad.push(`'${ch}' is ${m.size} different cells in the dump`);
  }
  for (const ch of new Set(outside.map(([c]) => c))) {
    if (!templates.has(ch)) bad.push(`'${ch}' is not in the dump`);
    else if (!letters.has(ch) && !bad.some((b) => b.startsWith(`'${ch}'`)))
      bad.push(`'${ch}' is ambiguous in the dump`);
  }
  if (bad.length) throw new Error(`the shape does not fit the dump: ${[...new Set(bad)].join('; ')}`);
  const added = outside.map(([ch, p]) => {
    const t = letters.get(ch);
    return { ...t, d: p, hatches: [...(t.hatches ?? [])] };
  });
  return { added, letters, at };
}
