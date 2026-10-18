import { describe, expect, it } from 'vitest';
import { annealGroups, layoutCost } from './anneal';
import { optimizeSite } from './optimize';
import { createSiteBuilder, localFaces, localFootprints, localHeights } from './build';
import {
  AIR,
  FLUSH_NONE,
  NEVER,
  flushContact,
  groupFaces,
  groupLocal,
  sharable,
  sharedAcross,
  sharedPlanes,
} from './groupFaces';
import { groupPoint } from './group';
import type { Rotation, Vec3 } from '../core/types';
import type { SiteGroup, SiteState } from './types';

const EBF = 'electric-blast-furnace';
const FREEZER = 'vacuum-freezer';

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

/** Groups `a` and `b` linked by one item, so the annealer has a net to shorten. */
function linked(a: SiteGroup, b: SiteGroup, size: [number, number] = [40, 30]): SiteState {
  return {
    v: 1,
    kind: 'site',
    size,
    corridor: 2,
    groups: [a, b],
    links: [{ id: 'l', from: { group: a.id }, to: { group: b.id }, resource: 'r' }],
    ports: [],
    resources: { r: { kind: 'item', name: 'r', color: '#888888' } },
    colors: {},
  };
}

const build = (s: SiteState, opts = {}) => createSiteBuilder()(s, { pipes: false, cables: false, ...opts });
const overlaps = (b: ReturnType<typeof build>) => b.warnings.filter((w) => w.type === 'overlap');

/** What `annealGroups` is given for a site as it stands. */
function inputs(s: SiteState, built = build(s)) {
  const sizes = localFootprints(built);
  const heights = localHeights(built);
  return {
    sizeOf: (id: string) => sizes.get(id),
    opts: { heightOf: (id: string) => heights.get(id) ?? 1, faces: localFaces(built) },
  };
}

/** Whether the groups end up flush (one block of overlap) or apart, by their footprints in the result. */
function contact(s: SiteState, groups: SiteGroup[]): number {
  const sizes = localFootprints(build({ ...s, groups }));
  const [a, b] = groups.map((g) => {
    const [x, z] = sizes.get(g.id)!;
    return g.rotation % 2 === 0 ? { g, w: x, d: z } : { g, w: z, d: x };
  });
  return flushContact(a.g.origin[0], a.g.origin[1], a.w, a.d, b.g.origin[0], b.g.origin[1], b.w, b.d);
}

describe('faces of a group', () => {
  const ebf = () => {
    const s = linked(
      group('a', EBF, [3, 3], { enabledHatches: ['energy', 'maintenance', 'muffler'] }),
      group('b', EBF, [20, 3]),
    );
    return build(s).groups[0].build!;
  };

  it('are the four side planes of an EBF: casing everywhere, the controller as never, hatches not marked', () => {
    const b = ebf();
    expect(b.size).toEqual([3, 4, 3]);
    const f = groupFaces(b, 0);
    for (const face of [f.minX, f.maxX, f.minZ, f.maxZ]) {
      expect([face.len, face.h]).toEqual([3, 4]);
      expect(face.cells.every((c) => c !== undefined)).toBe(true);
    }
    // The controller is on the north face (min Z), in the middle, one up.
    expect(f.minZ.cells[1 * 4 + 0]).toBe(NEVER);
    expect(f.minZ.cells.filter((c) => c === NEVER)).toHaveLength(1);
    for (const face of [f.minX, f.maxX, f.maxZ]) expect(face.cells).not.toContain(NEVER);
    // The energy and maintenance hatches sit on that face's corners, but the face still names the casing.
    expect(b.hatches.some((h) => h.cell[2] === 0 && h.cell[1] === 0)).toBe(true);
    expect(f.minZ.cells[0]).toBe(f.maxZ.cells[0]);
    expect(f.minZ.cells[0]).not.toBe(NEVER);
  });

  it('turn with the group: a quarter turn takes the controller from the north face to the east', () => {
    const b = ebf();
    const f = groupFaces(b, 1);
    expect(f.maxX.cells.filter((c) => c === NEVER)).toHaveLength(1);
    expect(f.minZ.cells).not.toContain(NEVER);
    expect(groupFaces(b, 2).maxZ.cells.filter((c) => c === NEVER)).toHaveLength(1);
    expect(groupFaces(b, 3).minX.cells.filter((c) => c === NEVER)).toHaveLength(1);
  });

  it('follow the compatibility rule of the occupancy: air with air, equal blocks, never with nothing', () => {
    expect(sharable(AIR, AIR)).toBe(true);
    expect(sharable('x', 'x')).toBe(true);
    expect(sharable('x', 'y')).toBe(false);
    expect(sharable('x', AIR)).toBe(false);
    expect(sharable(NEVER, NEVER)).toBe(false);
    expect(sharable(NEVER, 'x')).toBe(false);
    const face = (cells: (string | undefined)[]) => ({ len: cells.length, h: 1, cells });
    // A gap is compatible with anything; shared cells are counted, a mismatch is -1.
    expect(sharedAcross(face(['x', undefined, 'x']), 0, 0, face(['x', 'y', undefined]), 0, 0)).toBe(1);
    expect(sharedAcross(face(['x', 'y']), 0, 0, face(['x', 'x']), 0, 0)).toBe(-1);
    // Offsets along the face and in height.
    expect(sharedAcross(face(['x', 'x']), 0, 0, face(['x', 'x']), 1, 0)).toBe(1);
    expect(sharedAcross(face(['x', 'x']), 0, 0, face(['x', 'x']), 0, 1)).toBe(0);
  });
});

describe('planes of two groups that touch by one block', () => {
  it('groupLocal undoes groupPoint for every turn of a box that is not square', () => {
    const size: Vec3 = [3, 4, 5];
    for (const r of [0, 1, 2, 3] as Rotation[])
      for (const p of [
        [0, 0, 0],
        [2, 3, 4],
        [1, 2, 3],
      ] as Vec3[])
        expect(groupLocal(groupPoint(p, size, r, [7, 9], 2), size, r, [7, 9], 2)).toEqual(p);
  });

  it('lists, for each group, the cells of the plane in its own local frame', () => {
    const box = {
      origin: [0, 0] as [number, number],
      elevation: 0,
      rotation: 0 as Rotation,
      size: [3, 4, 3] as Vec3,
      separate: false,
    };
    const [a, b] = sharedPlanes([box, { ...box, origin: [2, 1] }]);
    // The overlap is the column x = 2, z = 1..2, y = 0..3.
    expect(a).toHaveLength(8);
    expect(a.every((c) => c[0] === 2 && c[2] >= 1)).toBe(true);
    expect(b).toHaveLength(8);
    expect(b.every((c) => c[0] === 0 && c[2] <= 1)).toBe(true);
    // A group turned a quarter has the plane on another side of its own frame.
    const [, turned] = sharedPlanes([
      box,
      { ...box, origin: [2, 1], rotation: 1 as Rotation, size: [2, 4, 3] },
    ]);
    expect(turned).toHaveLength(8);
    expect(turned.every((c) => c[2] === 2 && c[0] <= 1)).toBe(true);
    // Apart, touching at a corner only, or never sharing: nothing.
    expect(sharedPlanes([box, { ...box, origin: [3, 0] }]).flat()).toEqual([]);
    expect(sharedPlanes([box, { ...box, origin: [2, 3] }]).flat()).toEqual([]);
    expect(sharedPlanes([box, { ...box, origin: [2, 1], separate: true }]).flat()).toEqual([]);
    expect(flushContact(0, 0, 3, 3, 2, 3, 3, 3)).toBe(FLUSH_NONE);
  });
});

describe('Optimize standing groups flush', () => {
  it('puts two EBF groups flush when that lowers the cost, with no overlap and the wall counted once', () => {
    const s = linked(group('a', EBF, [10, 10]), group('b', EBF, [16, 10]));
    const { sizeOf, opts } = inputs(s);
    const r = annealGroups(s, sizeOf, { seed: 1, iterations: 3000, ...opts });
    expect(r.improved).toBe(true);
    expect(contact(s, r.groups)).not.toBe(FLUSH_NONE);
    const b = build({ ...s, groups: r.groups });
    expect(overlaps(b)).toEqual([]);
    expect(b.stats.sharedBlocks).toBeGreaterThan(0);
    expect(b.scene.voxels.some((v) => v.conflict)).toBe(false);
    // Without the premium for a shared cell it still stands as close as the corridor lets it.
    const plain = annealGroups(s, sizeOf, { seed: 1, iterations: 3000, share: 0, ...opts });
    expect(r.after).toBeLessThanOrEqual(plain.after + 1e-9);
    expect(layoutCost(s, sizeOf).cost).toBeGreaterThan(r.after);
  });

  it('is the same for the same seed', () => {
    const s = linked(group('a', EBF, [10, 10]), group('b', EBF, [16, 10]));
    const { sizeOf, opts } = inputs(s);
    const run = () => annealGroups(s, sizeOf, { seed: 7, iterations: 2000, ...opts });
    expect(run()).toEqual(run());
  });

  it('never puts an EBF flush against a vacuum freezer: the casings differ', () => {
    const s = linked(group('a', EBF, [10, 10]), group('b', FREEZER, [18, 10]));
    const { sizeOf, opts } = inputs(s);
    for (const seed of [1, 2, 3]) {
      const r = annealGroups(s, sizeOf, { seed, iterations: 3000, share: 5, ...opts });
      expect(contact(s, r.groups)).toBe(FLUSH_NONE);
      expect(overlaps(build({ ...s, groups: r.groups }))).toEqual([]);
    }
  });

  it('never shares with a group set to separate', () => {
    const s = linked(group('a', EBF, [10, 10], { wallshare: 'separate' }), group('b', EBF, [16, 10]));
    const { sizeOf, opts } = inputs(s);
    for (const seed of [1, 2, 3]) {
      const r = annealGroups(s, sizeOf, { seed, iterations: 3000, share: 5, ...opts });
      expect(contact(s, r.groups)).toBe(FLUSH_NONE);
      expect(overlaps(build({ ...s, groups: r.groups }))).toEqual([]);
    }
    // And the occupancy calls such a placing a conflict, not a shared wall.
    const flush = build({ ...s, groups: [s.groups[0], { ...s.groups[1], origin: [12, 10] }] });
    expect(overlaps(flush)).toHaveLength(1);
    expect(flush.stats.sharedBlocks).toBe(0);
  });

  it('judges a flush start by the cells of the two walls, whatever the turns', () => {
    // A starts valid exactly when the real build calls the walls compatible: the controller faces decide.
    for (const ra of [0, 1, 2, 3] as Rotation[])
      for (const rb of [0, 1, 2, 3] as Rotation[]) {
        const s = linked(
          group('a', EBF, [10, 10], { rotation: ra }),
          group('b', EBF, [12, 10], { rotation: rb }),
        );
        const { sizeOf, opts } = inputs(s);
        const started = annealGroups(s, sizeOf, { seed: 1, iterations: 1, ...opts }).iterations;
        const b = build(s);
        expect(started > 0, `a ${ra} b ${rb}`).toBe(overlaps(b).length === 0);
        if (started > 0) expect(b.stats.sharedBlocks).toBeGreaterThan(0);
      }
  });
});

describe('hatches keep off a shared plane', () => {
  const extra = { enabledHatches: ['energy', 'maintenance', 'muffler'] as SiteGroup['enabledHatches'] };

  it('moves the energy hatch that would lean onto the wall two groups share', () => {
    const s = linked(group('a', EBF, [3, 3], extra), group('b', EBF, [5, 3]));
    const b = build(s);
    expect(overlaps(b)).toEqual([]);
    const a = b.groups[0];
    expect(a.hatches.length).toBeGreaterThan(0);
    // The shared wall is x = 5 on the site.
    expect(a.hatches.every((h) => h.cell[0] !== 5)).toBe(true);
    expect(b.groups[1].hatches.every((h) => h.cell[0] !== 5)).toBe(true);
    // The footprint is the one the group has alone.
    const alone = build({ ...s, groups: [s.groups[0], { ...s.groups[1], origin: [20, 3] }] });
    expect(b.groups[0].build!.size).toEqual(alone.groups[0].build!.size);
    // Pieces that do not touch are built as before.
    expect(alone.groups[0].hatches.some((h) => h.cell[0] === 5)).toBe(true);
  });
});

describe('walls and the annealer agree with the real build', () => {
  const IDS = [EBF, 'multi-smelter', 'oil-cracking-unit'];

  it('accepts a flush start only when the build has no overlap, and every shared build is accepted', () => {
    const rotations = [0, 1, 2, 3] as Rotation[];
    const footprints: [number, number][] = [];
    let checked = 0;
    let shared = 0;
    for (let ia = 0; ia < IDS.length; ia++)
      for (let ib = ia; ib < IDS.length; ib++)
        for (const ra of rotations)
          for (const rb of rotations)
            for (const mirror of [false, true])
              for (const elevation of [0, 1])
                for (const axis of ['x', 'z'] as const) {
                  const a = group('a', IDS[ia], [10, 10], { rotation: ra });
                  const b = group('b', IDS[ib], [40, 40], { rotation: rb, mirror, elevation });
                  const apart = linked(a, b, [80, 80]);
                  const [fx, fz] = (footprints[ia] ??= localFootprints(build(apart)).get('a')!);
                  const [w, d] = ra % 2 === 0 ? [fx, fz] : [fz, fx];
                  const flush = {
                    ...apart,
                    groups: [
                      a,
                      {
                        ...b,
                        origin: (axis === 'x' ? [10 + w - 1, 10] : [10, 10 + d - 1]) as [number, number],
                      },
                    ],
                  };
                  const built = build(flush);
                  const { sizeOf, opts } = inputs(flush, built);
                  const accepted =
                    annealGroups(flush, sizeOf, { seed: 1, iterations: 1, ...opts }).iterations > 0;
                  const clean = overlaps(built).length === 0;
                  const label = `${IDS[ia]} ${ra} + ${IDS[ib]} ${rb} mirror ${mirror} up ${elevation} ${axis}`;
                  // Sound: never accepts what overlaps. Complete: takes every start that saves blocks.
                  if (accepted) expect(clean, label).toBe(true);
                  if (clean && built.stats.sharedBlocks > 0) expect(accepted, label).toBe(true);
                  checked++;
                  if (accepted) shared++;
                }
    expect(checked).toBe(6 * 16 * 2 * 2 * 2);
    expect(shared).toBeGreaterThan(0);
  }, 20000);

  it('draws the same random numbers when no pair can share: same result as share 0 and no faces', () => {
    const s = linked(group('a', EBF, [10, 10]), group('b', FREEZER, [18, 10]));
    const { sizeOf, opts } = inputs(s);
    const withFaces = annealGroups(s, sizeOf, { seed: 5, iterations: 3000, ...opts });
    const plain = annealGroups(s, sizeOf, {
      seed: 5,
      iterations: 3000,
      share: 0,
      heightOf: opts.heightOf,
    });
    expect(JSON.stringify(withFaces)).toBe(JSON.stringify(plain));
  });

  it('Optimize never returns a layout with an overlap, even where the hatches could not leave the wall', () => {
    const a = group('a', 'multi-smelter', [30, 30], {
      count: 3,
      rotation: 1,
      enabledHatches: ['energy', 'maintenance', 'muffler'],
    });
    const b = group('b', 'multi-smelter', [24, 31], { count: 3 });
    const s = linked(a, b, [120, 120]);
    const builder = createSiteBuilder();
    const r = optimizeSite(s, builder, { seeds: 2, iterations: 2000, refineSteps: 30, refineRuns: 1 });
    const out = builder(r.site, { pipes: true, cables: true });
    expect(overlaps(out)).toEqual([]);
  }, 60000);
});
