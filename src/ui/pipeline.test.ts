import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { getMultiblock } from '../data/catalog';
import type { Unit } from '../model/multiblock/types';
import type { WallStats } from '../model/plan/types';
import type { SceneModel } from '../model/render/types';
import type { RouteNet } from '../model/routing/routeNet';
import type { AppMode } from '../share/sitePersist';
import { connectBelow, defaultPlan, plan } from '../state/store';
import { catalog } from '../data/catalog';
import { dominantBlockId, hatchKindsOf, iconFaces, matchesQuery, shade } from './catalogView';
import { createBuildStore, createPipeline, type PipelineDeps } from './pipeline';
import { statsParts } from './statsText';

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

const stats: WallStats = {
  totalBlocks: 40,
  byBlock: {},
  controllers: 2,
  hatches: 3,
  sharedWalls: [[0, 1]],
  conflicts: [],
  conflictCells: [],
  savedBlocks: 9,
};

function fakeDeps() {
  const deps = {
    getMultiblock,
    packUnits: vi.fn((_d, count: number) => ({
      units: Array.from({ length: Math.min(count, 2) }, (_, i) => ({
        id: i,
        origin: [i * 2, 0, 0] as const,
        rotation: 0 as const,
      })),
      requested: count,
      placed: Math.min(count, 2),
      reason: count > 2 ? ('limits' as const) : undefined,
    })),
    placeHatches: vi.fn(() => ({ hatches: [], unplaced: [] })),
    layoutCandidates: vi.fn(function* () {}),
    loosenings: vi.fn(function* (..._args: Parameters<PipelineDeps['loosenings']>): Generator<Unit[]> {}),
    computeWallStats: vi.fn(() => stats),
    routePipes: vi.fn((..._args: Parameters<PipelineDeps['routePipes']>): RouteNet[] => []),
    buildSceneModel: vi.fn((..._args: Parameters<PipelineDeps['buildSceneModel']>): SceneModel => ({
      voxels: [],
      hatches: [],
      pipes: null,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      colors: {} as SceneModel['colors'],
    })),
  } satisfies PipelineDeps;
  return deps;
}

describe('pipeline', () => {
  it('recomputes only the stages whose inputs changed', () => {
    const deps = fakeDeps();
    const run = createPipeline(deps);
    const p = defaultPlan();
    const r1 = run(p, false);
    expect(r1.error).toBeNull();
    expect(r1.scene).not.toBeNull();
    expect(deps.packUnits).toHaveBeenCalledTimes(1);

    // Same inputs (new object): nothing recomputed, same result.
    expect(run({ ...p }, false)).toBe(r1);

    // Colour change: only the scene.
    run({ ...p, colors: { itemIn: '#000000' } }, false);
    expect(deps.packUnits).toHaveBeenCalledTimes(1);
    expect(deps.placeHatches).toHaveBeenCalledTimes(1);
    expect(deps.buildSceneModel).toHaveBeenCalledTimes(2);
    expect(deps.buildSceneModel.mock.calls[1]?.[5].itemIn).toBe('#000000');

    // Pipes on: routing + scene, no re-pack.
    run({ ...p, colors: { itemIn: '#000000' } }, true);
    expect(deps.routePipes).toHaveBeenCalledTimes(1);
    expect(deps.packUnits).toHaveBeenCalledTimes(1);

    // Cables on too: routing again with both pipe and cable kinds, still no re-pack.
    run({ ...p, colors: { itemIn: '#000000' } }, true, true);
    expect(deps.routePipes).toHaveBeenCalledTimes(2);
    expect(deps.routePipes.mock.calls[1]?.[3]?.kinds).toContain('energy');
    expect(deps.packUnits).toHaveBeenCalledTimes(1);

    // Count change: everything.
    const r2 = run({ ...p, count: 5 }, true);
    expect(deps.packUnits).toHaveBeenCalledTimes(2);
    expect(r2.pack?.reason).toBe('limits');
  });

  it('recomputes each stage exactly when one of its inputs changes', () => {
    const deps = fakeDeps();
    const run = createPipeline(deps);
    const p = defaultPlan();
    const calls = () => [
      deps.packUnits.mock.calls.length,
      deps.placeHatches.mock.calls.length,
      deps.routePipes.mock.calls.length,
      deps.buildSceneModel.mock.calls.length,
    ];
    run(p, false);
    let before = calls();
    const step = (next: Parameters<typeof run>, changed: [boolean, boolean, boolean, boolean]) => {
      run(...next);
      const now = calls();
      expect(now.map((n, i) => n > before[i])).toEqual(changed);
      before = now;
    };
    // [pack, hatches, pipes, scene]
    step([{ ...p, colors: { itemIn: '#000000' } }, false], [false, false, false, true]);
    step([{ ...p, limits: { ...p.limits, x: 3 } }, false], [true, true, false, true]);
    step([{ ...p, limits: { ...p.limits, x: 3 }, enabledHatches: [] }, false], [false, true, false, true]);
    step([{ ...p, limits: { ...p.limits, x: 3 }, enabledHatches: [] }, true], [false, true, true, true]);
    step([{ ...p, limits: { ...p.limits, x: 3 }, enabledHatches: [] }, false], [false, true, false, true]);
    step(
      [{ ...p, limits: { ...p.limits, x: 3 }, enabledHatches: [] }, false, false, true],
      [false, true, false, true],
    );
  });

  it('loosens the layout when pipes cannot reach every hatch, and routes it once', () => {
    const deps = fakeDeps();
    const wide: Unit[] = [{ id: 0, origin: [0, 0, 0], rotation: 0 }];
    deps.loosenings.mockImplementation(function* () {
      yield wide;
    });
    deps.routePipes.mockImplementation((_d, units) => [
      { kind: 'itemIn', paths: [], length: 0, connected: units === wide ? 1 : 0, total: 1 },
    ]);
    const run = createPipeline(deps);
    const off = run(defaultPlan(), false);
    expect(off.loosened).toBe(false);
    const on = run(defaultPlan(), true);
    expect(on.loosened).toBe(true);
    expect(on.pack?.units).toBe(wide);
    expect(on.pipes?.[0].connected).toBe(1);
    // The base layout and the loosened one: the pipes stage reuses the second result.
    expect(deps.routePipes).toHaveBeenCalledTimes(2);
  });

  it('uses manual units instead of packing', () => {
    const deps = fakeDeps();
    const run = createPipeline(deps);
    const manual = [{ id: 7, origin: [0, 0, 0] as const, rotation: 1 as const }];
    const r = run({ ...defaultPlan(), manualUnits: manual }, false);
    expect(deps.packUnits).not.toHaveBeenCalled();
    expect(r.pack).toEqual({ units: manual, requested: 1, placed: 1 });
  });

  it('turns a throwing stage into an error result and caches it', () => {
    const deps = fakeDeps();
    deps.placeHatches.mockImplementation(() => {
      throw new Error('placeHatches: not implemented');
    });
    const run = createPipeline(deps);
    const p = defaultPlan();
    const r = run(p, false);
    expect(r.error).toBe('placeHatches: not implemented');
    expect(r.scene).toBeNull();
    expect(r.pack?.placed).toBe(2);
    run({ ...p }, false);
    expect(deps.placeHatches).toHaveBeenCalledTimes(1);
  });

  it('still builds the scene when routing fails', () => {
    const deps = fakeDeps();
    deps.routePipes.mockImplementation(() => {
      throw new Error('boom');
    });
    const r = createPipeline(deps)(defaultPlan(), true);
    expect(r.scene).not.toBeNull();
    expect(r.pipes).toBeNull();
    expect(r.error).toBe('boom');
    // The routed-layout fallback reports the error instead of hiding it.
    expect(warn).toHaveBeenCalledWith('resolveRoutedLayout: boom');
  });

  it('reports an unknown multiblock', () => {
    const r = createPipeline(fakeDeps())({ ...defaultPlan(), multiblockId: 'nope' }, false);
    expect(r.error).toMatch(/nope/);
  });
});

describe('stats line', () => {
  it('lists units, blocks, walls, hatches, saved and the selection', () => {
    const r = createPipeline(fakeDeps())(defaultPlan(), false);
    const parts = statsParts(r, [1]);
    expect(parts.main).toEqual(['2 units', '40 blocks', '1 shared wall', '3 hatches', '9 saved']);
    expect(parts.selected).toBe('Unit 2');
    expect(statsParts(r, []).selected).toBeNull();
    expect(statsParts(r, [0, 1]).selected).toBe('Units 1, 2');
  });
});

describe('catalog view', () => {
  const coke = getMultiblock('coke-oven')!;
  it('finds the dominant block and hatch kinds', () => {
    expect(dominantBlockId(coke)).toBe('gt.cokeOvenBrick');
    expect(hatchKindsOf(coke)).toEqual(['itemIn', 'itemOut', 'fluidOut']);
  });
  it('textures picker icons with the casing and controller front', () => {
    const faces = iconFaces(coke);
    expect(faces.top.tiles).toEqual(['COKE_OVEN_CASING']);
    expect(faces.left.tiles).toEqual(['COKE_OVEN_CASING', 'COKE_OVEN_OVERLAY_INACTIVE']);
    expect(faces.right.tiles).toEqual(['COKE_OVEN_CASING']);
    // Hand-made entries are all textured; a generated one may use an untextured (flat) casing.
    expect(catalog.filter((d) => !d.generated).every((d) => iconFaces(d).left.tiles.length === 2)).toBe(true);
    expect(catalog.every((d) => [0, 2].includes(iconFaces(d).left.tiles.length))).toBe(true);
    const bare = iconFaces(coke, {
      atlas: { path: '', width: 0, height: 0, tile: 16 },
      tiles: {},
      blocks: {},
      hatchOverlays: {},
    });
    expect(bare.left).toEqual({ tiles: [], color: expect.stringMatching(/^#/) });
  });
  it('shades colours', () => {
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#ffffff', 2)).toBe('#ffffff');
    expect(shade('bad', 2)).toBe('bad');
  });
  it('filters by name and tier', () => {
    expect(matchesQuery(coke, 'coke')).toBe(true);
    expect(matchesQuery(coke, 'steam')).toBe(true);
    expect(matchesQuery(coke, 'zzz')).toBe(false);
    expect(catalog.every((d) => matchesQuery(d, ''))).toBe(true);
  });
});

describe('build store', () => {
  it('computes nothing while the template view is shown, and catches up on return', () => {
    const deps = fakeDeps();
    const mode = writable<AppMode>('machine');
    const store = createBuildStore(createPipeline(deps), mode);
    const stop = store.subscribe(() => {});
    const before = deps.packUnits.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    mode.set('site');
    plan.update((p) => ({ ...p, count: p.count + 1 }));
    connectBelow.update((b) => !b);
    expect(deps.packUnits).toHaveBeenCalledTimes(before);
    expect(deps.placeHatches).toHaveBeenCalledTimes(before);

    mode.set('machine');
    expect(deps.packUnits.mock.calls.length).toBeGreaterThan(before);
    expect(get(store).pack?.requested).toBe(get(plan).count);
    stop();
  });

  it('has an empty result before the machine view was ever built', () => {
    const deps = fakeDeps();
    const store = createBuildStore(createPipeline(deps), writable<AppMode>('site'));
    expect(get(store).scene).toBeNull();
    expect(get(store).error).toBeNull();
    expect(deps.packUnits).not.toHaveBeenCalled();
  });
});
