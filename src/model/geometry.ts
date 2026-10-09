import type { Dir, HorizontalDir, Rotation, Vec3 } from './core/types';
import type { MultiblockDef, Unit, UnitCell } from './multiblock/types';

/**
 * Shared geometry helpers. Implemented in the foundation; all model units must use these.
 */

/**
 * A multiblock definition that cannot be read (e.g. a structure character missing from its legend). The
 * one failure the model expects and turns into a result ("nothing placed"); any other error is a bug and
 * is left to surface.
 */
export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}

export const DIRS: readonly Dir[] = ['north', 'south', 'east', 'west', 'up', 'down'];

const VEC: Record<Dir, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const OPPOSITE: Record<Dir, Dir> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  up: 'down',
  down: 'up',
};

const CLOCKWISE: Record<HorizontalDir, HorizontalDir> = {
  east: 'south',
  south: 'west',
  west: 'north',
  north: 'east',
};

export function dirVec(d: Dir): Vec3 {
  return VEC[d];
}

export function opposite(d: Dir): Dir {
  return OPPOSITE[d];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function step(p: Vec3, d: Dir, n = 1): Vec3 {
  const v = VEC[d];
  return [p[0] + v[0] * n, p[1] + v[1] * n, p[2] + v[2] * n];
}

/** Direction of the step from a cell to a neighbouring one. */
export function dirBetween(from: Vec3, to: Vec3): Dir {
  if (to[0] !== from[0]) return to[0] > from[0] ? 'east' : 'west';
  if (to[1] !== from[1]) return to[1] > from[1] ? 'up' : 'down';
  return to[2] > from[2] ? 'south' : 'north';
}

/** Stable string key for a cell, e.g. "1,0,-2". */
export function key(p: Vec3): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/** Coordinate offset / range used to pack a cell into one number (exact below 2^53). */
const PACK_OFF = 1 << 16;
const PACK_SPAN = 1 << 17;

/** Map key for a cell: a packed number for the usual range, the string `key` outside it (never collides). */
export type CellKey = number | string;

export function packCell(p: Vec3): CellKey {
  for (const c of p) if (c < -PACK_OFF || c >= PACK_OFF) return key(p);
  return ((p[0] + PACK_OFF) * PACK_SPAN + (p[1] + PACK_OFF)) * PACK_SPAN + (p[2] + PACK_OFF);
}

export function parseKey(k: string): Vec3 {
  const [x, y, z] = k.split(',').map(Number);
  return [x, y, z];
}

export function rotateDir(d: Dir, r: Rotation): Dir {
  if (d === 'up' || d === 'down') return d;
  let out: HorizontalDir = d;
  for (let i = 0; i < r; i++) out = CLOCKWISE[out];
  return out;
}

/** Bounding size of a def after rotation (X and Z swap on odd rotations). */
export function rotatedSize(def: MultiblockDef, r: Rotation): Vec3 {
  const [sx, sy, sz] = def.size;
  return r % 2 === 0 ? [sx, sy, sz] : [sz, sy, sx];
}

/** Local cell -> offset inside the rotated bounding box. */
export function rotateLocal(def: MultiblockDef, p: Vec3, r: Rotation, mirrored = false): Vec3 {
  let [x, y, z] = p;
  if (mirrored) x = def.size[0] - 1 - x;
  let sx = def.size[0];
  let sz = def.size[2];
  for (let i = 0; i < r; i++) {
    // 90° clockwise seen from above: (x, z) -> (sz - 1 - z, x)
    const nx = sz - 1 - z;
    const nz = x;
    x = nx;
    z = nz;
    const t = sx;
    sx = sz;
    sz = t;
  }
  return [x, y, z];
}

export function toWorld(def: MultiblockDef, unit: Unit, local: Vec3): Vec3 {
  return add(unit.origin, rotateLocal(def, local, unit.rotation, unit.mirrored));
}

/** Local direction transformed in the same order as cells: reflection, then rotation. */
export function unitDir(d: Dir, unit: Pick<Unit, 'rotation' | 'mirrored'>): Dir {
  return rotateDir(unit.mirrored ? mirrorDir(d) : d, unit.rotation);
}

export function mirrorDir(d: Dir): Dir {
  return d === 'east' ? 'west' : d === 'west' ? 'east' : d;
}

export function orientationIndex(unit: Pick<Unit, 'rotation' | 'mirrored'>): number {
  return unit.rotation + (unit.mirrored ? 4 : 0);
}

interface LocalCell {
  local: Vec3;
  char: string;
  role: UnitCell['role'];
  blockId?: string;
  facing?: Dir;
  hatches?: UnitCell['hatches'];
}

const localCache = new WeakMap<MultiblockDef, LocalCell[]>();

/** All structure cells of a def in local coords (spaces skipped). Cached per def object. */
export function localCells(def: MultiblockDef): LocalCell[] {
  const cached = localCache.get(def);
  if (cached) return cached;
  const out: LocalCell[] = [];
  const [sx, sy, sz] = def.size;
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const char = def.layers[y]?.[z]?.[x] ?? ' ';
        if (char === ' ') continue;
        const local: Vec3 = [x, y, z];
        if (char === '~') out.push({ local, char, role: 'controller', blockId: def.controller.blockId });
        else if (char === '-') out.push({ local, char, role: 'air' });
        else {
          const entry = def.legend[char];
          if (!entry) throw new DefinitionError(`${def.id}: unknown legend char "${char}" at ${key(local)}`);
          out.push({
            local,
            char,
            role: 'casing',
            blockId: entry.blockId,
            hatches: entry.hatches,
            ...(entry.facing ? { facing: entry.facing } : {}),
          });
        }
      }
  localCache.set(def, out);
  return out;
}

/** Structure cells of a placed unit in world coords. */
export function unitCells(def: MultiblockDef, unit: Unit): UnitCell[] {
  return localCells(def).map((c) => ({
    ...c,
    pos: toWorld(def, unit, c.local),
    ...(c.facing ? { facing: unitDir(c.facing, unit) } : {}),
  }));
}

/** World direction the unit's controller faces. */
export function controllerFacing(def: MultiblockDef, unit: Unit): Dir {
  return unitDir(def.controller.facing, unit);
}

/** World bounding box (inclusive min, exclusive max) of a unit. */
export function unitBounds(def: MultiblockDef, unit: Unit): { min: Vec3; max: Vec3 } {
  return { min: unit.origin, max: add(unit.origin, rotatedSize(def, unit.rotation)) };
}
