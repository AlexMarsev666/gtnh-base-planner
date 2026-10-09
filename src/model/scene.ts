import { controllerFacing, key, unitCells } from './geometry';
import type { Vec3 } from './core/types';
import type { HatchKind, MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement, WallStats } from './plan/types';
import type { SceneModel, Voxel } from './render/types';
import type { RouteNet } from './routing/routeNet';

/**
 * UNIT 6 (renderer) — build the render model.
 *
 * Voxels: one per unique occupied cell (casings merged, controllers, hatches replacing casings),
 * with `conflict` set for cells listed in `stats.conflictCells`.
 * - `unitIds` lists every unit whose structure has a block at the cell (sorted ascending).
 * - A controller wins over a casing at the same cell (that overlap is a conflict anyway).
 * - A hatch replaces whatever block is at its cell; its block id comes from `def.hatchBlocks`.
 * - `bounds` is the union of the voxel cells: inclusive `min`, exclusive `max` (like `unitBounds`).
 *   Empty scenes get `{ min: [0,0,0], max: [0,0,0] }`.
 * Voxels are ordered by first occurrence (unit order, then structure order); pure and deterministic.
 */
export function buildSceneModel(
  def: MultiblockDef,
  units: Unit[],
  hatches: HatchPlacement[],
  stats: WallStats,
  pipes: RouteNet[] | null,
  colors: Record<HatchKind, string>,
): SceneModel {
  const byKey = new Map<string, Voxel>();
  const conflictKeys = new Set(stats.conflictCells.map(key));

  for (const unit of units) {
    const facing = controllerFacing(def, unit);
    for (const cell of unitCells(def, unit)) {
      if (cell.role === 'air' || !cell.blockId) continue;
      const k = key(cell.pos);
      const existing = byKey.get(k);
      if (existing) {
        if (!existing.unitIds.includes(unit.id)) existing.unitIds.push(unit.id);
        if (cell.role === 'controller' && existing.kind !== 'controller') {
          existing.kind = 'controller';
          existing.blockId = cell.blockId;
          existing.facing = facing;
        }
        continue;
      }
      const voxel: Voxel = {
        pos: cell.pos,
        blockId: cell.blockId,
        kind: cell.role === 'controller' ? 'controller' : 'casing',
        unitIds: [unit.id],
      };
      if (cell.role === 'controller') voxel.facing = facing;
      else if (cell.facing) voxel.facing = cell.facing;
      byKey.set(k, voxel);
    }
  }

  const hatchIds = new Set(Object.values(def.hatchBlocks));
  const host = hatchHost(def);
  for (const h of hatches) {
    const k = key(h.cell);
    let voxel = byKey.get(k);
    if (!voxel) {
      // A hatch outside every structure should not happen; still render it so the bug is visible.
      voxel = { pos: h.cell, blockId: '', kind: 'hatch', unitIds: [...h.unitIds] };
      byKey.set(k, voxel);
    }
    // The casing it replaces; a cell only a hatch may fill takes the casing the machine's hatches go on.
    const base =
      voxel.kind === 'casing' && voxel.blockId && !hatchIds.has(voxel.blockId) ? voxel.blockId : host;
    voxel.kind = 'hatch';
    voxel.hatchKind = h.kind;
    voxel.facing = h.face;
    voxel.blockId = def.hatchBlocks[h.kind] ?? (voxel.blockId || 'gt.hatch.inputBus');
    if (h.tier) voxel.blockId += `.${h.tier}`;
    if (base) voxel.baseBlockId = base;
  }

  const voxels = [...byKey.values()];
  let min: Vec3 = [0, 0, 0];
  let max: Vec3 = [0, 0, 0];
  if (voxels.length > 0) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const [k, v] of byKey) {
      if (conflictKeys.has(k)) v.conflict = true;
      v.unitIds.sort((a, b) => a - b);
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], v.pos[i]);
        hi[i] = Math.max(hi[i], v.pos[i] + 1);
      }
    }
    min = [lo[0], lo[1], lo[2]];
    max = [hi[0], hi[1], hi[2]];
  }

  return { voxels, hatches, pipes, bounds: { min, max }, colors };
}

const hosts = new WeakMap<MultiblockDef, string | undefined>();

/** The block most of a multiblock's hatch cells are made of (the casing its hatches go on), if any. */
export function hatchHost(def: MultiblockDef): string | undefined {
  if (hosts.has(def)) return hosts.get(def);
  const hatchIds = new Set(Object.values(def.hatchBlocks));
  const counts = new Map<string, number>();
  for (const layer of def.layers)
    for (const row of layer)
      for (const ch of row) {
        const e = def.legend[ch];
        if (e?.hatches?.length && !hatchIds.has(e.blockId))
          counts.set(e.blockId, (counts.get(e.blockId) ?? 0) + 1);
      }
  let best: string | undefined;
  for (const [id, n] of counts) if (best === undefined || n > counts.get(best)!) best = id;
  hosts.set(def, best);
  return best;
}
