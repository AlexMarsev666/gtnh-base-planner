import { describe, expect, it } from 'vitest';
import cokeOvenJson from '../data/multiblocks/coke-oven.json';
import { DEFAULT_HATCH_COLORS } from './colors';
import { key } from './geometry';
import { buildSceneModel } from './scene';
import { getMultiblock } from '../data/catalog';
import type { Vec3 } from './core/types';
import type { MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement, WallStats } from './plan/types';
import type { RouteNet } from './routing/routeNet';

const coke = cokeOvenJson as unknown as MultiblockDef;

function stats(conflictCells: Vec3[] = []): WallStats {
  return {
    totalBlocks: 0,
    byBlock: {},
    controllers: 0,
    hatches: 0,
    sharedWalls: [],
    conflicts: [],
    conflictCells,
    savedBlocks: 0,
  };
}

function byPos(voxels: ReturnType<typeof buildSceneModel>['voxels']) {
  return new Map(voxels.map((v) => [key(v.pos), v]));
}

describe('buildSceneModel', () => {
  for (const [rotation, facing] of ['north', 'east', 'south', 'west'].entries()) {
    it(`keeps Target Chamber's concrete Beam Input front facing ${facing}`, () => {
      const def = getMultiblock('target-chamber')!;
      const unit: Unit = { id: 0, origin: [10, 2, -3], rotation: rotation as Unit['rotation'] };
      const scene = buildSceneModel(def, [unit], [], stats(), null, DEFAULT_HATCH_COLORS);
      const beam = scene.voxels.filter((v) => v.blockId === 'gregtech:gt.blockmachines@10503');
      expect(beam).toHaveLength(1);
      expect(beam[0].facing).toBe(facing);
      expect(beam[0].kind).toBe('casing'); // Fixed structural block, not an ordinary resource hatch.
    });
  }
  it('builds one voxel per non-air cell of a single coke oven', () => {
    const units: Unit[] = [{ id: 1, origin: [0, 0, 0], rotation: 0 }];
    const m = buildSceneModel(coke, units, [], stats(), null, DEFAULT_HATCH_COLORS);
    expect(m.voxels).toHaveLength(26);
    const map = byPos(m.voxels);
    expect(map.has('1,1,1')).toBe(false); // air interior
    const ctrl = map.get('1,1,0')!;
    expect(ctrl.kind).toBe('controller');
    expect(ctrl.blockId).toBe('gt.cokeOvenController');
    expect(ctrl.facing).toBe('north');
    expect(map.get('0,0,0')).toMatchObject({ kind: 'casing', blockId: 'gt.cokeOvenBrick', unitIds: [1] });
    expect(m.bounds).toEqual({ min: [0, 0, 0], max: [3, 3, 3] });
    expect(m.colors).toBe(DEFAULT_HATCH_COLORS);
    expect(m.pipes).toBeNull();
  });

  it('rotates the controller facing with the unit', () => {
    const units: Unit[] = [{ id: 7, origin: [10, 0, -5], rotation: 1 }];
    const m = buildSceneModel(coke, units, [], stats(), null, DEFAULT_HATCH_COLORS);
    const ctrl = m.voxels.find((v) => v.kind === 'controller')!;
    expect(ctrl.facing).toBe('east');
    expect(ctrl.pos).toEqual([12, 1, -4]);
    expect(m.bounds).toEqual({ min: [10, 0, -5], max: [13, 3, -2] });
  });

  it('merges shared wall cells and lists every unit that occupies them', () => {
    const units: Unit[] = [
      { id: 2, origin: [2, 0, 0], rotation: 0 },
      { id: 1, origin: [0, 0, 0], rotation: 0 },
    ];
    const m = buildSceneModel(coke, units, [], stats(), null, DEFAULT_HATCH_COLORS);
    expect(m.voxels).toHaveLength(26 * 2 - 9);
    const keys = m.voxels.map((v) => key(v.pos));
    expect(new Set(keys).size).toBe(keys.length);
    const map = byPos(m.voxels);
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 3; z++) expect(map.get(key([2, y, z]))!.unitIds).toEqual([1, 2]);
    expect(map.get('0,0,0')!.unitIds).toEqual([1]);
    expect(map.get('4,0,0')!.unitIds).toEqual([2]);
    expect(m.bounds).toEqual({ min: [0, 0, 0], max: [5, 3, 3] });
  });

  it('replaces casings with hatches and keeps the occupying units', () => {
    const units: Unit[] = [
      { id: 1, origin: [0, 0, 0], rotation: 0 },
      { id: 2, origin: [2, 0, 0], rotation: 0 },
    ];
    const hatches: HatchPlacement[] = [
      { kind: 'itemIn', cell: [2, 2, 1], face: 'up', unitIds: [1, 2] },
      { kind: 'fluidOut', cell: [4, 1, 1], face: 'east', unitIds: [2] },
    ];
    const pipes: RouteNet[] = [{ kind: 'itemIn', paths: [[[2, 3, 1]]], length: 1, connected: 1, total: 1 }];
    const m = buildSceneModel(coke, units, hatches, stats(), pipes, DEFAULT_HATCH_COLORS);
    expect(m.voxels).toHaveLength(26 * 2 - 9);
    const map = byPos(m.voxels);
    expect(map.get('2,2,1')).toMatchObject({
      kind: 'hatch',
      hatchKind: 'itemIn',
      facing: 'up',
      blockId: 'gt.cokeOvenHatch',
      unitIds: [1, 2],
    });
    expect(map.get('4,1,1')).toMatchObject({ kind: 'hatch', hatchKind: 'fluidOut', facing: 'east' });
    // A hatch keeps the casing it replaces, for DETAILED view.
    expect(map.get('2,2,1')!.baseBlockId).toBe('gt.cokeOvenBrick');
    expect(m.hatches).toBe(hatches);
    expect(m.pipes).toBe(pipes);
    expect(m.voxels.filter((v) => v.kind === 'hatch')).toHaveLength(2);
  });

  it('marks conflict cells and lets a controller win over an overlapping casing', () => {
    // Unit 2 is shifted so its controller lands on unit 1's back wall.
    const units: Unit[] = [
      { id: 1, origin: [0, 0, 0], rotation: 0 },
      { id: 2, origin: [0, 0, 2], rotation: 0 },
    ];
    const conflict: Vec3 = [1, 1, 2];
    const m = buildSceneModel(coke, units, [], stats([conflict]), null, DEFAULT_HATCH_COLORS);
    const map = byPos(m.voxels);
    const cell = map.get(key(conflict))!;
    expect(cell.conflict).toBe(true);
    expect(cell.kind).toBe('controller');
    expect(cell.facing).toBe('north');
    expect(cell.unitIds).toEqual([1, 2]);
    expect(m.voxels.filter((v) => v.conflict)).toHaveLength(1);
  });

  it('handles an empty plan', () => {
    const m = buildSceneModel(coke, [], [], stats(), null, DEFAULT_HATCH_COLORS);
    expect(m.voxels).toEqual([]);
    expect(m.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it('does not mutate its inputs', () => {
    const units: Unit[] = [{ id: 1, origin: [0, 0, 0], rotation: 0 }];
    const hatches: HatchPlacement[] = [{ kind: 'itemOut', cell: [1, 0, 1], face: 'down', unitIds: [1] }];
    const snapshot = JSON.stringify({ units, hatches });
    buildSceneModel(coke, units, hatches, stats(), null, DEFAULT_HATCH_COLORS);
    expect(JSON.stringify({ units, hatches })).toBe(snapshot);
  });
});
