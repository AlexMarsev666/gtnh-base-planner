/**
 * Which cells of a catalog def are cells of a plain GT structure element, read by fitting the controller's piece of
 * the structure definition into the def:
 *
 *   .addShape("first", transpose(new String[][] { { " ", "e", " " }, { "~", "l", "G" }, ... }))
 *
 * A def drawn from the game dump gives one legend key to every cell of one block, so a plain grate casing (`G`, no
 * hatches) and the grate casings that take a Data Access Hatch (`d`) are one key, and giving that key a hatch kind
 * would give it to the plain cell too. The piece with the controller `~` is anchored at `controller.pos` and tried in
 * the eight turns and mirrors of the horizontal plane (it only stands upright); an orientation fits when every cell
 * of the piece is a cell of the def whose legend entry can be the piece's element (a block the element places, or a
 * hatch kind it takes; an element that names neither fits anything). The cells that every fitting orientation
 * covers with an element that takes no hatches are plain. Other pieces (the repeated slices) are not fitted: their
 * cells stay as they are.
 *
 * Shape forms (as `src/data/gt-structures.test.ts` reads them): `transpose(new String[][] {...})` is
 * `[layer from top][z]` strings along x; a plain `new String[][] {...}` is `[z][layer from top]`.
 */
import { elementCalls } from './hatch-elements.mjs';
import { arrayFields, findCalls, splitArgs, string2D, stringExpr, stringFields } from './java.mjs';

/** The blocks an element places: `ofBlock(...)` and the like, and `buildAndChain(block, meta)`. */
export function placedBlocks(expr, ctx, blocks) {
  const cands = [...blocks.elementBlocks(expr, ctx).cands];
  for (const call of findCalls(expr, 'buildAndChain')) {
    const [b, m] = splitArgs(call.args);
    const block = b === undefined ? null : blocks.blockOf(b, ctx);
    const meta = m === undefined ? undefined : blocks.metaOf(m, ctx);
    if (block && meta !== undefined) cands.push({ ...block, meta });
  }
  return cands;
}

/** `{ name, grid }` of every shape of the class chain: `grid[layer from top][z]` is a string along x. */
export function shapesOf(chain) {
  const arrays = new Map();
  const strings = new Map();
  for (const c of chain) {
    for (const [k, v] of arrayFields(c.body)) arrays.set(k, v);
    for (const [k, v] of stringFields(c.body)) strings.set(k, v);
  }
  const out = [];
  for (const c of chain)
    for (const call of findCalls(c.body, 'addShape')) {
      const [name, ...rest] = splitArgs(call.args);
      let expr = rest.join(',').trim();
      let transposed = false;
      const t = /^transpose\s*\(([\s\S]*)\)$/.exec(expr);
      if (t) [transposed, expr] = [true, t[1].trim()];
      const rows = string2D(arrays.get(expr) ?? expr);
      const label = stringExpr(name ?? '') ?? strings.get((name ?? '').replace(/^.*\./, '')) ?? null;
      if (!rows || label === null) continue;
      // `[z][layer]` becomes `[layer][z]`.
      const grid = transposed ? rows : rows[0].map((_, l) => rows.map((r) => r[l]));
      out.push({ name: label, grid });
    }
  return out;
}

/**
 * The cells of the def (`"x,y,z"`) that the controller piece of the class covers with an element that takes no
 * hatch kind, as `Set`s per legend key of `chars`; empty when the piece cannot be fitted or the shapes cannot be read.
 */
export function plainCells(def, chars, { rules, sourceClass, blocks, names, ctx, leaves }) {
  const chain = rules.chain(sourceClass);
  const piece = shapesOf(chain).find((s) => s.grid.some((r) => r.some((x) => x.includes('~'))));
  const out = new Map(chars.map((c) => [c, new Set()]));
  if (!piece) return out;
  const { calls } = elementCalls(rules, sourceClass);
  const kindsOf = (c) => new Set(leaves.filter((l) => l.char === c).flatMap((l) => l.kinds));
  const placed = new Map(calls.map((c) => [c.char, placedBlocks(c.expr, ctx, blocks)]));
  const fits = (c, ch) => {
    const e = def.legend[ch];
    if (!e) return false;
    const cands = placed.get(c) ?? [];
    const kinds = kindsOf(c);
    if (!cands.length && !kinds.size) return true;
    return (
      cands.some((b) => names.matches(b, e.blockId)) ||
      (e.hatches ?? []).some((k) => kinds.has(k)) ||
      (kinds.size > 0 && e.blockId.startsWith('gt.hatch.'))
    );
  };
  // Piece cells: [a (along x of the strings), layer from top, z].
  const cells = [];
  piece.grid.forEach((row, l) =>
    row.forEach((s, z) => [...s].forEach((c, a) => c !== ' ' && cells.push({ a, l, z, c }))),
  );
  const anchor = cells.find((c) => c.c === '~');
  const [cx, cy, cz] = def.controller.pos;
  const rows = def.layers;
  const charAt = (x, y, z) => [...(rows[y]?.[z] ?? '')][x];
  const fitted = [];
  for (const swap of [false, true])
    for (const sa of [1, -1])
      for (const sz of [1, -1]) {
        const at = ({ a, l, z }) => {
          const da = (a - anchor.a) * sa;
          const dz = (z - anchor.z) * sz;
          return swap ? [cx + dz, cy + (anchor.l - l), cz + da] : [cx + da, cy + (anchor.l - l), cz + dz];
        };
        const ok = cells.every((c) => {
          if (c.c === '~') return true;
          const [x, y, z] = at(c);
          const ch = charAt(x, y, z);
          return ch !== undefined && !' -~'.includes(ch) && fits(c.c, ch);
        });
        if (ok) fitted.push(new Map(cells.map((c) => [at(c).join(','), c.c])));
      }
  if (!fitted.length) return out;
  for (const key of fitted[0].keys()) {
    const [x, y, z] = key.split(',').map(Number);
    const ch = charAt(x, y, z);
    if (out.has(ch) && fitted.every((f) => f.has(key) && kindsOf(f.get(key)).size === 0))
      out.get(ch).add(key);
  }
  return out;
}
