import type { Dir, HorizontalDir } from './core/types';
import type { ZonedDef } from './hatches/types';
import type { HatchKind, LegendEntry, MultiblockDef, ResizeRule } from './multiblock/types';

/**
 * Orientations of a multiblock: a mirror image along its local X axis (a left-handed build of a handed
 * structure), upside down (a roll of 180 degrees about the controller's facing axis, which is a flip of X and of
 * Y) and a mirror along local Y. A variant is `0` as drawn, `1` flipped in X, `2` flipped in X and Y, `3`
 * flipped in Y; the yaw `rotation` of a unit is separate. The structure, its controller and the side
 * restrictions of its hatch cells all move with the flips (east/west for X, up/down for Y); regions and zones
 * belong to cells, so they move with them and keep their names.
 */

type Variant = 0 | 1 | 2 | 3;

const FLIP: Record<Dir, Dir> = {
  east: 'west',
  west: 'east',
  north: 'north',
  south: 'south',
  up: 'up',
  down: 'down',
};

const FLIP_Y: Record<Dir, Dir> = {
  east: 'east',
  west: 'west',
  north: 'north',
  south: 'south',
  up: 'down',
  down: 'up',
};

/** `[flipX, flipY]` of each variant. */
const FLAGS: readonly (readonly [boolean, boolean])[] = [
  [false, false],
  [true, false],
  [true, true],
  [false, true],
];

const variantOfFlags = (x: boolean, y: boolean): Variant => (x ? (y ? 2 : 1) : y ? 3 : 0);

/** The variant that is `a` and then `b` applied (the flags add up modulo 2). */
export function composeVariants(a: Variant, b: Variant): Variant {
  return variantOfFlags(FLAGS[a][0] !== FLAGS[b][0], FLAGS[a][1] !== FLAGS[b][1]);
}

/** The variant `def` is in relative to the catalog entry it came from (carried through `sizedDef`). */
export function variantOfDef(def: MultiblockDef): Variant {
  const z = def as ZonedDef;
  return variantOfFlags(!!z.zoneMirrored, !!z.zoneFlipped);
}

/** Where an oriented def came from: the first def of its family and its variant relative to that. */
const origin = new WeakMap<MultiblockDef, { root: MultiblockDef; v: Variant }>();
const tables = new WeakMap<MultiblockDef, MultiblockDef[]>();

/**
 * `def` in `variant`, relative to `def` itself (`orientedDef(def, 0) === def`). Memoised per definition (so
 * the per-def caches in geometry, layout and walls keep working): every orientation of a family is one object,
 * and applying a variant twice gives back the original object. Composes with `sizedDef` in either order: the
 * two give the same structure (same cells, controller, legend entries and resize rule). With a resize along a
 * flipped axis whose slab cells carry regions, the copies would be numbered from the other end of the
 * structure (the Distillation Tower's `layerN` under a Y flip are numbered from its top when it is flipped
 * before it is sized, from its bottom otherwise); no catalog entry has an X-axis resize with regions, and
 * mirror.test.ts asserts that.
 * The resize rule is kept in terms of the smallest form (`rule.min`), like the stored definitions.
 * Hatch zone cells (`ZonedDef.zoneCells`) move with the structure, and `zoneMirrored` / `zoneFlipped` mark the
 * flips so `withHatchZones` can place the zones of the catalog file on an oriented (and resized) def.
 */
export function orientedDef(def: MultiblockDef, variant: Variant): MultiblockDef {
  if (variant === 0) return def;
  const o = origin.get(def) ?? { root: def, v: 0 as Variant };
  const target = composeVariants(o.v, variant);
  let table = tables.get(o.root);
  if (!table) tables.set(o.root, (table = [o.root]));
  let out = table[target];
  if (!out) {
    out = table[target] = orient(o.root, target);
    origin.set(out, { root: o.root, v: target });
  }
  return out;
}

/** `def` mirrored along local X: `orientedDef(def, 1)`. */
export function mirroredDef(def: MultiblockDef): MultiblockDef {
  return orientedDef(def, 1);
}

/**
 * The local cell key `"x,y,z"` of a cell in the mirrored structure. `sizeX` is the SIZED width
 * (`sizedDef(def, n).size[0]`), not the stored smallest form.
 */
export function mirrorCellKey(cellKey: string, sizeX: number): string {
  const [x, ...rest] = cellKey.split(',');
  return [sizeX - 1 - Number(x), ...rest].join(',');
}

/**
 * Per-cell data keyed by `"x,y,z"` (e.g. the `cells` of a def in `hatch-zones.generated.json`, which
 * `mirroredDef` cannot carry because it lives outside the def) moved to the mirrored structure; `sizeX` is the
 * sized width (`sizedDef(def, n).size[0]`).
 */
export function mirrorCells<T>(cells: Readonly<Record<string, T>>, sizeX: number): Record<string, T> {
  return flipCells(cells, [sizeX, 0, 0], true, false);
}

/** Per-cell data (`"x,y,z"` keys) moved with a structure of the sized `size` flipped in X and/or Y. */
export function flipCells<T>(
  cells: Readonly<Record<string, T>>,
  size: readonly number[],
  fx: boolean,
  fy: boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(cells)) {
    const [x, y, ...rest] = k.split(',');
    out[[fx ? size[0] - 1 - Number(x) : x, fy ? size[1] - 1 - Number(y) : y, ...rest].join(',')] = v;
  }
  return out;
}

function orient(def: MultiblockDef, variant: Variant): MultiblockDef {
  const [fx, fy] = FLAGS[variant];
  const [sx, sy] = def.size;
  let layers = def.layers.map((layer) => (fx ? layer.map((row) => [...row].reverse().join('')) : layer));
  if (fy) layers = layers.reverse();
  const legend: Record<string, LegendEntry> = {};
  for (const [ch, entry] of Object.entries(def.legend)) legend[ch] = orientEntry(entry, fx, fy);
  const facing = (fx ? FLIP[def.controller.facing] : def.controller.facing) as HorizontalDir;
  const pos: [number, number, number] = [
    fx ? sx - 1 - def.controller.pos[0] : def.controller.pos[0],
    fy ? sy - 1 - def.controller.pos[1] : def.controller.pos[1],
    def.controller.pos[2],
  ];
  const zoned = def as ZonedDef;
  const out: ZonedDef = {
    ...def,
    layers,
    legend,
    controller: { ...def.controller, pos, facing },
    ...(def.resize ? { resize: flipRule(def.resize, fx, fy) } : {}),
    ...(zoned.zoneCells ? { zoneCells: flipCells(zoned.zoneCells, def.size, fx, fy) } : {}),
  };
  if (fx) {
    if (zoned.zoneMirrored) delete out.zoneMirrored;
    else out.zoneMirrored = true;
  }
  if (fy) {
    if (zoned.zoneFlipped) delete out.zoneFlipped;
    else out.zoneFlipped = true;
  }
  return out;
}

function flipFaces(
  faces: Partial<Record<HatchKind, Dir[]>>,
  fx: boolean,
  fy: boolean,
): Partial<Record<HatchKind, Dir[]>> {
  const out: Partial<Record<HatchKind, Dir[]>> = {};
  for (const [kind, dirs] of Object.entries(faces) as [HatchKind, Dir[]][])
    out[kind] = dirs.map((d) => (fy ? FLIP_Y[d] : d)).map((d) => (fx ? FLIP[d] : d));
  return out;
}

function orientEntry(entry: LegendEntry, fx: boolean, fy: boolean): LegendEntry {
  if (!entry.disallowFaces && !entry.allowFaces) return entry;
  return {
    ...entry,
    ...(entry.disallowFaces ? { disallowFaces: flipFaces(entry.disallowFaces, fx, fy) } : {}),
    ...(entry.allowFaces ? { allowFaces: flipFaces(entry.allowFaces, fx, fy) } : {}),
  };
}

/** The slab `[from, to)` of a rule seen from the other end of the smallest form, when its axis is flipped. */
export function flipRule(rule: ResizeRule, fx: boolean, fy: boolean): ResizeRule {
  const flipped = rule.axis === 'x' ? fx : rule.axis === 'y' && fy;
  return flipped ? { ...rule, from: rule.min - rule.to, to: rule.min - rule.from } : rule;
}

/** The slab `[from, to)` seen from the other end of the smallest form (size `min` along the axis). */
export function mirrorRule(rule: ResizeRule): ResizeRule {
  return flipRule(rule, true, false);
}
