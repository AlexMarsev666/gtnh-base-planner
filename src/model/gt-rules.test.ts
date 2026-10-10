import { describe, expect, it } from 'vitest';
import { catalog } from '../data/catalog';
import { defaultPlan } from '../state/store';
import { createPipeline } from '../ui/pipeline';
import { controllerFacing, key, localCells, rotateDir, step, toWorld } from './geometry';
import { PIPE_KINDS } from './routing/kinds';
import type { MultiblockDef, PlanLimits, Unit } from './multiblock/types';

/** Hand-made entries; generated ones (tools/game-dump) have lighter checks in generated.test.ts. */
const handMade = catalog.filter((d) => !d.generated);

/**
 * Game rules checked against GT5-Unofficial 5.09.54.205 (GT:NH 2.9.0-RC-2) on whole plans, pipes included.
 * See the structure definitions linked from each multiblock's `source`.
 */

const NO_LIMITS: PlanLimits = { x: null, y: null, z: null };

function build(id: string, count: number, limits = NO_LIMITS, size?: number) {
  const r = createPipeline()({ ...defaultPlan(id), count, limits, size }, true);
  if (!r.scene || !r.hatches || !r.pack || !r.def) throw new Error(`${id}: ${r.error}`);
  return {
    def: r.def,
    units: r.pack.units,
    hatches: r.hatches,
    scene: r.scene,
    pipes: r.pipes ?? [],
  };
}

/** Legend char of `unit` at a world cell, or undefined. */
function charAt(def: MultiblockDef, unit: Unit, cell: string): string | undefined {
  for (const c of localCells(def)) if (key(toWorld(def, unit, c.local)) === cell) return c.char;
  return undefined;
}

const PLANS: [number, PlanLimits][] = [
  [4, NO_LIMITS],
  [12, NO_LIMITS],
  [9, { x: 3, y: 1, z: null }],
];

describe('GT rules', () => {
  it('Distillation Tower: an output hatch on every layer, never facing up or down', () => {
    for (const height of [3, 5, 12])
      for (const [count, limits] of PLANS) {
        const { def, units, scene } = build('distillation-tower', count, limits, height);
        expect(def.size[1]).toBe(height);
        const outs = scene.hatches.filter((h) => h.kind === 'fluidOut');
        for (const h of outs) expect(['up', 'down']).not.toContain(h.face);
        const regionAt = (u: Unit, cell: string) => def.legend[charAt(def, u, cell) ?? '']?.region;
        // Every layer above the base: the ring copies and the top.
        for (const u of units)
          for (let y = 1; y < height; y++) {
            const layer = regionAt(u, key(toWorld(def, u, [0, y, 0])));
            expect(layer, `height ${height} layer ${y}`).toBeDefined();
            expect(
              outs.some((h) => h.unitIds.includes(u.id) && regionAt(u, key(h.cell)) === layer),
              `unit ${u.id} layer ${y} (${count} units, height ${height})`,
            ).toBe(true);
          }
      }
  });

  it('Oil Cracking Unit: an input hatch on a side column and one in the middle', () => {
    for (const [count, limits] of PLANS) {
      const { def, units, scene } = build('oil-cracking-unit', count, limits);
      const ins = scene.hatches.filter((h) => h.kind === 'fluidIn');
      for (const u of units)
        for (const column of ['l', 'm'])
          expect(
            ins.some((h) => h.unitIds.includes(u.id) && charAt(def, u, key(h.cell)) === column),
            `unit ${u.id} column ${column} (${count} units)`,
          ).toBe(true);
    }
  });

  it('keeps pipes out of the cells mufflers, energy, maintenance and controllers need', () => {
    for (const def of handMade)
      for (const [count, limits] of PLANS) {
        const { units, scene, pipes } = build(def.id, count, limits);
        const pipeCells = new Set(pipes.flatMap((n) => n.paths.flat().map(key)));
        for (const h of scene.hatches)
          if (!(PIPE_KINDS as readonly string[]).includes(h.kind))
            expect(pipeCells.has(key(step(h.cell, h.face))), `${def.id} ${h.kind} at ${key(h.cell)}`).toBe(
              false,
            );
        for (const u of units) {
          const ctrl = localCells(def).find((c) => c.role === 'controller')!;
          const front = key(step(toWorld(def, u, ctrl.local), controllerFacing(def, u)));
          expect(pipeCells.has(front), `${def.id} controller of unit ${u.id}`).toBe(false);
          // ...and no hatch faces it either.
          for (const h of scene.hatches)
            expect(key(step(h.cell, h.face)), `${def.id} ${h.kind}`).not.toBe(front);
        }
      }
  }, 30_000); // Builds and routes every hand-made multiblock at several counts.

  it('turns no hatch to a side its structure forbids', () => {
    for (const def of handMade)
      for (const [count, limits] of PLANS) {
        const { units, scene } = build(def.id, count, limits);
        for (const h of scene.hatches)
          for (const u of units) {
            const ch = charAt(def, u, key(h.cell));
            const no = ch ? def.legend[ch]?.disallowFaces?.[h.kind] : undefined;
            if (no) expect(no.map((d) => rotateDir(d, u.rotation))).not.toContain(h.face);
          }
      }
  }, 30_000); // Builds and routes every hand-made multiblock at several counts.
});
