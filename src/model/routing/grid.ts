import type { Vec3 } from '../core/types';
import { MARGIN, MAX_GRID_CELLS } from './constants';
import type { Grid } from './types';

/** The dense voxel grid routing searches: structure, reserved cells and the open air around them. */

/** `occ` values: free, solid (structure, reserved cell or grid border). */
export const FREE = 0;

const SOLID = 1;

export function indexOf(g: Grid, p: Vec3): number {
  return p[0] - g.ox + g.dx * (p[1] - g.oy + g.dy * (p[2] - g.oz));
}

export function posOf(g: Grid, i: number): Vec3 {
  const x = i % g.dx;
  const rest = (i - x) / g.dx;
  const y = rest % g.dy;
  const z = (rest - y) / g.dy;
  return [x + g.ox, y + g.oy, z + g.oz];
}

/**
 * Grid for the search box, or null when it would exceed `MAX_GRID_CELLS`. With `trench`, the lowest free
 * layer is a trench under the build: never a wall cell, so a pipe there pays the off-wall cost and goes
 * underground only where that saves pipe.
 */
export function buildGrid(solids: Vec3[], terminals: Vec3[], ground: number, trench = false): Grid | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const list of [solids, terminals])
    for (const p of list) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
  // Search box = bounds grown by MARGIN; plus one border cell on each side that is always solid.
  const pad = MARGIN + 1;
  const ox = minX - pad;
  const oy = minY - pad;
  const oz = minZ - pad;
  const dx = maxX - minX + 1 + 2 * pad;
  const dy = maxY - minY + 1 + 2 * pad;
  const dz = maxZ - minZ + 1 + 2 * pad;
  if (dx * dy * dz > MAX_GRID_CELLS) return null;
  const occ = new Uint8Array(dx * dy * dz);
  const termMask = new Uint16Array(dx * dy * dz);
  const wall = new Uint8Array(dx * dy * dz);
  const g: Grid = {
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    occ,
    termMask,
    wall,
    floor: Math.max(1, Math.min(dy - 2, ground - oy)),
    offsets: Int32Array.from([-dx * dy, dx * dy, 1, -1, dx, -dx]),
  };
  for (let z = 0; z < dz; z++)
    for (let y = 0; y < dy; y++)
      for (let x = 0; x < dx; x++)
        if (x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1)
          occ[x + dx * (y + dy * z)] = SOLID;
  for (const p of solids) occ[indexOf(g, p)] = SOLID;
  // Everything below the build's lowest layer is ground: pipes stay above it.
  for (let z = 0; z < dz; z++)
    for (let y = 0; y < Math.min(dy, ground - oy); y++)
      for (let x = 0; x < dx; x++) occ[x + dx * (y + dy * z)] = SOLID;
  // Wall cells: free cells beside a solid that is not the border (structure or ground).
  const inner = (n: number, c: number, size: number) => occ[n] === SOLID && c > 0 && c < size - 1;
  for (let z = 1; z < dz - 1; z++)
    for (let y = 1; y < dy - 1; y++)
      for (let x = 1; x < dx - 1; x++) {
        const i = x + dx * (y + dy * z);
        if (occ[i] !== FREE) continue;
        if (
          inner(i - 1, x - 1, dx) ||
          inner(i + 1, x + 1, dx) ||
          inner(i - dx, y - 1, dy) ||
          inner(i + dx, y + 1, dy) ||
          inner(i - dx * dy, z - 1, dz) ||
          inner(i + dx * dy, z + 1, dz)
        )
          wall[i] = 1;
      }
  if (trench) {
    const y = ground - oy;
    if (y > 0 && y < dy - 1)
      for (let z = 0; z < dz; z++) wall.fill(0, dx * (y + dy * z), dx * (y + dy * z) + dx);
  }
  return g;
}

/**
 * Free cells connected to the outside of the build (flood fill from a corner just inside the solid grid
 * border at ground level, which the search margin keeps free). Cells in sealed pockets are unreachable in
 * game, so a pipe never attaches there.
 */
export function outsideCells(g: Grid): Uint8Array {
  const { occ, offsets } = g;
  const open = new Uint8Array(occ.length);
  const start = 1 + g.dx * (g.floor + g.dy);
  const queue = new Int32Array(occ.length);
  let head = 0;
  let tail = 0;
  open[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    for (let d = 0; d < 6; d++) {
      const n = cur + offsets[d];
      if (open[n] === 1 || occ[n] !== FREE) continue;
      open[n] = 1;
      queue[tail++] = n;
    }
  }
  return open;
}

/** Marks a free cell solid so no pipe passes through it. */
export function reserve(g: Grid, p: Vec3): void {
  const x = p[0] - g.ox;
  const y = p[1] - g.oy;
  const z = p[2] - g.oz;
  if (x < 0 || y < 0 || z < 0 || x >= g.dx || y >= g.dy || z >= g.dz) return;
  const i = indexOf(g, p);
  if (g.occ[i] === FREE) g.occ[i] = SOLID;
}
