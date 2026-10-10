import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { controllerFacing, key, step, unitBounds, unitCells } from './geometry';
import { layoutCandidates, packUnits } from './layout/packer';
import { loosenings } from './layout/variants';
import type { Vec3 } from './core/types';
import type { MultiblockDef, PlanLimits, Unit } from './multiblock/types';

const coke = getMultiblock('coke-oven')!;
const NO_LIMITS: PlanLimits = { x: null, y: null, z: null };

/** Solid box of casing with the controller in the middle of the north face and air in the centre. */
function boxDef(size: Vec3, opts: Partial<MultiblockDef> & { controllerPos?: Vec3 } = {}): MultiblockDef {
  const [sx, sy, sz] = size;
  const ctrl: Vec3 = opts.controllerPos ?? [Math.floor(sx / 2), Math.floor(sy / 2), 0];
  const layers: string[][] = [];
  for (let y = 0; y < sy; y++) {
    const rows: string[] = [];
    for (let z = 0; z < sz; z++) {
      let row = '';
      for (let x = 0; x < sx; x++) {
        const interior = x > 0 && x < sx - 1 && y > 0 && y < sy - 1 && z > 0 && z < sz - 1;
        if (x === ctrl[0] && y === ctrl[1] && z === ctrl[2]) row += '~';
        else if (interior) row += '-';
        else row += 'C';
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  const { controllerPos: _ignored, ...rest } = opts;
  void _ignored;
  return {
    id: `box-${sx}x${sy}x${sz}`,
    name: `Box ${sx}x${sy}x${sz}`,
    size,
    layers,
    legend: { C: { blockId: 'gt.casing.test', hatches: ['itemIn'] } },
    controller: { pos: ctrl, facing: 'north', blockId: 'gt.controller.test' },
    hatchBlocks: { itemIn: 'gt.hatch.test' },
    shareableHatches: [],
    defaultHatches: ['itemIn'],
    wallshare: true,
    ...rest,
  };
}

/** Independent validation of a placement; returns a list of problems (empty = valid). */
function problems(def: MultiblockDef, units: Unit[]): string[] {
  const out: string[] = [];
  const occ = new Map<string, { unit: number; role: string; blockId?: string }[]>();
  for (const u of units)
    for (const c of unitCells(def, u)) {
      const k = key(c.pos);
      const list = occ.get(k) ?? [];
      list.push({ unit: u.id, role: c.role, blockId: c.blockId });
      occ.set(k, list);
    }
  for (const [k, list] of occ) {
    if (list.length < 2) continue;
    if (!def.wallshare) out.push(`overlap at ${k} on a non-wallshare def`);
    for (const c of list) {
      if (c.role !== 'casing') out.push(`${c.role} of unit ${c.unit} overlaps at ${k}`);
      if (c.blockId !== list[0].blockId) out.push(`mismatched blocks at ${k}`);
    }
  }
  for (const u of units) {
    const ctrl = unitCells(def, u).find((c) => c.role === 'controller')!;
    const front = key(step(ctrl.pos, controllerFacing(def, u)));
    const blockers = (occ.get(front) ?? []).filter((c) => c.role !== 'air');
    if (blockers.length) out.push(`controller of unit ${u.id} is blocked at ${front}`);
  }
  return out;
}

/** Units along each axis: distinct origin coordinates (layouts are lattices). */
function perAxis(units: Unit[]): Vec3 {
  const n = (a: number) => new Set(units.map((u) => u.origin[a])).size;
  return [n(0), n(1), n(2)];
}

function footprint(def: MultiblockDef, units: Unit[]): Vec3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const u of units) {
    const b = unitBounds(def, u);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Unit pairs whose bounding boxes overlap in a full face slab (wall-sharing neighbours). */
function sharedFaces(def: MultiblockDef, units: Unit[]): number {
  let n = 0;
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const a = unitBounds(def, units[i]);
      const b = unitBounds(def, units[j]);
      const overlap = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
      const sizeA = [0, 1, 2].map((k) => a.max[k] - a.min[k]);
      if (overlap.filter((v, k) => v === sizeA[k]).length === 2 && overlap.some((v) => v === 1)) n++;
    }
  return n;
}

describe('packUnits', () => {
  it('places a single unit at the origin', () => {
    const r = packUnits(coke, 1, NO_LIMITS);
    expect(r).toMatchObject({ requested: 1, placed: 1 });
    expect(r.reason).toBeUndefined();
    expect(r.units).toHaveLength(1);
    expect(r.units[0].id).toBe(0);
    expect(r.units[0].origin).toEqual([0, 0, 0]);
  });

  it('returns nothing for a zero or invalid count', () => {
    expect(packUnits(coke, 0, NO_LIMITS)).toEqual({ units: [], requested: 0, placed: 0 });
    expect(packUnits(coke, -3, NO_LIMITS).placed).toBe(0);
    expect(packUnits(coke, Number.NaN, NO_LIMITS).placed).toBe(0);
  });

  it.each([1, 2, 3, 4, 5, 7, 12, 24, 37, 60])('packs %i coke ovens validly', (n) => {
    const r = packUnits(coke, n, NO_LIMITS);
    expect(r.placed).toBe(n);
    expect(r.requested).toBe(n);
    expect(r.reason).toBeUndefined();
    expect(r.units.map((u) => u.id)).toEqual([...Array(n).keys()]);
    expect(problems(coke, r.units)).toEqual([]);
    // Wall sharing is actually used: every unit touches another one.
    if (n > 1) expect(sharedFaces(coke, r.units)).toBeGreaterThanOrEqual(n - 1);
  });

  it('puts 4 coke ovens in a 2x2 block of back-to-back pairs', () => {
    const r = packUnits(coke, 4, NO_LIMITS);
    expect(sharedFaces(coke, r.units)).toBe(4);
    const facings = new Set(r.units.map((u) => controllerFacing(coke, u)));
    expect(facings.size).toBe(2);
  });

  it('prefers more shared faces, then lower height', () => {
    const two = packUnits(coke, 2, NO_LIMITS);
    expect(footprint(coke, two.units)[1]).toBe(3);
    const r = packUnits(coke, 8, NO_LIMITS);
    // 2 x 2 x 2 cube: 12 shared faces.
    expect(sharedFaces(coke, r.units)).toBe(12);
    expect(footprint(coke, r.units)).toEqual([5, 5, 5]);
  });

  it('respects limits (units per axis) and reports when fewer fit', () => {
    const limits: PlanLimits = { x: 5, y: 1, z: null };
    const r = packUnits(coke, 10, limits);
    expect(r.placed).toBe(10);
    const c = perAxis(r.units);
    expect(c[0]).toBeLessThanOrEqual(5);
    expect(c[1]).toBe(1);
    expect(problems(coke, r.units)).toEqual([]);

    const tight = packUnits(coke, 4, { x: 1, y: 1, z: 1 });
    expect(tight).toMatchObject({ requested: 4, placed: 1, reason: 'limits' });

    const none = packUnits(coke, 4, { x: 0, y: null, z: null });
    expect(none).toMatchObject({ requested: 4, placed: 0, reason: 'limits' });
    expect(none.units).toEqual([]);
  });

  it('places the maximum that fits the limits', () => {
    // Three along X, one layer, two back to back along Z = 6.
    const r = packUnits(coke, 60, { x: 3, y: 1, z: 2 });
    expect(r).toMatchObject({ requested: 60, placed: 6, reason: 'limits' });
    expect(problems(coke, r.units)).toEqual([]);
    expect(perAxis(r.units)).toEqual([3, 1, 2]);
  });

  it('adds walkways between back-to-back pairs to fill a limited area', () => {
    // 9 along X, 4 layers and 6 rows: only 2 rows can share a back wall, so pairs get walkways.
    const r = packUnits(coke, 400, { x: 9, y: 4, z: 6 });
    expect(r.placed).toBe(9 * 4 * 6);
    expect(r.reason).toBe('limits');
    expect(problems(coke, r.units)).toEqual([]);
    expect(perAxis(r.units)).toEqual([9, 4, 6]);
    // Every controller still faces open air: a walkway or the outside.
    const facings = new Set(r.units.map((u) => controllerFacing(coke, u)));
    expect(facings.size).toBe(2);
  });

  it('lays out rows of five with a walkway when length, layers and rows are limited', () => {
    // 15 Pyrolyse Ovens, at most 5 along X, one layer, 3 rows: 5 / 5 / 5.
    const def = getMultiblock('pyrolyse-oven')!;
    const r = packUnits(def, 15, { x: 5, y: 1, z: 3 });
    expect(r.placed).toBe(15);
    expect(problems(def, r.units)).toEqual([]);
    const rows = new Map<number, Unit[]>();
    for (const u of r.units) rows.set(u.origin[2], [...(rows.get(u.origin[2]) ?? []), u]);
    expect([...rows.values()].map((row) => row.length)).toEqual([5, 5, 5]);
    // Rows 1 and 2 share their back wall; rows 2 and 3 face each other across a walkway.
    expect([...rows.values()].map((row) => controllerFacing(def, row[0]))).toEqual([
      'north',
      'south',
      'north',
    ]);
  });

  it('keeps every layout inside random limits', () => {
    for (const [x, y, z, n] of [
      [4, 2, 4, 24],
      [1, 9, 5, 30],
      [15, 1, 2, 20],
      [7, 3, 7, 60],
      [5, 1, 3, 15],
    ]) {
      const r = packUnits(coke, n, { x, y, z });
      const c = perAxis(r.units);
      expect(c[0]).toBeLessThanOrEqual(x);
      expect(c[1]).toBeLessThanOrEqual(y);
      expect(c[2]).toBeLessThanOrEqual(z);
      expect(problems(coke, r.units)).toEqual([]);
      if (r.placed < n) expect(r.reason).toBe('limits');
    }
  });

  it('works for other box sizes', () => {
    for (const size of [
      [3, 4, 3],
      [5, 5, 5],
      [3, 2, 5],
      [7, 3, 4],
    ] as Vec3[]) {
      const def = boxDef(size);
      for (const n of [1, 4, 24, 60]) {
        const r = packUnits(def, n, NO_LIMITS);
        expect(r.placed).toBe(n);
        expect(problems(def, r.units)).toEqual([]);
      }
    }
  });

  it('avoids putting a corner controller on a shared face', () => {
    const def = boxDef([3, 3, 3], { controllerPos: [0, 1, 0] });
    for (const n of [2, 4, 9, 24]) {
      const r = packUnits(def, n, NO_LIMITS);
      expect(r.placed).toBe(n);
      expect(problems(def, r.units)).toEqual([]);
    }
  });

  it('never overlaps units of a non-wallshare def', () => {
    const def = boxDef([3, 3, 3], { wallshare: false });
    for (const n of [2, 4, 24]) {
      const r = packUnits(def, n, NO_LIMITS);
      expect(r.placed).toBe(n);
      expect(problems(def, r.units)).toEqual([]);
    }
    // Neighbours touch without gaps: two units side by side span exactly 6 blocks.
    const pair = footprint(def, packUnits(def, 2, NO_LIMITS).units);
    expect(pair[0] * pair[1] * pair[2]).toBe(2 * 27);
    const r = packUnits(def, 4, { x: 2, y: 1, z: 2 });
    expect(r.placed).toBe(4);
    expect(footprint(def, r.units)).toEqual([6, 3, 6]);
  });

  it('does not share walls made of different blocks', () => {
    const def = boxDef([3, 3, 3]);
    // East wall (x = 2) uses a different block than the west wall (x = 0).
    const layers = def.layers.map((rows) =>
      rows.map((row) => row.slice(0, 2) + (row[2] === 'C' ? 'D' : row[2])),
    );
    const mixed: MultiblockDef = {
      ...def,
      layers,
      legend: { ...def.legend, D: { blockId: 'gt.casing.other' } },
    };
    const r = packUnits(mixed, 6, NO_LIMITS);
    expect(r.placed).toBe(6);
    expect(problems(mixed, r.units)).toEqual([]);
  });

  it('is deterministic and does not leak cached objects', () => {
    const a = packUnits(coke, 24, NO_LIMITS);
    (a.units[0].origin as unknown as number[])[0] = 999;
    const b = packUnits(coke, 24, NO_LIMITS);
    const fresh = packUnits({ ...coke }, 24, NO_LIMITS);
    expect(b.units[0].origin[0]).not.toBe(999);
    expect(b).toEqual(fresh);
  });

  it('is fast for 60 units', () => {
    // Best of three cold runs (fresh defs, so no cache): other test files run in parallel.
    for (const make of [() => ({ ...coke }), () => boxDef([5, 5, 5]), () => boxDef([3, 4, 3])]) {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const def = make();
        const t = performance.now();
        const r = packUnits(def, 60, NO_LIMITS);
        const limited = packUnits(def, 60, { x: 20, y: 10, z: 20 });
        best = Math.min(best, performance.now() - t);
        expect(r.placed).toBe(60);
        expect(limited.placed).toBeGreaterThan(0);
      }
      if (process.env.PERF) expect(best).toBeLessThan(50);
    }
  });
});

describe('loosenings', () => {
  const volume = (def: MultiblockDef, units: Unit[]) => footprint(def, units).reduce((a, b) => a * b, 1);

  it('keeps the arrangement and opens walkways and gaps, most compact first', () => {
    const def = getMultiblock('implosion-compressor')!;
    const limits: PlanLimits = { x: 6, y: null, z: 6 };
    const base = packUnits(def, 100, limits).units;
    const looser = [...loosenings(def, base)];
    expect(looser.length).toBeGreaterThan(3);
    const seen = new Set([JSON.stringify(base)]);
    let last = volume(def, base);
    for (const units of looser) {
      expect(units).toHaveLength(100);
      expect(problems(def, units)).toEqual([]);
      expect(perAxis(units)).toEqual(perAxis(base));
      const v = volume(def, units);
      expect(v).toBeGreaterThan(volume(def, base));
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
      const k = JSON.stringify(units);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    // The loosest one leaves two blocks between all units along X and Z.
    const gaps = (a: 0 | 2) => {
      const xs = [...new Set(looser[looser.length - 1].map((u) => u.origin[a]))].sort((p, q) => p - q);
      return new Set(xs.slice(1).map((x, i) => x - xs[i]));
    };
    expect(gaps(0)).toEqual(new Set([5]));
    expect(gaps(2)).toEqual(new Set([5]));
  });

  it('also loosens layouts from layoutCandidates, but not other ones', () => {
    const [first] = layoutCandidates(coke, 6, NO_LIMITS);
    expect([...loosenings(coke, first)].length).toBeGreaterThan(0);
    const manual: Unit[] = first.map((u) => ({ ...u }));
    expect([...loosenings(coke, manual)]).toEqual([]);
  });
});
