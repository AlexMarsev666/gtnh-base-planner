import { getMultiblock } from '../../data/catalog';
import type { Vec3 } from '../core/types';
import { packUnits } from '../layout/packer';
import type { HatchKind, MultiblockDef, PlanLimits } from '../multiblock/types';
import { sizedDef } from '../resize';
import { placeHatches } from './placement';

/**
 * The inputs of the "placement without requests is unchanged" checks (`legacy.test.ts`). This file only uses
 * `placeHatches(def, units, enabled, avoid, { below, toward })`, `packUnits` and `sizedDef`, which are the
 * same at GT:NH 2.9.0-RC-2 (cla 59444a2) as now, so `legacy.generate.test.ts` can run on a clean checkout of
 * that commit to record the snapshots.
 */
const unlimited: PlanLimits = { x: null, y: null, z: null };
const CASES: { id: string; size?: number }[] = [
  { id: 'electric-blast-furnace' },
  { id: 'large-chemical-reactor' },
  { id: 'distillation-tower', size: 5 },
  { id: 'oil-cracking-unit' },
  { id: 'pyrolyse-oven' },
  { id: 'assembly-line' },
];

/** Where each kind's pipes lead to in the `toward` cases: far out on opposite sides. */
const TOWARD: Partial<Record<HatchKind, Vec3>> = {
  energy: [-20, 0, -20],
  maintenance: [-20, 0, -20],
  muffler: [30, 8, 30],
  fluidIn: [30, 2, -20],
  fluidOut: [-20, 2, 30],
  itemIn: [30, 0, 30],
  itemOut: [-20, 6, -20],
  dynamo: [30, 0, -20],
  steamIn: [-20, 0, 30],
};

/** Every kind the def takes that the code at the snapshot's commit knew (not the Data Access Hatch, added later). */
const recordedKinds = (def: MultiblockDef) =>
  (Object.keys(def.hatchBlocks) as HatchKind[]).filter((k) => (k as string) !== 'dataAccess');

/** Plain calls: default and all kinds, 1/3/6 units, with and without connections from below. */
export function recordLegacy(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { id, size } of CASES) {
    const base = getMultiblock(id)!;
    const def = size ? sizedDef(base, size) : base;
    const all = recordedKinds(def);
    for (const count of [1, 3, 6])
      for (const below of [false, true])
        for (const [name, enabled] of [
          ['default', def.defaultHatches],
          ['all', all],
        ] as const)
          out[`${id}/${count}/${below ? 'below' : 'ground'}/${name}`] = placeHatches(
            def,
            packUnits(def, count, unlimited).units,
            enabled,
            undefined,
            { below },
          );
  }
  return out;
}

/**
 * Calls with `toward` and with `avoid` (the cell of the first hatch of each kind of the plain run, so the
 * hatches have to move), all kinds enabled.
 */
export function recordLegacyOptions(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { id, size } of CASES) {
    const base = getMultiblock(id)!;
    const def = size ? sizedDef(base, size) : base;
    const all = recordedKinds(def);
    for (const count of [1, 3])
      for (const below of [false, true]) {
        const units = packUnits(def, count, unlimited).units;
        const name = `${id}/${count}/${below ? 'below' : 'ground'}`;
        out[`${name}/toward`] = placeHatches(def, units, all, undefined, { below, toward: TOWARD });
        const avoid = new Map<HatchKind, Set<string>>();
        for (const h of placeHatches(def, units, all, undefined, { below }).hatches) {
          const cells = avoid.get(h.kind) ?? avoid.set(h.kind, new Set()).get(h.kind)!;
          if (cells.size === 0) cells.add(h.cell.join());
        }
        out[`${name}/avoid`] = placeHatches(def, units, all, avoid, { below });
        out[`${name}/both`] = placeHatches(def, units, all, avoid, { below, toward: TOWARD });
      }
  }
  return out;
}
