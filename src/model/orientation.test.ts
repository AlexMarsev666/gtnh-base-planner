import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { controllerFacing, defOfUnit, unitCells } from './geometry';
import { placeHatches } from './hatches/placement';
import { defCache } from './layout/cache';
import { pairOk } from './layout/shapes';
import type { Dir, Vec3 } from './core/types';
import type { MultiblockDef, Unit } from './multiblock/types';
import { placeUnit } from './site/group';
import { createPipeline, defaultDeps } from '../ui/pipelineCore';
import { defaultPlan } from '../state/store';
import { cloneResult } from './layout/cache';
import { checkValidity } from './validity';
import { computeWallStats } from './walls';

const steam = getMultiblock('steam-separator')!;
const iem = getMultiblock('industrial-extrusion-machine')!;

const STEP: Record<Dir, Vec3> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

describe('per-unit orientation variants', () => {
  it('lets a flipped Steam Separator share one 5x5x5 cube with an unflipped one', () => {
    const cache = defCache(steam);
    const at = (va: 0 | 1 | 2 | 3, vb: 0 | 1 | 2 | 3) => pairOk(steam, cache, 0, 0, [0, 0, 0], va, vb);
    expect(at(0, 0)).toBe(false);
    expect(at(0, 3)).toBe(true);
    expect(at(0, 2)).toBe(true);
    expect(at(3, 0)).toBe(true);
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [0, 0, 0], rotation: 0, variant: 3 },
    ];
    expect(computeWallStats(steam, units, []).conflictCells).toEqual([]);
  });

  it('stacks a vertically flipped Industrial Extrusion Machine on one layer of overlap', () => {
    const cache = defCache(iem);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 0, 0)).toBe(false);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 0, 3)).toBe(true);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 3, 0)).toBe(true);
  });

  it('keeps the pair cache apart per variant', () => {
    const cache = defCache(iem);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 0, 0)).toBe(false);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 0, 3)).toBe(true);
    expect(pairOk(iem, cache, 0, 0, [0, 3, 0], 0, 0)).toBe(false);
  });

  it('builds the cells and controller of a unit from its variant, yaw applied on top', () => {
    const unit: Unit = { id: 0, origin: [0, 0, 0], rotation: 0, variant: 3 };
    expect(defOfUnit(iem, unit)).not.toBe(iem);
    expect(defOfUnit(iem, { id: 0 } as Unit)).toBe(iem);
    const ctl = unitCells(iem, unit).find((c) => c.role === 'controller')!;
    expect(ctl.pos).toEqual([0, 2, 0]);
    expect(controllerFacing(iem, unit)).toBe(iem.controller.facing);
    const yawed: Unit = { ...unit, rotation: 1 };
    const [x, y, z] = unitCells(iem, yawed).find((c) => c.role === 'controller')!.pos;
    expect([y, z]).toEqual([2, 0]);
    expect(x).toBe(iem.size[2] - 1);
  });

  it('places hatches on a flipped unit: never facing the ground, controller front free', () => {
    for (const variant of [2, 3] as const) {
      const units: Unit[] = [{ id: 0, origin: [0, 0, 0], rotation: 0, variant }];
      const res = placeHatches(steam, units, steam.defaultHatches);
      expect(res.hatches.length).toBeGreaterThan(0);
      const [x, y, z] = unitCells(steam, units[0]).find((c) => c.role === 'controller')!.pos;
      const front = [x, y, z - 1];
      for (const h of res.hatches) {
        expect(h.face, `${variant}`).not.toBe('down');
        const d = STEP[h.face];
        expect([h.cell[0] + d[0], h.cell[1] + d[1], h.cell[2] + d[2]]).not.toEqual(front);
      }
    }
  });

  it('swaps the disallowed faces of the Distillation Tower layer hatches when flipped', () => {
    const tower = getMultiblock('distillation-tower')!;
    const faces = (d: MultiblockDef) =>
      Object.values(d.legend).flatMap((l) => Object.values(l.disallowFaces ?? {}));
    expect(faces(tower).length).toBeGreaterThan(0);
    const swap = (f: Dir): Dir => (f === 'up' ? 'down' : f === 'down' ? 'up' : f);
    expect(faces(defOfUnit(tower, { variant: 3 }))).toEqual(faces(tower).map((dirs) => dirs.map(swap)));
  });

  it('reports an orientation error for a variant the machine forbids, absolute to the catalog entry', () => {
    const turbine = getMultiblock('large-steam-turbine')!;
    expect(turbine.variants).toEqual([0, 2]);
    const mk = (variant?: 1 | 2): Unit[] => [
      { id: 0, origin: [0, 0, 0], rotation: 0, ...(variant ? { variant } : {}) },
    ];
    const orientation = (def: MultiblockDef, units: Unit[]) =>
      (checkValidity(def, units, [])[0] ?? []).filter((p) => p.type === 'orientation');
    expect(orientation(turbine, mk(1))).toEqual([{ type: 'orientation', variant: 1, severity: 'error' }]);
    expect(orientation(turbine, mk(2))).toEqual([]);
    expect(orientation(turbine, mk())).toEqual([]);
    // On a mirrored def (a mirrored plan), variant 1 brings it back to 0 and is allowed; variant 0 is the mirror.
    const mirrored = defOfUnit(turbine, { variant: 1 });
    expect(orientation(mirrored, mk())).toEqual([{ type: 'orientation', variant: 1, severity: 'error' }]);
    expect(orientation(mirrored, mk(1))).toEqual([]);
    expect(orientation(getMultiblock('industrial-centrifuge')!, mk(1))).toEqual([]);
  });

  it('keeps the variant through a manual plan pipeline, result cloning and group placement', () => {
    const unit: Unit = { id: 0, origin: [0, 0, 0], rotation: 0, variant: 2 };
    const run = createPipeline(defaultDeps);
    const out = run(
      { ...defaultPlan(), multiblockId: 'steam-separator', count: 1, manualUnits: [unit] },
      false,
      false,
      false,
    );
    expect(out.error).toBeNull();
    const ctl = out.scene!.voxels.find((v) => v.kind === 'controller')!;
    expect(ctl.pos).toEqual(unitCells(steam, unit).find((c) => c.role === 'controller')!.pos);
    expect(ctl.pos[1]).toBe(3);
    const cloned = cloneResult({ units: [unit] } as Parameters<typeof cloneResult>[0]);
    expect(cloned.units[0].variant).toBe(2);
    for (const r of [0, 1, 2, 3] as const) {
      const placed = placeUnit(steam, unit, [5, 5, 5], r, [7, 4]);
      expect(placed.variant).toBe(2);
      expect(unitCells(steam, placed).find((c) => c.role === 'controller')!.pos[1]).toBe(3);
    }
  });
});
