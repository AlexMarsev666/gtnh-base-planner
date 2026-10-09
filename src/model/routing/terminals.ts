import { controllerFacing, rotateDir, step } from '../geometry';
import type { Dir } from '../core/types';
import type { HatchKind, MultiblockDef, Unit, UnitCell } from '../multiblock/types';
import type { HatchPlacement } from '../plan/types';
import { ATTACH_ORDER } from './attachments';
import { BESIDE_HATCH_COST } from './constants';
import { FREE, indexOf, reserve } from './grid';
import { isRoutable, ROUTED_KINDS, ROUTED_MASK, type RoutedKind } from './kinds';
import type { Grid, KindState, Router, Terminal } from './types';

/** What routing connects: its terminals, the cells kept free around the build, and cell prices. */

/** Routed hatches per kind, in hatch order, one per cell. */
export function routedHatchesByKind(
  hatches: readonly HatchPlacement[],
  kinds: readonly RoutedKind[],
): Map<RoutedKind, HatchPlacement[]> {
  const wanted = new Set<HatchKind>(kinds);
  const byKind = new Map<RoutedKind, HatchPlacement[]>();
  const seenCells = new Set<string>();
  for (const h of hatches) {
    if (!isRoutable(h.kind) || !wanted.has(h.kind)) continue;
    const id = `${h.kind}|${h.cell.join()}`;
    if (seenCells.has(id)) continue;
    seenCells.add(id);
    let list = byKind.get(h.kind);
    if (!list) byKind.set(h.kind, (list = []));
    list.push(h);
  }
  return byKind;
}

/**
 * Cells that must stay free: in front of each controller (the player opens it there), and in front of
 * every hatch that is not routed here: a muffler only vents into air (GT stops the machine otherwise), an
 * energy or dynamo hatch without a routed cable takes its cable there, a maintenance hatch needs the player.
 * The cell in front of each routed hatch's placed face stays reserved for its kind, so every hatch keeps
 * at least that way in; its other open sides are free for any pipe.
 */
export function reserveCells(
  g: Grid,
  def: MultiblockDef,
  units: readonly Unit[],
  cellsOf: readonly UnitCell[][],
  hatches: readonly HatchPlacement[],
  byKind: ReadonlyMap<RoutedKind, readonly HatchPlacement[]>,
): void {
  units.forEach((u, ui) => {
    for (const c of cellsOf[ui])
      if (c.role === 'controller') reserve(g, step(c.pos, controllerFacing(def, u)));
  });
  for (const h of hatches) if (!isRoutable(h.kind) || !byKind.has(h.kind)) reserve(g, step(h.cell, h.face));
  ROUTED_KINDS.forEach((kind, k) => {
    for (const h of byKind.get(kind) ?? []) g.termMask[indexOf(g, step(h.cell, h.face))] |= 1 << k;
  });
}

/** Sides a hatch may not be turned to (e.g. Distillation Tower layer outputs never face up or down). */
export function blockedSides(
  def: MultiblockDef,
  units: readonly Unit[],
  cellsOf: readonly UnitCell[][],
  hatches: readonly HatchPlacement[],
): Map<string, Set<Dir>> {
  const blocked = new Map<string, Set<Dir>>();
  if (!Object.values(def.legend).some((l) => l.disallowFaces)) return blocked;
  const hatchAt = new Map(hatches.map((h) => [h.cell.join(), h.kind]));
  units.forEach((u, ui) => {
    for (const c of cellsOf[ui]) {
      const kind = hatchAt.get(c.pos.join());
      const dirs = kind && c.role === 'casing' ? def.legend[c.char]?.disallowFaces?.[kind] : undefined;
      if (!kind || !dirs) continue;
      const id = `${kind}|${c.pos.join()}`;
      let set = blocked.get(id);
      if (!set) blocked.set(id, (set = new Set()));
      for (const d of dirs) set.add(rotateDir(d, u.rotation));
    }
  });
  return blocked;
}

/** One state per routed kind, in `ROUTED_KINDS` order, with the outside cells each terminal may attach to. */
export function createKindStates(
  g: Grid,
  open: Uint8Array,
  byKind: ReadonlyMap<RoutedKind, readonly HatchPlacement[]>,
  blocked: ReadonlyMap<string, ReadonlySet<Dir>>,
): KindState[] {
  const states: KindState[] = [];
  for (const [k, kind] of ROUTED_KINDS.entries()) {
    const list = byKind.get(kind);
    if (!list) continue;
    const bit = 1 << k;
    const usable = (i: number): boolean =>
      open[i] === 1 && g.occ[i] === FREE && (g.termMask[i] === 0 || (g.termMask[i] & bit) !== 0);
    const terms: Terminal[] = list.map((h) => {
      const no = blocked.get(`${h.kind}|${h.cell.join()}`);
      const sides = [h.face, ...ATTACH_ORDER.filter((d) => d !== h.face && !no?.has(d))];
      return { hatch: h.cell, cells: sides.map((d) => indexOf(g, step(h.cell, d))).filter(usable) };
    });
    const at = new Map<number, number[]>();
    terms.forEach((t, ti) => {
      for (const c of t.cells) {
        let l = at.get(c);
        if (!l) at.set(c, (l = []));
        l.push(ti);
      }
    });
    states.push({ kind, k, terms, at, via: new Int32Array(terms.length), tree: null });
  }
  return states;
}

/**
 * Which kinds may enter each free cell, and what a pipe block costs there: cells off the walls cost
 * `wallCost` more, so pipes run along the build and the ground rather than through the air, and cells
 * beside a hatch (other than reserved front cells) a little more.
 */
export function priceCells(r: Router, hatches: readonly HatchPlacement[], wallCost: number): void {
  const { g } = r;
  const cells = g.occ.length;
  for (let i = 0; i < cells; i++)
    if (g.occ[i] === FREE) r.pass[i] = g.termMask[i] !== 0 ? g.termMask[i] : ROUTED_MASK;
  if (wallCost > 0) for (let i = 0; i < cells; i++) if (g.wall[i] === 0) r.price[i] += wallCost;
  for (const h of hatches)
    for (const d of ATTACH_ORDER) {
      const i = indexOf(g, step(h.cell, d));
      if (i >= 0 && i < cells && r.pass[i] === ROUTED_MASK) r.price[i] += BESIDE_HATCH_COST;
    }
}
