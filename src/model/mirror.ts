import type { Dir, HorizontalDir } from './core/types';
import type { ZonedDef } from './hatches/types';
import type { HatchKind, LegendEntry, MultiblockDef, ResizeRule } from './multiblock/types';

/**
 * Mirror image of a multiblock along its local X axis (a left-handed build of a handed structure). The
 * structure, its controller and the side restrictions of its hatch cells all swap east and west; regions and
 * zones belong to cells, so they move with them and keep their names.
 */

const FLIP: Record<Dir, Dir> = {
  east: 'west',
  west: 'east',
  north: 'north',
  south: 'south',
  up: 'up',
  down: 'down',
};

const memo = new WeakMap<MultiblockDef, MultiblockDef>();

/**
 * `def` mirrored along local X. Memoised per definition (so the per-def caches in geometry, layout and walls
 * keep working), and mirroring the result again gives back the original object. Composes with `sizedDef`
 * in either order: the two give the same structure (same cells, controller, legend entries and resize rule;
 * with an X-axis resize whose slab cells carry regions, the copies would be numbered from the other end of
 * the structure; no catalog entry has one, and mirror.test.ts asserts that).
 * The resize rule is kept in terms of the smallest form (`rule.min`), like the stored definitions.
 * Hatch zone cells (`ZonedDef.zoneCells`) move with the structure, and `zoneMirrored` marks it a mirror
 * image so `withHatchZones` can place the zones of the catalog file on a mirrored (and resized) def.
 */
export function mirroredDef(def: MultiblockDef): MultiblockDef {
  let out = memo.get(def);
  if (!out) {
    out = mirror(def);
    memo.set(def, out);
    memo.set(out, def);
  }
  return out;
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
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(cells)) out[mirrorCellKey(k, sizeX)] = v;
  return out;
}

function mirror(def: MultiblockDef): MultiblockDef {
  const [sx] = def.size;
  const layers = def.layers.map((layer) => layer.map((row) => [...row].reverse().join('')));
  const legend: Record<string, LegendEntry> = {};
  for (const [ch, entry] of Object.entries(def.legend)) legend[ch] = mirrorEntry(entry);
  const facing = FLIP[def.controller.facing] as HorizontalDir;
  const pos: [number, number, number] = [
    sx - 1 - def.controller.pos[0],
    def.controller.pos[1],
    def.controller.pos[2],
  ];
  const zoned = def as ZonedDef;
  const out: ZonedDef = {
    ...def,
    layers,
    legend,
    controller: { ...def.controller, pos, facing },
    ...(def.resize ? { resize: mirrorRule(def.resize) } : {}),
    ...(zoned.zoneCells ? { zoneCells: mirrorCells(zoned.zoneCells, sx) } : {}),
  };
  if (zoned.zoneMirrored) delete out.zoneMirrored;
  else out.zoneMirrored = true;
  return out;
}

function mirrorFaces(faces: Partial<Record<HatchKind, Dir[]>>): Partial<Record<HatchKind, Dir[]>> {
  const out: Partial<Record<HatchKind, Dir[]>> = {};
  for (const [kind, dirs] of Object.entries(faces) as [HatchKind, Dir[]][])
    out[kind] = dirs.map((d) => FLIP[d]);
  return out;
}

function mirrorEntry(entry: LegendEntry): LegendEntry {
  if (!entry.disallowFaces && !entry.allowFaces) return entry;
  return {
    ...entry,
    ...(entry.disallowFaces ? { disallowFaces: mirrorFaces(entry.disallowFaces) } : {}),
    ...(entry.allowFaces ? { allowFaces: mirrorFaces(entry.allowFaces) } : {}),
  };
}

/** The slab `[from, to)` seen from the other end of the smallest form (size `min` along the axis). */
export function mirrorRule(rule: ResizeRule): ResizeRule {
  return rule.axis === 'x' ? { ...rule, from: rule.min - rule.to, to: rule.min - rule.from } : rule;
}
