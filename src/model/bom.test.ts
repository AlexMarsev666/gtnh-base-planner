import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import type { TextureManifest } from '../render/detailed';
import { blockLabel, matchesQuery, progress, requiredBlocks, sortBom, tickedLast, tileLabel } from './bom';
import { DEFAULT_HATCH_COLORS } from './colors';
import { buildSceneModel } from './scene';
import type { HatchKind, Unit } from './multiblock/types';
import type { HatchPlacement, WallStats } from './plan/types';
import type { SceneModel } from './render/types';
import type { RouteNet } from './routing/routeNet';

const coke = getMultiblock('coke-oven')!;

const stats: WallStats = {
  totalBlocks: 0,
  byBlock: {},
  controllers: 0,
  hatches: 0,
  sharedWalls: [],
  conflicts: [],
  conflictCells: [],
  savedBlocks: 0,
};

function scene(units: Unit[], hatches: HatchPlacement[] = [], pipes: RouteNet[] | null = null): SceneModel {
  return buildSceneModel(coke, units, hatches, stats, pipes, DEFAULT_HATCH_COLORS);
}

function net(kind: HatchKind, length: number): RouteNet {
  return { kind, paths: [], length, connected: 1, total: 1 };
}

const oven = (id: number, x: number): Unit => ({ id, origin: [x, 0, 0], rotation: 0 });
const count = (bom: ReturnType<typeof requiredBlocks>, id: string) =>
  bom.blocks.find((r) => r.blockId === id)?.count;

describe('requiredBlocks', () => {
  it('lists the controller first, then the casings, each with its count', () => {
    const bom = requiredBlocks(scene([oven(1, 0)]));
    expect(bom.blocks.map((r) => [r.blockId, r.count])).toEqual([
      ['gt.cokeOvenController', 1],
      ['gt.cokeOvenBrick', 25],
    ]);
    expect(bom.blocks[0].label).toBe('Coke Oven');
    expect(bom.totalBlocks).toBe(26);
    expect(bom.io).toEqual([]);
  });

  it('counts a wall two units share once, as the 3D model draws it', () => {
    const separate = requiredBlocks(scene([oven(1, 0), oven(2, 10)]));
    const shared = requiredBlocks(scene([oven(1, 0), oven(2, 2)]));
    expect(separate.totalBlocks).toBe(52);
    expect(shared.totalBlocks).toBeLessThan(52);
    expect(count(shared, 'gt.cokeOvenController')).toBe(2);
  });

  it('lists a hatch in place of the casing it replaces, as any tier', () => {
    const hatch: HatchPlacement = { kind: 'itemIn', cell: [0, 0, 0], face: 'west', unitIds: [1] };
    const bom = requiredBlocks(scene([oven(1, 0)], [hatch]));
    expect(count(bom, 'gt.cokeOvenBrick')).toBe(24);
    const row = bom.blocks.find((r) => r.blockId === coke.hatchBlocks.itemIn)!;
    expect(row).toMatchObject({ count: 1, hatchKind: 'itemIn', baseBlockId: 'gt.cokeOvenBrick' });
    expect(bom.totalBlocks).toBe(26);
  });

  it('marks buses and hatches any tier, but not casings or the maintenance hatch', () => {
    const s = scene([oven(1, 0)]);
    const mk = (blockId: string, hatchKind?: HatchKind): SceneModel['voxels'][number] => ({
      pos: [9, 9, 9 + s.voxels.length],
      blockId,
      kind: hatchKind ? 'hatch' : 'casing',
      hatchKind,
      unitIds: [1],
    });
    s.voxels.push(mk('gt.hatch.inputBus', 'itemIn'), mk('gt.hatch.maintenance', 'maintenance'));
    const bom = requiredBlocks(s);
    const tier = (id: string) => bom.blocks.find((r) => r.blockId === id)!.anyTier;
    expect(tier('gt.hatch.inputBus')).toBe(true);
    expect(tier('gt.hatch.maintenance')).toBe(false);
    expect(tier('gt.cokeOvenBrick')).toBe(false);
    // Hatches come after casings.
    expect(bom.blocks.at(-1)!.blockId).toBe('gt.hatch.maintenance');
  });

  it('lists single-block machines by their machine, any tier', () => {
    const s = scene([oven(1, 0)]);
    s.voxels.push(
      { pos: [20, 0, 0], blockId: 'site.machine.macerator', kind: 'controller', unitIds: [] },
      { pos: [22, 0, 0], blockId: 'site.machine.macerator', kind: 'controller', unitIds: [] },
    );
    const row = requiredBlocks(s).blocks.find((r) => r.blockId === 'site.machine.macerator')!;
    expect(row).toMatchObject({ label: 'Macerator', count: 2, anyTier: true });
  });

  it('leaves site ports out: they mark where a resource crosses the site edge', () => {
    const s = scene([oven(1, 0)]);
    s.voxels.push({ pos: [20, 0, 0], blockId: 'site.port.item', kind: 'controller', unitIds: [] });
    expect(requiredBlocks(s).blocks.some((r) => r.blockId.startsWith('site.port.'))).toBe(false);
  });

  it('has no IO while pipes and cables are off', () => {
    expect(requiredBlocks(scene([oven(1, 0)], [], null)).io).toEqual([]);
  });

  it('sums pipes and cables by class and drops classes with none', () => {
    const pipes = [
      net('itemIn', 5),
      net('itemOut', 7),
      net('fluidIn', 3),
      net('steamIn', 0),
      net('energy', 4),
      net('dynamo', 2),
    ];
    const bom = requiredBlocks(scene([oven(1, 0)], [], pipes));
    expect(bom.io.map((r) => [r.io, r.count])).toEqual([
      ['item', 12],
      ['fluid', 3],
      ['energy', 6],
    ]);
    // Pipes are not blocks of the build.
    expect(bom.totalBlocks).toBe(26);
  });

  it('counts a ticked row as all of its blocks in progress', () => {
    const bom = requiredBlocks(scene([oven(1, 0)], [], [net('fluidIn', 4)]));
    expect(progress(bom, new Set())).toEqual({ done: 0, total: 30 });
    expect(progress(bom, new Set(['block:gt.cokeOvenBrick', 'io:fluid']))).toEqual({ done: 29, total: 30 });
    // A key that no row has (a block from another build) counts for nothing.
    expect(progress(bom, new Set(['block:nope']))).toEqual({ done: 0, total: 30 });
  });
});

describe('block names', () => {
  const manifest = {
    atlas: { path: '', width: 0, height: 0, tile: 16 },
    tiles: {},
    blocks: {
      'mod:raw@0': { side: 'DUMP_BLOCK_COPPER' },
      'mod:sheet@1': { side: 'DUMP_MACHINE_CASING_STABLE_TITANIUM__OVERLAY_FRONT_ORE_DRILL' },
    },
    hatchOverlays: {},
  } as unknown as TextureManifest;

  it('keeps a catalog name that reads well', () => {
    expect(blockLabel('gt.casing.heatProof', manifest)).toBe('Heat Proof Machine Casing');
  });

  it('names a block that only has its raw id after its texture', () => {
    expect(blockLabel('mod:raw@0', manifest)).toBe('Copper Block');
    expect(blockLabel('mod:sheet@1', manifest)).toBe('Stable Titanium');
  });

  it('falls back to the registry name when there is no texture', () => {
    expect(blockLabel('somemod:tile.SomeBlock@2', manifest)).toBe('Tile Someblock');
  });

  it('turns tile names into words', () => {
    expect(tileLabel('DUMP_BLOCK_ZINC')).toBe('Zinc Block');
    expect(tileLabel('DUMP_CASING_ANTENNA_T1')).toBe('Casing Antenna T1');
    expect(tileLabel('DUMP_PRIMITIVE_WOODEN_CASING_TOP')).toBe('Primitive Wooden Casing');
    expect(tileLabel('DUMP_BLOCK_CASING_C8C8C8')).toBe('Casing Block');
    expect(tileLabel('DUMP_COMP_ASSLINE_CASING_0')).toBe('Comp Assline Casing');
    expect(tileLabel('DUMP_MACHINE_CASING_PIPE_PTFE')).toBe('Pipe PTFE');
  });
});

describe('sortBom', () => {
  const bom = requiredBlocks(
    scene(
      [oven(1, 0)],
      [{ kind: 'itemIn', cell: [0, 0, 0], face: 'west', unitIds: [1] }],
      [net('energy', 9), net('fluidIn', 2), net('itemIn', 5)],
    ),
  );
  const counts = (rows: { count: number }[]) => rows.map((r) => r.count);

  it('keeps the grouped order (controller, casings, hatches) by default', () => {
    expect(sortBom(bom, 'grouped')).toBe(bom);
    expect(counts(bom.blocks)).toEqual([1, 24, 1]);
  });

  it('puts the largest amounts first, or the smallest', () => {
    expect(counts(sortBom(bom, 'most').blocks)).toEqual([24, 1, 1]);
    expect(counts(sortBom(bom, 'fewest').blocks)).toEqual([1, 1, 24]);
    expect(counts(sortBom(bom, 'most').io)).toEqual([9, 5, 2]);
    expect(counts(sortBom(bom, 'fewest').io)).toEqual([2, 5, 9]);
  });

  it('breaks ties in the grouped order and leaves its input alone', () => {
    const sorted = sortBom(bom, 'most');
    expect(sorted.blocks.slice(1).map((r) => r.blockId)).toEqual([
      bom.blocks[0].blockId,
      bom.blocks[2].blockId,
    ]);
    expect(counts(bom.blocks)).toEqual([1, 24, 1]);
    expect(sorted.totalBlocks).toBe(bom.totalBlocks);
  });
});

describe('matchesQuery', () => {
  it('needs every word, in any order, ignoring case', () => {
    expect(matchesQuery('Heat Proof Machine Casing', 'casing heat')).toBe(true);
    expect(matchesQuery('Heat Proof Machine Casing', 'PROOF')).toBe(true);
    expect(matchesQuery('Heat Proof Machine Casing', 'heat coil')).toBe(false);
  });

  it('matches everything for an empty or blank query', () => {
    expect(matchesQuery('Anything', '')).toBe(true);
    expect(matchesQuery('Anything', '   ')).toBe(true);
  });
});

describe('tickedLast', () => {
  const rows = ['a', 'b', 'c', 'd'].map((key) => ({ key }));

  it('moves ticked rows to the end and keeps the order within each group', () => {
    expect(tickedLast(rows, new Set(['a', 'c'])).map((r) => r.key)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('changes nothing when nothing is ticked, and does not touch its input', () => {
    expect(tickedLast(rows, new Set()).map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
    tickedLast(rows, new Set(['a']));
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('requiredBlocks with tiers', () => {
  const ebf = getMultiblock('electric-blast-furnace')!;
  const at = (kind: HatchKind, x: number): HatchPlacement => ({
    kind,
    cell: [x, 0, 0],
    face: 'north',
    unitIds: [1],
  });
  const hatches = [
    at('energy', 0),
    at('energy', 1),
    at('itemIn', 2),
    at('itemIn', 3),
    at('itemIn', 4),
    at('maintenance', 5),
  ];
  const ebfScene = () => buildSceneModel(ebf, [oven(1, 0)], hatches, stats, null, DEFAULT_HATCH_COLORS);
  const rows = (bom: ReturnType<typeof requiredBlocks>) =>
    bom.blocks.filter((r) => r.hatchKind).map((r) => [r.label, r.count]);

  it('is unchanged without tier information', () => {
    const s = ebfScene();
    const plain = requiredBlocks(s);
    expect(requiredBlocks(s, undefined, {})).toEqual(plain);
    expect(requiredBlocks(s, undefined, { hatchTiers: { 'muffler:0': 'HV' } }).blocks).toEqual(plain.blocks);
    expect(plain.blocks.every((r) => r.tier === undefined)).toBe(true);
    expect(rows(plain)).toEqual([
      ['Input Bus', 3],
      ['Energy Hatch', 2],
      ['Maintenance Hatch', 1],
    ]);
  });

  it('gives the energy hatches the machine tier and leaves the other hatches as any tier', () => {
    const bom = requiredBlocks(ebfScene(), undefined, { machineTier: 'EV' });
    expect(rows(bom)).toEqual([
      ['Input Bus', 3],
      ['Energy Hatch (EV)', 2],
      ['Maintenance Hatch', 1],
    ]);
    const energy = bom.blocks.find((r) => r.tier === 'EV')!;
    expect(energy).toMatchObject({ anyTier: false, key: 'block:gt.hatch.energy@EV' });
    expect(bom.totalBlocks).toBe(requiredBlocks(ebfScene()).totalBlocks);
  });

  it('never lists a MAX energy hatch', () => {
    const bom = requiredBlocks(ebfScene(), undefined, { machineTier: 'MAX' });
    expect(rows(bom)).toContainEqual(['Energy Hatch (UXV)', 2]);
  });

  it('splits rows by tier when single hatches have their own', () => {
    const bom = requiredBlocks(ebfScene(), undefined, {
      machineTier: 'HV',
      hatchTiers: {
        'itemIn:0': 'HV',
        'itemIn:1': 'HV',
        'itemIn:2': 'LV',
        'energy:1': 'IV',
        'maintenance:0': 'EV',
      },
    });
    expect(rows(bom)).toEqual([
      ['Input Bus (HV)', 2],
      ['Energy Hatch (HV)', 1],
      ['Energy Hatch (IV)', 1],
      ['Input Bus (LV)', 1],
      ['Maintenance Hatch', 1],
    ]);
  });

  it('reads hatch keys from a parallel list or a function', () => {
    const keys = ['energy:a', 'energy:b', 'itemIn:r:0', 'itemIn:r:0', 'itemIn:r:shared', 'maintenance:0'];
    const hatchTiers = { 'energy:b': 'ZPM', 'itemIn:r:0': 'MV' } as const;
    const a = requiredBlocks(ebfScene(), undefined, { hatchKeys: keys, hatchTiers, machineTier: 'LV' });
    const b = requiredBlocks(ebfScene(), undefined, {
      keyOf: (_h, i) => keys[i],
      hatchTiers,
      machineTier: 'LV',
    });
    expect(b).toEqual(a);
    expect(rows(a)).toEqual([
      ['Input Bus (MV)', 2],
      ['Energy Hatch (LV)', 1],
      ['Energy Hatch (ZPM)', 1],
      ['Input Bus', 1],
      ['Maintenance Hatch', 1],
    ]);
  });
});
