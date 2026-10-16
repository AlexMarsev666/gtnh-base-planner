import { PLACEHOLDER_DEF } from '../../data/generic';
import { unitCells } from '../geometry';
import type { Rotation, Vec3 } from '../core/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { groupPoint, rotatedGroupSize } from './group';

/**
 * The side faces of a group and what two groups may share there. A group's faces are read from its layout
 * (units in group-local coordinates), without hatches: hatches are kept off the planes two groups share
 * (see `sharedPlanes`), so only the structure counts.
 */

/** What a group has at a cell: air, a cell no other group may have too, or a block id. A gap is `undefined`. */
export type Mark = string;
export const AIR: Mark = '\u0000air';
/** A controller, a hatch or a placeholder casing: the same cell of another group is always a conflict. */
export const NEVER: Mark = '\u0000never';

const PLACEHOLDER_BLOCK = PLACEHOLDER_DEF.legend.c.blockId;

/** The mark of a structure cell: `blockId` is that of a casing, `undefined` for air. */
export function markOf(role: 'air' | 'controller' | 'casing', blockId: string | undefined): Mark {
  if (role === 'air') return AIR;
  if (role === 'controller' || blockId === undefined || blockId === PLACEHOLDER_BLOCK) return NEVER;
  return blockId;
}

/**
 * Whether two different groups may both have a cell (a gap is compatible with anything and is not a mark):
 * both air, or the same casing block on both sides.
 */
export function sharable(a: Mark, b: Mark): boolean {
  if (a === AIR && b === AIR) return true;
  return a !== AIR && b !== AIR && a !== NEVER && a === b;
}

/** One side of a group: `len` columns along the face, `h` cells up each; `cells[column * h + y]`, a gap is `undefined`. */
export interface Face {
  len: number;
  h: number;
  cells: (Mark | undefined)[];
}

/** The four side faces of a group turned to a rotation: min X, max X, min Z, max Z (columns run along Z, Z, X, X). */
export interface GroupFaces {
  minX: Face;
  maxX: Face;
  minZ: Face;
  maxZ: Face;
}

/** What a group's layout looks like, for `groupFaces`. */
export interface FaceSource {
  def: MultiblockDef;
  units: readonly Unit[];
  /** Local size [x, y, z]. */
  size: Vec3;
}

const faceOf = (len: number, h: number): Face => ({ len, h, cells: new Array(len * h).fill(undefined) });

/** The faces of a group turned `r` times (see `groupPoint`). */
export function groupFaces(src: FaceSource, r: Rotation): GroupFaces {
  const sy = src.size[1];
  const [rw, , rd] = rotatedGroupSize(src.size, r);
  const faces: GroupFaces = {
    minX: faceOf(rd, sy),
    maxX: faceOf(rd, sy),
    minZ: faceOf(rw, sy),
    maxZ: faceOf(rw, sy),
  };
  const put = (face: Face, column: number, y: number, mark: Mark) => {
    const k = column * face.h + y;
    const cur = face.cells[k];
    // What the group needs over all its units (non-air wins), whatever unit comes first.
    if (cur === undefined || cur === AIR) face.cells[k] = mark;
    else if (mark !== AIR && cur !== mark) face.cells[k] = NEVER;
  };
  for (const u of src.units)
    for (const c of unitCells(src.def, u)) {
      const [x, y, z] = groupPoint(c.pos, src.size, r, [0, 0]);
      if (x !== 0 && x !== rw - 1 && z !== 0 && z !== rd - 1) continue;
      const mark = markOf(c.role, c.blockId);
      if (x === 0) put(faces.minX, z, y, mark);
      if (x === rw - 1) put(faces.maxX, z, y, mark);
      if (z === 0) put(faces.minZ, x, y, mark);
      if (z === rd - 1) put(faces.maxZ, x, y, mark);
    }
  return faces;
}

/** The faces of a layout per rotation, each computed on first use. */
export type LazyFaces = (r: Rotation) => GroupFaces;

export function lazyFaces(src: FaceSource): LazyFaces {
  const memo: (GroupFaces | undefined)[] = [];
  return (r) => (memo[r] ??= groupFaces(src, r));
}

/** The block ids on any side face of the group in any turn. */
export function faceBlocks(faces: LazyFaces): Set<string> {
  const out = new Set<string>();
  for (let r = 0; r < 4; r++) {
    const f = faces(r as Rotation);
    for (const face of [f.minX, f.maxX, f.minZ, f.maxZ])
      for (const m of face.cells) if (m !== undefined && m !== AIR && m !== NEVER) out.add(m);
  }
  return out;
}

/**
 * Compares two faces that stand on the same plane: `a` starts at `alongA` (block along the plane) and `ya`
 * (height), `b` at `alongB` and `yb`. Returns -1 when some cell both have is not `sharable`, else the number
 * of cells that are the same block on both sides (what sharing saves).
 */
export function sharedAcross(
  a: Face,
  alongA: number,
  ya: number,
  b: Face,
  alongB: number,
  yb: number,
): number {
  const lo = Math.max(alongA, alongB);
  const hi = Math.min(alongA + a.len, alongB + b.len);
  const ylo = Math.max(ya, yb);
  const yhi = Math.min(ya + a.h, yb + b.h);
  let shared = 0;
  for (let t = lo; t < hi; t++)
    for (let y = ylo; y < yhi; y++) {
      const ma = a.cells[(t - alongA) * a.h + (y - ya)];
      const mb = b.cells[(t - alongB) * b.h + (y - yb)];
      if (ma === undefined || mb === undefined) continue;
      if (!sharable(ma, mb)) return -1;
      if (ma !== AIR) shared++;
    }
  return shared;
}

/** A group placed on the site, as far as walls two groups share are concerned. */
export interface PlacedBox {
  origin: [number, number];
  elevation: number;
  rotation: Rotation;
  /** Local size [x, y, z] before rotation. */
  size: Vec3;
  /** Never shares a wall (`wallshare: 'separate'`). */
  separate: boolean;
}

/** The inverse of `groupPoint`: where the local cell is that stands at the site point `p`. */
export function groupLocal(p: Vec3, size: Vec3, r: Rotation, origin: [number, number], elevation = 0): Vec3 {
  let x = p[0] - origin[0];
  let z = p[2] - origin[1];
  // Turn k took x' = (z extent before it) - 1 - z and z' = x; the extents swap every turn.
  for (let k = r - 1; k >= 0; k--) {
    const nz = (k % 2 === 0 ? size[2] : size[0]) - 1 - x;
    x = z;
    z = nz;
  }
  return [x, p[1] - elevation, z];
}

/**
 * How two footprints (min corner and size of `a`, then of `b`) touch when they overlap by exactly one block on
 * one axis and by more than that on the other: the `FLUSH_*` side, or `FLUSH_NONE`. A number, not an object:
 * the annealer asks for every pair at every step.
 */
export const FLUSH_NONE = 0;
/** `a`'s max face meets the min face of `b` along X, `a`'s min face meets `b`'s max face along X, the same along Z. */
export const FLUSH_X_LOW = 1;
export const FLUSH_X_HIGH = 2;
export const FLUSH_Z_LOW = 3;
export const FLUSH_Z_HIGH = 4;

export function flushContact(
  ax: number,
  az: number,
  aw: number,
  ad: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
): number {
  const xo = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const zo = Math.min(az + ad, bz + bd) - Math.max(az, bz);
  if (xo === 1 && zo > 0) {
    const low = bx === ax + aw - 1;
    if (low !== (ax === bx + bw - 1)) return low ? FLUSH_X_LOW : FLUSH_X_HIGH;
  }
  if (zo === 1 && xo > 0) {
    const low = bz === az + ad - 1;
    if (low !== (az === bz + bd - 1)) return low ? FLUSH_Z_LOW : FLUSH_Z_HIGH;
  }
  return FLUSH_NONE;
}

/**
 * For each placed group, the cells (in its own unturned local frame) of the planes it may share with another
 * group: where two footprints touch by one block (`flushContact`) and the floors overlap, the plane's cells in
 * the overlap. Groups that never share, and groups not placed (`undefined`), have none.
 */
export function sharedPlanes(boxes: readonly (PlacedBox | undefined)[]): Vec3[][] {
  const out: Vec3[][] = boxes.map(() => []);
  const ext = boxes.map((b) => {
    if (!b) return undefined;
    const [w, h, d] = rotatedGroupSize(b.size, b.rotation);
    return { x: b.origin[0], z: b.origin[1], w, d, y: b.elevation, h };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = ext[i];
      const b = ext[j];
      if (!a || !b || boxes[i]!.separate || boxes[j]!.separate) continue;
      const c = flushContact(a.x, a.z, a.w, a.d, b.x, b.z, b.w, b.d);
      if (c === FLUSH_NONE) continue;
      const alongX = c === FLUSH_X_LOW || c === FLUSH_X_HIGH;
      const aLow = c === FLUSH_X_LOW || c === FLUSH_Z_LOW;
      const y0 = Math.max(a.y, b.y);
      const y1 = Math.min(a.y + a.h, b.y + b.h);
      if (y1 <= y0) continue;
      // The plane's coordinate across, and the stretch along it that both footprints cover.
      const across = alongX ? (aLow ? b.x : a.x) : aLow ? b.z : a.z;
      const along0 = alongX ? Math.max(a.z, b.z) : Math.max(a.x, b.x);
      const along1 = alongX ? Math.min(a.z + a.d, b.z + b.d) : Math.min(a.x + a.w, b.x + b.w);
      for (let t = along0; t < along1; t++)
        for (let y = y0; y < y1; y++) {
          const p: Vec3 = alongX ? [across, y, t] : [t, y, across];
          for (const g of [i, j]) {
            const bx = boxes[g]!;
            out[g].push(groupLocal(p, bx.size, bx.rotation, bx.origin, bx.elevation));
          }
        }
    }
  return out;
}
