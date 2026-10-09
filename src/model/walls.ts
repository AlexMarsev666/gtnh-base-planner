import {
  localCells,
  packCell,
  rotateLocal,
  rotatedSize,
  unitBounds,
  unitCells,
  type CellKey,
} from './geometry';
import type { CellRole, Dir, Rotation, Vec3 } from './core/types';
import type { MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement, WallStats } from './plan/types';

interface Occupant {
  unitId: number;
  role: CellRole;
  blockId?: string;
  facing?: Dir;
}

interface CellEntry {
  occupants: Occupant[];
  conflict: boolean;
}

interface PairInfo {
  lo: number;
  hi: number;
  count: number;
  conflict: boolean;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * For each rotation: number of structure cells on each boundary plane of the rotated bounding box.
 * Index `axis * 2` = min side (west / down / north), `axis * 2 + 1` = max side (east / up / south).
 */
const sideCache = new WeakMap<MultiblockDef, number[][]>();

function sideCounts(def: MultiblockDef): number[][] {
  const cached = sideCache.get(def);
  if (cached) return cached;
  const cells = localCells(def);
  const out: number[][] = [];
  for (let r = 0; r < 4; r++) {
    const rot = r as Rotation;
    const size = rotatedSize(def, rot);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const c of cells) {
      const p = rotateLocal(def, c.local, rot);
      for (let a = 0; a < 3; a++) {
        if (p[a] === 0) counts[a * 2]++;
        if (p[a] === size[a] - 1) counts[a * 2 + 1]++;
      }
    }
    out.push(counts);
  }
  sideCache.set(def, out);
  return out;
}

function compatible(def: MultiblockDef, a: Occupant, b: Occupant): boolean {
  if (a.role === 'air' && b.role === 'air') return true;
  return (
    def.wallshare &&
    a.role === 'casing' &&
    b.role === 'casing' &&
    a.blockId === b.blockId &&
    a.facing === b.facing
  );
}

/** True when the pair's whole overlap is one boundary plane that covers a full side of either unit. */
function isFaceContact(def: MultiblockDef, pair: PairInfo, units: Map<number, Unit>): boolean {
  const ua = units.get(pair.lo);
  const ub = units.get(pair.hi);
  if (!ua || !ub) return false;
  const ba = unitBounds(def, ua);
  const bb = unitBounds(def, ub);
  const sides = sideCounts(def);
  for (let axis = 0; axis < 3; axis++) {
    if (pair.min[axis] !== pair.max[axis]) continue;
    const v = pair.min[axis];
    // [low unit, high unit]: the plane is the max side of `low` and the min side of `high`.
    const orders: [Unit, { min: Vec3; max: Vec3 }, Unit, { min: Vec3; max: Vec3 }][] = [
      [ua, ba, ub, bb],
      [ub, bb, ua, ba],
    ];
    for (const [low, lowB, high, highB] of orders) {
      if (lowB.max[axis] - 1 !== v || highB.min[axis] !== v) continue;
      const lowSide = sides[low.rotation][axis * 2 + 1];
      const highSide = sides[high.rotation][axis * 2];
      if (pair.count === lowSide || pair.count === highSide) return true;
    }
  }
  return false;
}

function sortPairs(pairs: [number, number][]): [number, number][] {
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/**
 * UNIT 2 — Walls & stats.
 *
 * Merge the occupancy of all units (see `unitCells` in ./geometry):
 * - Overlapping casing cells with the same blockId (and wallshare enabled) count once.
 * - Air on air is fine: both structures only need the cell empty (e.g. the rotor space in front of two
 *   Large Turbines side by side). It is not a block, so it saves nothing.
 * - Any other overlap (different blocks, controller, air cell of another unit against a block) is a
 *   conflict. A conflict cell is counted once in the totals (controller first,
 *   else the first unit's block), but it never counts as a saved block.
 * - `sharedWalls` lists only pairs with a full face contact (not edge/corner-only neighbours):
 *   the pair's whole overlap is a one-block-thick boundary plane of both units, free of
 *   conflicts, covering every structure cell of that side of at least one of the two units.
 * - Hatch cells count as hatch blocks (their `hatchBlocks` id, or `hatch.<kind>` when the def
 *   lacks one), not casings. Several placements on one cell count once (the first one wins).
 *   Hatches on a controller cell are ignored.
 * - `savedBlocks` = blocks needed to build every unit alone minus `totalBlocks`, counting only
 *   valid (compatible) merges: invalid overlaps and stray hatches never add or remove savings.
 * Pure; O(units * cells).
 */
export function computeWallStats(def: MultiblockDef, units: Unit[], hatches: HatchPlacement[]): WallStats {
  const cells = new Map<CellKey, CellEntry>();
  const pairs = new Map<string, PairInfo>();
  const conflictCells: Vec3[] = [];

  const touchPair = (a: number, b: number, pos: Vec3, conflict: boolean): void => {
    if (a === b) return; // duplicate unit ids: no pair with itself
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = `${lo},${hi}`;
    let info = pairs.get(k);
    if (!info) {
      info = { lo, hi, count: 0, conflict: false, min: [...pos], max: [...pos] };
      pairs.set(k, info);
    }
    info.count++;
    info.conflict ||= conflict;
    for (let i = 0; i < 3; i++) {
      if (pos[i] < info.min[i]) info.min[i] = pos[i];
      if (pos[i] > info.max[i]) info.max[i] = pos[i];
    }
  };

  const unitById = new Map<number, Unit>();
  for (const unit of units) {
    if (!unitById.has(unit.id)) unitById.set(unit.id, unit);
    for (const cell of unitCells(def, unit)) {
      const occ: Occupant = { unitId: unit.id, role: cell.role, blockId: cell.blockId, facing: cell.facing };
      const pk = packCell(cell.pos);
      const entry = cells.get(pk);
      if (!entry) {
        cells.set(pk, { occupants: [occ], conflict: false });
        continue;
      }
      for (const other of entry.occupants) {
        const bad = !compatible(def, other, occ);
        if (bad && !entry.conflict) {
          entry.conflict = true;
          conflictCells.push(cell.pos);
        }
        touchPair(other.unitId, unit.id, cell.pos, bad);
      }
      entry.occupants.push(occ);
    }
  }

  // Hatch cells: first placement per cell wins; a hatch never replaces a controller.
  const hatchAt = new Map<CellKey, string>();
  for (const h of hatches) {
    const pk = packCell(h.cell);
    if (hatchAt.has(pk)) continue;
    if (cells.get(pk)?.occupants.some((o) => o.role === 'controller')) continue;
    hatchAt.set(pk, (def.hatchBlocks[h.kind] ?? `hatch.${h.kind}`) + (h.tier ? `.${h.tier}` : ''));
  }

  const byBlock: Record<string, number> = {};
  const bump = (id: string): void => {
    byBlock[id] = (byBlock[id] ?? 0) + 1;
  };
  let totalBlocks = 0;
  let controllers = 0;
  let savedBlocks = 0;
  for (const [pk, entry] of cells) {
    // A valid merge is all casings of one block id: every occupant past the first is saved.
    if (!entry.conflict && entry.occupants[0].role !== 'air') savedBlocks += entry.occupants.length - 1;
    const hatchBlock = hatchAt.get(pk);
    if (hatchBlock !== undefined) {
      bump(hatchBlock);
      totalBlocks++;
      continue;
    }
    // Physical block: the controller if any, else the first non-air occupant.
    const ctrl = entry.occupants.find((o) => o.role === 'controller');
    const solid = ctrl ?? entry.occupants.find((o) => o.role !== 'air');
    if (!solid?.blockId) continue;
    if (ctrl) controllers++;
    bump(solid.blockId);
    totalBlocks++;
  }
  // Hatches outside every structure are still blocks of the build.
  for (const [pk, blockId] of hatchAt) {
    if (cells.has(pk)) continue;
    bump(blockId);
    totalBlocks++;
  }

  const sharedWalls: [number, number][] = [];
  const conflicts: [number, number][] = [];
  for (const info of pairs.values()) {
    if (info.conflict) conflicts.push([info.lo, info.hi]);
    else if (isFaceContact(def, info, unitById)) sharedWalls.push([info.lo, info.hi]);
  }

  return {
    totalBlocks,
    byBlock,
    controllers,
    hatches: hatchAt.size,
    sharedWalls: sortPairs(sharedWalls),
    conflicts: sortPairs(conflicts),
    conflictCells,
    savedBlocks,
  };
}
