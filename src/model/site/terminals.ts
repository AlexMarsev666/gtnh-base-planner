import type { Rotation } from '../core/types';

/**
 * Where a group's links of one resource may attach: the box [minX, maxX, minZ, maxZ] (block edges, x and z of
 * the group's own, unturned frame) around the cells a hatch for it may take. Layout searches use it to tell
 * which way a turned group can face its partners; a hatch leans to its partners within the box.
 */
export type Reach = readonly [number, number, number, number];

/** Per resource key, where a group's links of it may attach. */
export type Terminals = Readonly<Record<string, Reach>>;

/** The box around cells [x, z] (block corners, so a cell [x, z] spans x to x + 1), or null for none. */
export function reachOf(cells: Iterable<readonly [number, number]>): Reach | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of cells) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x + 1);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z + 1);
  }
  return x1 > x0 ? [x0, x1, z0, z1] : null;
}

/**
 * `box` of a footprint of `size` = [x, z] turned `r` quarter turns clockwise (the turn of `groupPoint`), as
 * bounds from the min corner of the turned footprint.
 */
export function turnedReach(box: Reach, size: readonly [number, number], r: Rotation): Reach {
  let [x0, x1, z0, z1] = box;
  let w = size[0];
  let d = size[1];
  for (let i = 0; i < r; i++) {
    [x0, x1, z0, z1] = [d - z1, d - z0, x0, x1];
    [w, d] = [d, w];
  }
  return [x0, x1, z0, z1];
}

/** Whether `box` spans a whole footprint: turning the group then changes nothing about where links attach. */
export function coversFootprint(box: Reach, size: readonly [number, number]): boolean {
  return box[0] <= 0 && box[1] >= size[0] && box[2] <= 0 && box[3] >= size[1];
}
