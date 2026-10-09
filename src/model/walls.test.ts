import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import type { Rotation, Vec3 } from './core/types';
import type { MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement } from './plan/types';
import { computeWallStats } from './walls';

const coke = getMultiblock('coke-oven')!;
const BRICK = 'gt.cokeOvenBrick';
const CTRL = 'gt.cokeOvenController';
const HATCH = 'gt.cokeOvenHatch';
/** Non-air cells of one coke oven: 25 bricks + 1 controller. */
const PER_OVEN = 26;

function u(id: number, origin: Vec3, rotation: Rotation = 0): Unit {
  return { id, origin, rotation };
}

function hatch(cell: Vec3, unitIds: number[], kind: HatchPlacement['kind'] = 'itemIn'): HatchPlacement {
  return { kind, cell, face: 'up', unitIds };
}

const keys = (cells: readonly Vec3[]): string[] => cells.map((c) => c.join(',')).sort();

/** Coke oven whose east column (local x = 2) is steel instead of brick. */
const steelEast: MultiblockDef = {
  ...coke,
  id: 'steel-east',
  layers: [
    ['CCD', 'CCD', 'CCD'],
    ['C~D', 'C-D', 'CCD'],
    ['CCD', 'CCD', 'CCD'],
  ],
  legend: { ...coke.legend, D: { blockId: 'gt.casing.solidSteel' } },
};

/** 3 wide, 3 high, 5 deep solid box with the controller in the north face. */
const longBox: MultiblockDef = {
  ...coke,
  id: 'long-box',
  size: [3, 3, 5],
  layers: [
    ['CCC', 'CCC', 'CCC', 'CCC', 'CCC'],
    ['C~C', 'CCC', 'CCC', 'CCC', 'CCC'],
    ['CCC', 'CCC', 'CCC', 'CCC', 'CCC'],
  ],
};

describe('computeWallStats', () => {
  it('rejects a shared directional block when the two structures require different fronts', () => {
    const def: MultiblockDef = {
      ...coke,
      id: 'directional-wall',
      size: [3, 1, 3],
      layers: [['CCC', 'C~C', 'CCC']],
      legend: { C: { blockId: BRICK, facing: 'north' } },
    };
    const shared = computeWallStats(def, [u(0, [0, 0, 0]), u(1, [2, 0, 0])], []);
    expect(shared.conflictCells).toEqual([]);
    expect(shared.byBlock[BRICK]).toBe(13);
    const conflicting = computeWallStats(def, [u(0, [0, 0, 0]), u(1, [2, 0, 0], 2)], []);
    expect(keys(conflicting.conflictCells)).toEqual(['2,0,0', '2,0,1', '2,0,2']);
    expect(conflicting.savedBlocks).toBe(0);
  });
  it('returns zeros for an empty plan', () => {
    expect(computeWallStats(coke, [], [])).toEqual({
      totalBlocks: 0,
      byBlock: {},
      controllers: 0,
      hatches: 0,
      sharedWalls: [],
      conflicts: [],
      conflictCells: [],
      savedBlocks: 0,
    });
  });

  it('counts a single oven', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0])], []);
    expect(s.totalBlocks).toBe(PER_OVEN);
    expect(s.byBlock).toEqual({ [BRICK]: 25, [CTRL]: 1 });
    expect(s.controllers).toBe(1);
    expect(s.savedBlocks).toBe(0);
  });

  it('merges two ovens sharing a face at pitch 2', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [2, 0, 0])], []);
    expect(s.sharedWalls).toEqual([[0, 1]]);
    expect(s.conflicts).toEqual([]);
    expect(s.conflictCells).toEqual([]);
    expect(s.totalBlocks).toBe(2 * PER_OVEN - 9);
    expect(s.byBlock).toEqual({ [BRICK]: 41, [CTRL]: 2 });
    expect(s.controllers).toBe(2);
    expect(s.savedBlocks).toBe(9);
  });

  it('shares walls when stacked vertically', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [0, 2, 0])], []);
    expect(s.sharedWalls).toEqual([[0, 1]]);
    expect(s.savedBlocks).toBe(9);
  });

  it('does not share walls between touching but non-overlapping ovens', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [3, 0, 0])], []);
    expect(s.sharedWalls).toEqual([]);
    expect(s.savedBlocks).toBe(0);
    expect(s.totalBlocks).toBe(2 * PER_OVEN);
  });

  it('2x2 grid: 4 face contacts, diagonal pairs are not shared walls', () => {
    // Back row turned around (rotation 2) so its controllers face south, away from the shared walls.
    const units = [u(0, [0, 0, 0]), u(1, [2, 0, 0]), u(2, [0, 0, 2], 2), u(3, [2, 0, 2], 2)];
    const s = computeWallStats(coke, units, []);
    expect(s.sharedWalls).toEqual([
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(s.conflicts).toEqual([]);
    // 4 faces of 9 cells; the central column (3 cells) is shared by all 4 units.
    expect(s.totalBlocks).toBe(4 * PER_OVEN - 4 * 6 - 3 * 3);
    expect(s.controllers).toBe(4);
    expect(s.savedBlocks).toBe(4 * 6 + 3 * 3);
  });

  it('diagonal edge-only contact is not a shared wall', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [2, 0, 2], 2)], []);
    expect(s.sharedWalls).toEqual([]);
    expect(s.conflicts).toEqual([]);
    expect(s.savedBlocks).toBe(3);
  });

  it('partial face overlap saves blocks but is not a shared wall', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [2, 0, 1])], []);
    expect(s.sharedWalls).toEqual([]);
    expect(s.conflicts).toEqual([]);
    expect(s.savedBlocks).toBe(6);
  });

  it('flags a wall placed onto a controller', () => {
    // Unit 1 sits north of unit 0; its back wall covers unit 0's controller at (1, 1, 0).
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [0, 0, -2])], []);
    expect(s.conflicts).toEqual([[0, 1]]);
    expect(keys(s.conflictCells)).toEqual(['1,1,0']);
    expect(s.sharedWalls).toEqual([]);
    // The conflicting cell is counted once, as the controller.
    expect(s.controllers).toBe(2);
    expect(s.byBlock).toEqual({ [BRICK]: 41, [CTRL]: 2 });
    expect(s.totalBlocks).toBe(43);
    // Only the 8 valid brick merges are savings; the clash on the controller is not.
    expect(s.savedBlocks).toBe(8);
  });

  it('flags overlaps with another unit air cell', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(1, [1, 0, 0])], []);
    expect(s.conflicts).toEqual([[0, 1]]);
    const cells = keys(s.conflictCells);
    expect(cells).toContain('1,1,1'); // unit 0 air vs unit 1 brick
    expect(cells).toContain('2,1,1'); // unit 1 air vs unit 0 brick
    expect(cells).toContain('1,1,0'); // unit 0 controller vs unit 1 brick
    expect(cells).toContain('2,1,0'); // unit 1 controller vs unit 0 brick
    expect(cells).toHaveLength(4);
    expect(s.sharedWalls).toEqual([]);
  });

  it('treats every overlap as a conflict when wallshare is off', () => {
    const def: MultiblockDef = { ...coke, wallshare: false };
    const s = computeWallStats(def, [u(0, [0, 0, 0]), u(1, [2, 0, 0])], []);
    expect(s.conflicts).toEqual([[0, 1]]);
    expect(s.conflictCells).toHaveLength(9);
    expect(s.sharedWalls).toEqual([]);
    expect(s.savedBlocks).toBe(0);
  });

  it('flags overlaps of different block ids', () => {
    const s = computeWallStats(steelEast, [u(0, [0, 0, 0]), u(1, [2, 0, 0])], []);
    expect(s.conflicts).toEqual([[0, 1]]);
    expect(s.conflictCells).toHaveLength(9);
    expect(s.sharedWalls).toEqual([]);
    expect(s.savedBlocks).toBe(0);
  });

  it('matches blocks of rotated units', () => {
    // Rotating unit 1 by 180° turns its steel column to the west, facing unit 0's steel column.
    const s = computeWallStats(steelEast, [u(0, [0, 0, 0]), u(1, [2, 0, 0], 2)], []);
    expect(s.conflicts).toEqual([]);
    expect(s.sharedWalls).toEqual([[0, 1]]);
    expect(s.byBlock['gt.casing.solidSteel']).toBe(9 + 9 - 9);
  });

  it('shares walls between units with different rotations', () => {
    const units = [u(0, [0, 0, 0]), u(1, [2, 0, 0], 1), u(2, [-2, 0, 0], 3)];
    const s = computeWallStats(coke, units, []);
    expect(s.conflicts).toEqual([]);
    expect(s.sharedWalls).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(s.savedBlocks).toBe(18);
  });

  it('accepts a face that is a full side of only the smaller side', () => {
    // Unit 1 (rotated long box) presents a 3x3 end to unit 0's 3x5 side.
    const s = computeWallStats(longBox, [u(0, [0, 0, 0]), u(1, [2, 0, 0], 1)], []);
    expect(s.conflicts).toEqual([]);
    expect(s.sharedWalls).toEqual([[0, 1]]);
    expect(s.savedBlocks).toBe(9);
  });

  it('counts a shared hatch once and replaces the casing', () => {
    const units = [u(0, [0, 0, 0]), u(1, [2, 0, 0])];
    const hatches = [
      hatch([2, 0, 1], [0, 1], 'itemIn'),
      hatch([2, 0, 1], [0, 1], 'itemOut'), // same cell again: still one block
      hatch([0, 2, 1], [0], 'fluidOut'),
    ];
    const s = computeWallStats(coke, units, hatches);
    expect(s.hatches).toBe(2);
    expect(s.byBlock).toEqual({ [BRICK]: 39, [HATCH]: 2, [CTRL]: 2 });
    expect(s.totalBlocks).toBe(43);
    expect(s.savedBlocks).toBe(9);
  });

  it('ignores hatches placed on a controller', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0])], [hatch([1, 1, 0], [0])]);
    expect(s.hatches).toBe(0);
    expect(s.byBlock).toEqual({ [BRICK]: 25, [CTRL]: 1 });
  });

  it('counts hatches outside a casing without touching the savings', () => {
    const hatches = [hatch([1, 1, 1], [0]), hatch([5, 5, 5], [0], 'itemOut')];
    const s = computeWallStats(coke, [u(0, [0, 0, 0])], hatches);
    expect(s.hatches).toBe(2);
    expect(s.byBlock).toEqual({ [BRICK]: 25, [CTRL]: 1, [HATCH]: 2 });
    expect(s.totalBlocks).toBe(28);
    expect(s.savedBlocks).toBe(0);
  });

  it('uses a hatch.<kind> id when the def has no hatch block for that kind', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0])], [hatch([0, 0, 0], [0], 'energy')]);
    expect(s.byBlock['hatch.energy']).toBe(1);
    expect(s.byBlock[BRICK]).toBe(24);
  });

  it('keeps far-apart cells distinct', () => {
    const units = [u(0, [70000, 0, 0]), u(1, [-70000, 0, 0]), u(2, [70000, 0, -140000])];
    const s = computeWallStats(coke, units, []);
    expect(s.totalBlocks).toBe(3 * PER_OVEN);
    expect(s.conflicts).toEqual([]);
  });

  it('lets air meet air: turbines share a side wall across their rotor space', () => {
    const turbine = getMultiblock('large-steam-turbine')!;
    const s = computeWallStats(turbine, [u(0, [0, 0, 0]), u(1, [2, 0, 0])], []);
    expect(s.conflicts).toEqual([]);
    expect(s.sharedWalls).toEqual([[0, 1]]);
  });

  it('never pairs a unit with itself when ids repeat', () => {
    const s = computeWallStats(coke, [u(0, [0, 0, 0]), u(0, [0, 0, 0])], []);
    expect(s.conflicts).toEqual([]);
    expect(s.sharedWalls).toEqual([]);
    // Only the controllers clash; identical bricks merge and air on air is fine.
    expect(keys(s.conflictCells)).toEqual(['1,1,0']);
  });

  it('is pure and deterministic', () => {
    const units = Object.freeze([u(0, [0, 0, 0]), u(1, [2, 0, 0]), u(2, [0, 0, -2])].map(Object.freeze));
    const hatches = Object.freeze([Object.freeze(hatch([2, 0, 1], [0, 1]))]);
    const a = computeWallStats(coke, units as Unit[], hatches as HatchPlacement[]);
    const b = computeWallStats(coke, units as Unit[], hatches as HatchPlacement[]);
    expect(a).toEqual(b);
  });

  it('handles 60 units in under 20 ms', () => {
    // 10 wide x 6 high wall of ovens, all facing north: controllers never touch a shared plane.
    const units: Unit[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) units.push(u(units.length, [x * 2, y * 2, 0]));
    const first = computeWallStats(coke, units, []);
    expect(first.conflicts).toEqual([]);
    expect(first.sharedWalls).toHaveLength(9 * 6 + 10 * 5);
    expect(first.controllers).toBe(60);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      computeWallStats(coke, units, []);
      times.push(performance.now() - t0);
    }
    times.sort((p, q) => p - q);
    expect(times[2]).toBeLessThan(20);
  });
});
