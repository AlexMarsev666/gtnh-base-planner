import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { rotatedSize } from './geometry';
import { layoutCandidates, packUnits } from './layout/packer';
import { loosenings } from './layout/variants';
import type { Vec3 } from './core/types';
import type { MultiblockDef, PlanLimits, Unit } from './multiblock/types';
import { computeWallStats } from './walls';

const NO_LIMITS: PlanLimits = { x: null, y: null, z: null };

/** Per-axis extent of the bounding box of `units`. */
function extent(def: MultiblockDef, units: readonly Unit[]): Vec3 {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const u of units) {
    const size = rotatedSize(def, u.rotation);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], u.origin[a]);
      hi[a] = Math.max(hi[a], u.origin[a] + size[a]);
    }
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

const volume = (e: Vec3) => e[0] * e[1] * e[2];

const noConflicts = (def: MultiblockDef, units: Unit[]) =>
  expect(computeWallStats(def, units, []).conflictCells).toEqual([]);

describe('packing with deep overlaps and turned units', () => {
  it('puts two Steam Separators in one 5x5x5 cube, one of them upside down', () => {
    const def = getMultiblock('steam-separator')!;
    const { units } = packUnits(def, 2, NO_LIMITS);
    expect(units).toHaveLength(2);
    expect(units[0].origin).toEqual(units[1].origin);
    const turned = units.filter((u) => u.variant);
    expect(turned).toHaveLength(1);
    expect([2, 3]).toContain(turned[0].variant);
    expect(extent(def, units)).toEqual([5, 5, 5]);
    noConflicts(def, units);
  });

  it('packs four Industrial Extrusion Machines tighter than a mirrored 15x7 facade', () => {
    const def = getMultiblock('industrial-extrusion-machine')!;
    const limits: PlanLimits = { x: null, y: null, z: 1 };
    const best = packUnits(def, 4, limits).units;
    expect(volume(extent(def, best))).toBeLessThanOrEqual(15 * 7 * 4);
    noConflicts(def, best);
  });

  it('overlaps the Eye of Harmony and the Dimensionally Transcendent Plasma Forge by more than a wall', () => {
    const eoh = getMultiblock('eye-of-harmony')!;
    const two = packUnits(eoh, 2, NO_LIMITS).units;
    expect(Math.max(...extent(eoh, two))).toBeLessThan(2 * eoh.size[0] - 1);
    noConflicts(eoh, two);
    const dtpf = getMultiblock('dimensionally-transcendent-plasma-forge')!;
    for (const n of [2, 3]) {
      const units = packUnits(dtpf, n, NO_LIMITS).units;
      expect(units).toHaveLength(n);
      expect(Math.max(...extent(dtpf, units))).toBeLessThan(n * (dtpf.size[0] - 1) + 1);
      noConflicts(dtpf, units);
    }
  });

  const identity = JSON.parse(
    readFileSync(new URL('./layout/identity.json', import.meta.url), 'utf8'),
  ) as Record<string, string>;

  it('leaves the layouts of machines with nothing deeper unchanged', () => {
    const ids = [
      'electric-blast-furnace',
      'large-chemical-reactor',
      'oil-cracking-unit',
      'distillation-tower',
      'vacuum-freezer',
      'large-steam-turbine',
    ];
    for (const id of ids) {
      // A copy, so the packer starts from an empty cache like the recorded run did.
      const def = { ...getMultiblock(id)! };
      for (let n = 1; n <= 8; n++) {
        const units = packUnits(def, n, NO_LIMITS).units;
        const layout = units
          .map((u) => `${u.origin.join(',')}/${u.rotation}${u.variant ? `v${u.variant}` : ''}`)
          .join(';');
        expect(layout, `${id} x${n}`).toBe(identity[`${id}|${n}`]);
      }
    }
  });

  it('never turns a unit the machine forbids to turn', () => {
    const steam = getMultiblock('steam-separator')!;
    const fixed = { ...steam, variants: [0 as const] };
    for (const n of [2, 3, 4]) {
      const { units } = packUnits(fixed, n, NO_LIMITS);
      expect(units.every((u) => !u.variant)).toBe(true);
      expect(new Set(units.map((u) => u.origin.join())).size).toBe(n);
    }
    // Only the allowed ones are used: absolute to the entry, which here is the def itself.
    for (const allowed of [2, 3] as const) {
      const def = { ...steam, variants: [0 as const, allowed] };
      const { units } = packUnits(def, 2, NO_LIMITS);
      expect(units.map((u) => u.variant ?? 0).sort()).toEqual([0, allowed]);
      expect(extent(def, units)).toEqual([5, 5, 5]);
    }
    const flipX = { ...steam, variants: [0 as const, 1 as const] };
    expect(packUnits(flipX, 2, NO_LIMITS).units.every((u) => !u.variant || u.variant === 1)).toBe(true);
  });

  it('loosens a turned layout through the plain layout and its loosenings', () => {
    const def = getMultiblock('industrial-extrusion-machine')!;
    const units = packUnits(def, 4, { x: null, y: null, z: 1 }).units;
    expect(units.some((u) => u.variant)).toBe(true);
    const looser = [...loosenings(def, units)];
    expect(looser.length).toBeGreaterThan(0);
    for (const l of looser) {
      expect(l.every((u) => !u.variant)).toBe(true);
      noConflicts(def, l);
    }
  });

  it('is deterministic', () => {
    const def = getMultiblock('industrial-extrusion-machine')!;
    const a = packUnits({ ...def }, 4, NO_LIMITS).units;
    const b = packUnits({ ...def }, 4, NO_LIMITS).units;
    expect(b).toEqual(a);
  });
});
