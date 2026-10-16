import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_DEF } from '../../data/generic';
import { requiredBlocks } from '../bom';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { createSiteBuilder } from './build';
import { analyzeOccupancy } from './occupancy';
import type { PlacedGroup } from './buildTypes';
import type { SiteGroup, SiteState } from './types';

// An EBF at rotation 0 is 3 x 4 x 3; its controller is in the middle of the north face (z = origin z), and
// the cell in front of it is one north of that.
const EBF = 'electric-blast-furnace';

function group(id: string, multiblockId: string, origin: [number, number], extra: Partial<SiteGroup> = {}) {
  return {
    id,
    multiblockId,
    count: 1,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [],
    origin,
    rotation: 0,
    ...extra,
  } as SiteGroup;
}

const site = (groups: SiteGroup[]): SiteState => ({
  v: 1,
  kind: 'site',
  size: [40, 30],
  corridor: 2,
  groups,
  links: [],
  ports: [],
  resources: {},
  colors: {},
});

const build = (s: SiteState) => createSiteBuilder()(s, { pipes: false, cables: false });
const overlaps = (b: ReturnType<typeof build>) => b.warnings.filter((w) => w.type === 'overlap');
const conflicts = (b: ReturnType<typeof build>) => b.scene.voxels.filter((v) => v.conflict).length;

describe('walls shared between groups', () => {
  it('lets two EBF groups share a wall: no conflict, cells shared, blocks counted once', () => {
    const alone = build(site([group('a', EBF, [3, 3])]));
    const b = build(site([group('a', EBF, [3, 3]), group('b', EBF, [5, 3])]));
    expect(overlaps(b)).toEqual([]);
    expect(conflicts(b)).toBe(0);
    // The wall column x = 5 is 4 high and 3 deep, minus nothing: 12 blocks, one group's worth saved.
    expect(b.stats.sharedBlocks).toBe(12);
    expect(requiredBlocks(b.scene).totalBlocks).toBe(2 * requiredBlocks(alone.scene).totalBlocks - 12);
    expect(b.stats.blocks).toBe(2 * alone.stats.blocks - 12);
    // A shared voxel answers for the units of both groups.
    expect(b.scene.voxels.filter((v) => v.unitIds.length === 2)).toHaveLength(12);
    expect(b.scene.voxels.length).toBe(2 * alone.scene.voxels.length - 12);
    // Apart, nothing is shared.
    expect(build(site([group('a', EBF, [3, 3]), group('b', EBF, [8, 3])])).stats.sharedBlocks).toBe(0);
  });

  it('is a conflict where the casings differ', () => {
    const b = build(site([group('a', EBF, [3, 3]), group('b', 'vacuum-freezer', [5, 3])]));
    expect(overlaps(b)).toEqual([{ type: 'overlap', groups: ['a', 'b'] }]);
    expect(conflicts(b)).toBeGreaterThan(0);
    expect(b.stats.sharedBlocks).toBe(0);
  });

  it('shares coil cells only between the same coils', () => {
    const same = build(
      site([group('a', EBF, [3, 3], { coil: 'nichrome' }), group('b', EBF, [5, 3], { coil: 'nichrome' })]),
    );
    expect(overlaps(same)).toEqual([]);
    expect(same.stats.sharedBlocks).toBe(12);
    const other = build(
      site([group('a', EBF, [3, 3], { coil: 'nichrome' }), group('b', EBF, [5, 3], { coil: 'kanthal' })]),
    );
    expect(overlaps(other)).toEqual([{ type: 'overlap', groups: ['a', 'b'] }]);
    expect(other.stats.sharedBlocks).toBeLessThan(12);
  });

  it('does not depend on the order of the groups', () => {
    const a = group('a', EBF, [3, 3]);
    const b = group('b', EBF, [5, 3]);
    const ab = build(site([a, b]));
    const ba = build(site([b, a]));
    expect(ba.stats.sharedBlocks).toBe(ab.stats.sharedBlocks);
    expect(ba.stats.blocks).toBe(ab.stats.blocks);
    expect(ba.scene.voxels.length).toBe(ab.scene.voxels.length);
  });

  it('is a conflict when a hatch sits in the shared wall', () => {
    const extra = { enabledHatches: ['energy', 'maintenance', 'muffler'] as SiteGroup['enabledHatches'] };
    // The energy hatch of the first group is on its east wall, the one the second group shares.
    const b = build(site([group('a', EBF, [3, 3], extra), group('b', EBF, [5, 3])]));
    expect(overlaps(b)).toEqual([{ type: 'overlap', groups: ['a', 'b'] }]);
    expect(conflicts(b)).toBeGreaterThan(0);
  });

  it('is no conflict when a shared wall covers the cell in front of another controller', () => {
    // The shared wall x = 5 of b and c holds (5, 0, 2), the front cell of a (its controller is at x = 5).
    const groups = [group('a', EBF, [4, 3]), group('b', EBF, [3, 0]), group('c', EBF, [5, 0])];
    const s = site(groups);
    const b = build(s);
    expect(overlaps(b)).toEqual([]);
    expect(conflicts(b)).toBe(0);
    expect(b.stats.sharedBlocks).toBe(12);
    // Pipes still keep out of the front cell.
    expect(analyzeOccupancy(s, b.groups).keepFree.some((p) => p.join() === '5,0,2')).toBe(true);
  });
});

describe('occupancy of groups with repeated cells', () => {
  const base = { ...PLACEHOLDER_DEF, wallshare: true };
  const casing = { c: { blockId: 'gt.casing.x' } };
  const slab: MultiblockDef = { ...base, size: [3, 1, 1], layers: [['~-c']], legend: casing };
  const wall: MultiblockDef = { ...base, size: [1, 1, 1], layers: [['c']], legend: casing };
  const pg = (index: number, def: MultiblockDef, xs: number[]) =>
    ({
      group: { id: `g${index}` },
      index,
      def,
      hatches: [],
      units: xs.map((x, id) => ({ id, origin: [x, 0, 0], rotation: 0 }) as Unit),
    }) as unknown as PlacedGroup;
  const s = { size: [20, 20], groups: [{ id: 'g0' }, { id: 'g1' }] } as unknown as SiteState;

  it('takes the strongest need of a group at a cell, whatever the order of its units', () => {
    // Unit 0 has a casing at x = 2, unit 1 (at x = 1) needs air there.
    for (const xs of [
      [0, 1],
      [1, 0],
    ]) {
      const o = analyzeOccupancy(s, [pg(0, slab, xs), pg(1, wall, [2])]);
      expect([...o.sharedCells.keys()]).toEqual(['2,0,0']);
      expect(o.sharedBlocks).toBe(1);
      expect(o.warnings.filter((w) => w.type === 'overlap')).toEqual([]);
    }
  });

  it('never shares the placeholder casing', () => {
    const ph = { ...PLACEHOLDER_DEF, size: [1, 1, 1], layers: [['c']] } as MultiblockDef;
    const o = analyzeOccupancy(s, [pg(0, ph, [0]), pg(1, ph, [0])]);
    expect(o.sharedCells.size).toBe(0);
    expect(o.warnings.filter((w) => w.type === 'overlap').length).toBe(1);
  });
});
