import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../../data/catalog';
import { packUnits } from '../layout/packer';
import type { HatchKind, MultiblockDef } from '../multiblock/types';
import { checkValidity } from '../validity';
import { defaultPlan } from '../../state/store';
import { createPipeline } from '../../ui/pipelineCore';
import { placeHatches } from './placement';
import { effectiveSharing, withSharing } from './sharing';

const ebf = getMultiblock('electric-blast-furnace')!;
const pyrolyse = getMultiblock('pyrolyse-oven')!;

/** `n` units in a row, all hatch kinds of the def enabled. */
function place(def: MultiblockDef, n: number) {
  const units = packUnits(def, n, { x: n, y: 1, z: 1 }).units;
  const hatches = placeHatches(def, units, Object.keys(def.hatchBlocks) as HatchKind[]).hatches;
  return { units, hatches };
}
const ofKind = (hatches: { kind: HatchKind; unitIds: number[] }[], kind: HatchKind) =>
  hatches.filter((h) => h.kind === kind);

describe('withSharing', () => {
  it('returns the def itself when nothing changes, and one copy per choice otherwise', () => {
    expect(withSharing(ebf, {})).toBe(ebf);
    expect(withSharing(ebf, { energy: false, maintenance: false })).toBe(ebf);
    expect(withSharing({ ...ebf, wallshare: false }, { energy: true })).toEqual({ ...ebf, wallshare: false });
    const e = withSharing(ebf, { energy: true });
    expect(e).not.toBe(ebf);
    expect(e.shareableHatches).toContain('energy');
    expect(e.shareableHatches).not.toContain('maintenance');
    expect(withSharing(ebf, { energy: true })).toBe(e);
    expect(ebf.shareableHatches).not.toContain('energy');
    expect(withSharing(ebf, { energy: true, maintenance: true }).shareableHatches).toEqual(
      expect.arrayContaining(['energy', 'maintenance']),
    );
  });
});

describe('shared mufflers', () => {
  it('serve two Pyrolyse Ovens with one hatch, where each had its own before', () => {
    const shared = place(pyrolyse, 2);
    expect(ofKind(shared.hatches, 'muffler').map((h) => h.unitIds.length)).toEqual([2]);
    // Without wall sharing no cell is common to the units, so each takes its own (what was placed before).
    const apart = placeHatches(
      { ...pyrolyse, wallshare: false },
      shared.units,
      Object.keys(pyrolyse.hatchBlocks) as HatchKind[],
    ).hatches;
    expect(ofKind(apart, 'muffler').map((h) => h.unitIds.length)).toEqual([1, 1]);
  });

  it('are shared with no option set, and every unit keeps one', () => {
    const { units, hatches } = place(pyrolyse, 3);
    const mufflers = ofKind(hatches, 'muffler');
    // Fewer hatches than units were needed.
    expect(new Set(mufflers.flatMap((h) => h.unitIds))).toEqual(new Set(units.map((u) => u.id)));
    expect(mufflers.length).toBeLessThan(3);
    expect(withSharing(pyrolyse, {})).toBe(pyrolyse);
  });
});

describe('muffler counts on every wall-sharing def', () => {
  const defs = catalog.filter((d) => d.wallshare && d.hatchBlocks.muffler);
  it('keep each unit within its required muffler range, with 2 and 3 units', () => {
    expect(defs.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const def of defs) {
      const min = def.requiredHatches?.muffler?.min ?? 0;
      const max = def.requiredHatches?.muffler?.max ?? Infinity;
      for (const n of [2, 3]) {
        const units = packUnits(def, n, { x: null, y: null, z: null }).units;
        const enabled = [...new Set<HatchKind>([...def.defaultHatches, 'muffler'])];
        const { hatches, unplaced } = placeHatches(def, units, enabled);
        for (const u of units) {
          // A layout that leaves a muffler unplaced is no plan: the pipeline takes a looser one.
          if (unplaced.some((p) => p.kind === 'muffler' && p.unitId === u.id)) continue;
          const have = hatches.filter((h) => h.kind === 'muffler' && h.unitIds.includes(u.id)).length;
          if (have < min || have > max) bad.push(`${def.id} x${n} unit ${u.id}: ${have}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('leave no muffler unplaced in the full pipeline, with 2 and 3 units', () => {
    const bad: string[] = [];
    for (const def of defs)
      for (const n of [2, 3]) {
        const enabled = [...new Set<HatchKind>([...def.defaultHatches, 'muffler'])];
        const r = createPipeline()({ ...defaultPlan(def.id), count: n, enabledHatches: enabled }, false);
        const left = r.hatches?.unplaced.filter((u) => u.kind === 'muffler') ?? [];
        if (left.length > 0) bad.push(`${def.id} x${n}: ${left.length}`);
      }
    expect(bad).toEqual([]);
  }, 60_000);
});

describe('effectiveSharing', () => {
  it('counts an option only where it changes the def', () => {
    const on = { maintenance: true, energy: true };
    expect(effectiveSharing(ebf, on)).toEqual({ maintenance: true, energy: true });
    expect(effectiveSharing(ebf, {})).toEqual({ maintenance: false, energy: false });
    expect(effectiveSharing({ ...ebf, wallshare: false }, on)).toEqual({ maintenance: false, energy: false });
    const { energy: _, ...noEnergy } = ebf.hatchBlocks;
    expect(effectiveSharing({ ...ebf, hatchBlocks: noEnergy }, on)).toEqual({
      maintenance: true,
      energy: false,
    });
  });
});

describe('shared energy hatches', () => {
  it('serve two units when asked, one each otherwise', () => {
    const off = place(ebf, 2);
    expect(ofKind(off.hatches, 'energy').map((h) => h.unitIds.length)).toEqual([1, 1]);
    const on = place(withSharing(ebf, { energy: true }), 2);
    expect(ofKind(on.hatches, 'energy').map((h) => h.unitIds.length)).toEqual([2]);
  });

  it('never serve three units', () => {
    for (const def of [ebf, pyrolyse]) {
      const on = place(withSharing(def, { energy: true }), 3);
      const energy = ofKind(on.hatches, 'energy');
      expect(Math.max(...energy.map((h) => h.unitIds.length))).toBe(2);
      // Every unit still has one.
      expect(new Set(energy.flatMap((h) => h.unitIds))).toEqual(new Set(on.units.map((u) => u.id)));
    }
  });
});

describe('shared maintenance hatches', () => {
  it('serve both units when asked, one each otherwise', () => {
    expect(ofKind(place(pyrolyse, 2).hatches, 'maintenance').map((h) => h.unitIds.length)).toEqual([1, 1]);
    const on = place(withSharing(pyrolyse, { maintenance: true }), 2);
    expect(ofKind(on.hatches, 'maintenance').map((h) => h.unitIds.length)).toEqual([2]);
  });
});

describe('validity hints for shared hatches', () => {
  it('are hints, one per unit served, and absent without sharing', () => {
    const def = withSharing(pyrolyse, { maintenance: true, energy: true });
    const { units, hatches } = place(def, 2);
    const problems = Object.values(checkValidity(def, units, hatches)).flat();
    expect(problems.map((p) => p.type).sort()).toEqual([
      'sharedEnergy',
      'sharedEnergy',
      'sharedMaintenance',
      'sharedMaintenance',
    ]);
    expect(problems.every((p) => p.severity === 'hint')).toBe(true);
    const plain = place(pyrolyse, 2);
    expect(
      Object.values(checkValidity(pyrolyse, plain.units, plain.hatches))
        .flat()
        .filter((p) => p.type === 'sharedEnergy' || p.type === 'sharedMaintenance'),
    ).toEqual([]);
  });
});
