import { add, dirVec, key, localCells, unitDir, rotatedSize, rotateLocal } from '../geometry';
import type { Vec3 } from '../core/types';
import type { MultiblockDef } from '../multiblock/types';
import type { DefCache, Shape } from './types';

/** A multiblock turned into rotated occupancy grids, and whether two turned units may overlap. */

/** Cell codes in a rotated occupancy grid. Casings get `CASING + blockIndex`. */
const EMPTY = 0;

const AIR = 1;

const CONTROLLER = 2;

const CASING = 3;

function gridIndex(size: Vec3, x: number, y: number, z: number): number {
  return (y * size[2] + z) * size[0] + x;
}

export function inside(size: Vec3, p: Vec3): boolean {
  return p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < size[0] && p[1] < size[1] && p[2] < size[2];
}

export function axisVec(a: number, v: number): Vec3 {
  return a === 0 ? [v, 0, 0] : a === 1 ? [0, v, 0] : [0, 0, v];
}

export function buildShapes(def: MultiblockDef): Shape[] {
  const blockIndex = new Map<string, number>();
  const cells = localCells(def);
  const shapes: Shape[] = [];
  for (let i = 0; i < 8; i++) {
    const r = (i % 4) as 0 | 1 | 2 | 3;
    const unit = { rotation: r, mirrored: i >= 4 };
    const size = rotatedSize(def, r);
    const grid = new Int32Array(size[0] * size[1] * size[2]);
    let front: Vec3 | null = null;
    for (const c of cells) {
      const p = rotateLocal(def, c.local, r, unit.mirrored);
      let code: number;
      if (c.role === 'air') code = AIR;
      else if (c.role === 'controller') {
        code = CONTROLLER;
        front = add(p, dirVec(unitDir(def.controller.facing, unit)));
      } else {
        const id = c.facing ? JSON.stringify([c.blockId, unitDir(c.facing, unit)]) : (c.blockId ?? '');
        let idx = blockIndex.get(id);
        if (idx === undefined) {
          idx = blockIndex.size;
          blockIndex.set(id, idx);
        }
        code = CASING + idx;
      }
      grid[gridIndex(size, p[0], p[1], p[2])] = code;
    }
    shapes.push({ size, grid, front });
  }
  return shapes;
}

/**
 * Can unit B (rotation rb, origin at offset d from unit A's origin) coexist with unit A (rotation ra)?
 * Overlapping cells must be casings of the same block on a wall-sharing def, or air on air; controllers never
 * overlap anything, air never overlaps a block, and neither controller's front cell may be covered by the
 * other unit's blocks.
 */
export function pairOk(def: MultiblockDef, cache: DefCache, ra: number, rb: number, d: Vec3): boolean {
  const k = `${ra},${rb},${key(d)}`;
  const hit = cache.pairs.get(k);
  if (hit !== undefined) return hit;
  const ok = computePairOk(def.wallshare, cache.shapes[ra], cache.shapes[rb], d);
  cache.pairs.set(k, ok);
  return ok;
}

function computePairOk(wallshare: boolean, a: Shape, b: Shape, d: Vec3): boolean {
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    lo[i] = Math.max(0, d[i]);
    hi[i] = Math.min(a.size[i], d[i] + b.size[i]);
  }
  for (let y = lo[1]; y < hi[1]; y++)
    for (let z = lo[2]; z < hi[2]; z++)
      for (let x = lo[0]; x < hi[0]; x++) {
        const ca = a.grid[gridIndex(a.size, x, y, z)];
        if (ca === EMPTY) continue;
        const cb = b.grid[gridIndex(b.size, x - d[0], y - d[1], z - d[2])];
        if (cb === EMPTY || (ca === AIR && cb === AIR)) continue;
        if (!wallshare || ca < CASING || ca !== cb) return false;
      }
  if (a.front) {
    const f: Vec3 = [a.front[0] - d[0], a.front[1] - d[1], a.front[2] - d[2]];
    if (inside(b.size, f) && b.grid[gridIndex(b.size, f[0], f[1], f[2])] >= CONTROLLER) return false;
  }
  if (b.front) {
    const f = add(b.front, d);
    if (inside(a.size, f) && a.grid[gridIndex(a.size, f[0], f[1], f[2])] >= CONTROLLER) return false;
  }
  return true;
}
