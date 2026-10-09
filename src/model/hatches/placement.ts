import { type CellKey, DefinitionError, step } from '../geometry';
import { ROUTED_KINDS } from '../routing/kinds';
import type { Dir, Vec3 } from '../core/types';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import type { HatchPlacement, HatchResult } from '../plan/types';
import { HATCH_PRIORITY } from './constants';
import { lineKeys, openRank } from './geometry';
import { allUnplaced, kindsToPlace, quota, sortedIds, alternativeHatchLimits } from './quota';
import { compareEntries, compareFaces, EntryHeap, type FaceScore } from './scoring';
import { findSites } from './sites';
import type { Entry, HatchAvoid, PlaceOptions, Site } from './types';
import { casingAllowance } from '../multiblock/casingConstraints';
import { fixedHatchCounts, fixedHatchKind } from '../multiblock/fixedHatches';
import { hasAlternativeHatchCells } from '../multiblock/fixedHatches';
import { placeResourceHatches } from '../site/resourcePlacement';
import { unitCells } from '../geometry';
import { withAssemblyInputDefaults } from '../multiblock/assemblyLine';

/**
 * UNIT 3 — Hatch placement.
 *
 * Place one hatch of every enabled kind for every unit (respecting `def.requiredHatches` min/max where set):
 * - Only on casing cells whose legend allows that kind, with an exposed outward face
 *   (the neighbouring cell in that direction is not part of any unit).
 * - Prefer cells shared by as many units as possible for kinds in `def.shareableHatches`
 *   (one hatch serves all of them); ties broken deterministically.
 * - One hatch per cell; never on controllers; never on a cell another kind already uses.
 * - Never throws: hatches that cannot be placed go to `unplaced`.
 * Pure and deterministic: same input -> same output, no mutation of arguments.
 *
 * Details:
 * - Kinds are placed in `HATCH_PRIORITY` order. Enabled kinds the def has no hatch block for are ignored.
 * - A face is open when the cell in front of it is empty and connected to the outside of the build
 *   (sealed pockets, air interiors and the ground under the lowest layer do not count), and it is not the
 *   cell in front of a controller. Two hatches of different kinds never face the
 *   same empty cell, so each can get its own pipe.
 * - A cell inside several units is only usable if every one of them has a casing there that allows the
 *   kind (same block id). Such a cell hosts a hatch only for shareable kinds of a `wallshare` def, and
 *   the hatch serves all of those units; otherwise only cells of exactly one unit are used.
 * - A hatch is never placed where it would push a unit above `requiredHatches[kind].max`.
 * - Greedy: repeatedly take the cell serving the most units still below their target; ties prefer fewer
 *   already-served units on the cell, then a face with open space ahead over one into a gap or recess,
 *   then a face in line with hatches of the same kind already placed (same direction, fronts on one axis
 *   line, so one straight pipe or cable serves them), then a face on a line more units could share, then
 *   fewer hatches of other kinds around, then the face nearest the point `toward` gives for the kind, then a
 *   side face over top over bottom, then the lowest y, z, x.
 * - `below` opens the layer under the build: hatches of the lowest layer may face down into it.
 * - `avoid` keeps listed cells free of the listed kinds (they may still take other kinds).
 * - Unit ids are expected to be unique. The result is independent of the order of `units` and
 *   `enabled`: hatches are listed in placement order, `unplaced` by kind priority then unit id.
 */
export function placeHatches(
  def: MultiblockDef,
  units: readonly Unit[],
  enabled: readonly HatchKind[],
  avoid?: HatchAvoid,
  opts: PlaceOptions = {},
): HatchResult {
  let kinds: HatchKind[] = [];
  try {
    kinds = kindsToPlace(def, enabled);
    if (kinds.length === 0 || units.length === 0) return { hatches: [], unplaced: [] };
    if (kinds.includes('itemIn') && !kinds.includes('fluidOut')) def = withAssemblyInputDefaults(def);
    if (def.orderedHatchKinds?.length || hasAlternativeHatchCells(def, kinds))
      return placeResourceHatches(def, units, kinds, {}, {}, !!opts.below, {}, avoid, opts.toward);
    const result = place(def, units, kinds, avoid, !!opts.below, opts.toward);
    return kinds.includes('dataAccess') || kinds.includes('uncertainty')
      ? {
          ...result,
          hatches: result.hatches.map((h) =>
            h.kind === 'dataAccess'
              ? { ...h, tier: 'EV' }
              : h.kind === 'uncertainty'
                ? { ...h, tier: 'IV' }
                : h,
          ),
        }
      : result;
  } catch (err) {
    // Malformed definition (e.g. unknown legend char): nothing can be placed. Anything else is a bug.
    if (err instanceof DefinitionError) return allUnplaced(def, units, kinds);
    throw err;
  }
}

function place(
  def: MultiblockDef,
  units: readonly Unit[],
  kinds: HatchKind[],
  avoid?: HatchAvoid,
  below = false,
  toward?: PlaceOptions['toward'],
): HatchResult {
  const { sites, openAround, openToward, nearby, volume } = findSites(def, units, below);
  const fixed = new Map<string, HatchKind>();
  const requiredCells = new Map<string, Set<string>>();
  if (Object.keys(fixedHatchCounts(def)).length)
    for (const unit of units)
      for (const cell of unitCells(def, unit)) {
        const kind = fixedHatchKind(def, def.legend[cell.char]);
        if (kind) {
          fixed.set(cell.pos.join(), kind);
          const key = `${unit.id}:${kind}`;
          const positions = requiredCells.get(key) ?? new Set<string>();
          positions.add(cell.pos.join());
          requiredCells.set(key, positions);
        }
      }
  const unitIds = sortedIds(units);
  const casings = casingAllowance(def, units);
  const shareable = new Set(def.shareableHatches ?? []);
  const used = new Set<CellKey>();
  /** Empty cell in front of a hatch -> kind of that hatch. */
  const frontMap = new Map<CellKey, HatchKind>();
  const frontIndex = volume > 0 ? new Int8Array(volume).fill(-1) : null;
  /** Kind of the hatch facing the empty cell `k`, if any. */
  const frontOf = (k: CellKey): HatchKind | undefined => {
    if (!frontIndex) return frontMap.get(k);
    const i = frontIndex[k as number];
    return i < 0 ? undefined : HATCH_PRIORITY[i];
  };
  const around = new Map<CellKey, (CellKey | null)[]>();
  const openCells = (k: CellKey): (CellKey | null)[] => {
    let list = around.get(k);
    if (!list) around.set(k, (list = openAround ? openAround(k) : []));
    return list;
  };
  /** Ways out of the empty cell `k` for a pipe of `kind`: open cells beside it not facing another kind. */
  const exits = (k: CellKey, kind: HatchKind): number => {
    let n = 0;
    for (const c of openCells(k)) if (c === null || (frontOf(c) ?? kind) === kind) n++;
    return n;
  };
  /**
   * Whether a hatch of `kind` facing the empty cell `k` would be walled in: `k` has no way out for its pipe,
   * or `k` is the last way out of the cell in front of a neighbouring hatch of another kind.
   */
  const walledIn = (k: CellKey, kind: HatchKind): boolean => {
    if (!openAround) return false;
    if (exits(k, kind) === 0) return true;
    for (const c of openCells(k)) {
      if (c === null) continue;
      const other = frontOf(c);
      if (other !== undefined && other !== kind && exits(c, other) === 1) return true;
    }
    return false;
  };
  const close = new Map<CellKey, number[]>();
  /** Hatches of other kinds facing the 26 cells around the empty cell `k`: their pipes compete for room. */
  const crowd = (k: CellKey, kind: HatchKind): number => {
    if (!nearby) return 0;
    let list = close.get(k);
    if (!list) close.set(k, (list = nearby(k)));
    let n = 0;
    for (const c of list) {
      const other = frontOf(c);
      if (other !== undefined && other !== kind) n++;
    }
    return n;
  };
  const hatches: HatchPlacement[] = [];
  const alternativeLimits = alternativeHatchLimits(def);
  const alternativeCounts = new Map<string, number>();
  const unplaced: HatchResult['unplaced'] = [];

  kinds.forEach((kind, ki) => {
    const later = kinds.slice(ki + 1);
    const { target, max } = quota(def, kind);
    if (target <= 0) return;
    const canShare = def.wallshare && shareable.has(kind);
    const avoided = avoid?.get(kind);
    const candidates = sites.filter(
      (s) =>
        s.kinds.has(kind) &&
        !used.has(s.key) &&
        (canShare || s.unitIds.length === 1) &&
        !avoided?.has(s.pos.join()),
    );
    const count = new Map<number, number>(unitIds.map((id) => [id, 0]));
    /** Placed hatches of this kind per line (see `lineKeys`), and the candidates with a face on each line. */
    const lines = new Map<string, number>();
    const onLine = new Map<string, number[]>();
    const unitsOnLine = new Map<string, Set<number>>();
    // Only kinds that take a pipe or cable gain from lining up (a maintenance hatch or muffler does not).
    const lineUp = openToward !== null && (ROUTED_KINDS as readonly HatchKind[]).includes(kind);
    const keysOf = (pos: Vec3, f: Site['faces'][number]): string[] =>
      lineUp ? lineKeys(step(pos, f.dir), f.dir, (d) => openToward!(f.front, d)) : [];
    /** Per candidate and face: its line keys. */
    const faceKeys = candidates.map((c) => c.faces.map((f) => keysOf(c.pos, f)));
    candidates.forEach((c, i) => {
      for (const keys of faceKeys[i])
        for (const k of keys) {
          const list = onLine.get(k);
          if (!list) onLine.set(k, [i]);
          else if (list[list.length - 1] !== i) list.push(i);
          let ids = unitsOnLine.get(k);
          if (!ids) unitsOnLine.set(k, (ids = new Set()));
          for (const id of c.unitIds) ids.add(id);
        }
    });
    /** Static: how many units could line up with a face (before anything is placed, rows beat ends). */
    const reachAt = (keys: string[]): number => {
      let n = 0;
      for (const k of keys) n = Math.max(n, unitsOnLine.get(k)?.size ?? 0);
      return n;
    };
    const alignedAt = (keys: string[]): number => {
      let n = 0;
      for (const k of keys) n += lines.get(k) ?? 0;
      return n;
    };

    /**
     * One greedy pass: place hatches of `kind` on the best candidates until no unit on any free
     * candidate still `needs` one there. Every unit on a chosen cell is served (`count` + 1).
     */
    const pass = (needs: (site: Site, unitId: number) => boolean, served: (site: Site) => void): void => {
      /** Current score of candidate `i`, or null when it cannot take this kind any more. */
      const evaluate = (i: number): Entry | null => {
        const c = candidates[i];
        if (used.has(c.key) || !casings.canReplace(c.pos, c.unitIds)) return null;
        let score = 0;
        for (const id of c.unitIds) {
          if ((count.get(id) ?? 0) >= max) return null;
          if (
            (alternativeLimits[kind] ?? []).some(
              (rule) =>
                rule.anyOf!.reduce((n, k) => n + (alternativeCounts.get(`${id}:${k}`) ?? 0), 0) >= rule.max!,
            )
          )
            return null;
          if (needs(c, id)) score++;
        }
        if (score === 0) return null;
        const blocked = c.blocked.get(kind);
        const target = toward?.[kind];
        const farOf = (dir: Dir): number => {
          if (!target) return 0;
          const q = step(c.pos, dir);
          return Math.abs(q[0] - target[0]) + Math.abs(q[1] - target[1]) + Math.abs(q[2] - target[2]);
        };
        let best: FaceScore | null = null;
        for (let fi = 0; fi < c.faces.length; fi++) {
          const f = c.faces[fi];
          if ((frontOf(f.front) ?? kind) !== kind || blocked?.has(f.dir)) continue;
          const option: FaceScore = {
            face: fi,
            walled: walledIn(f.front, kind) ? 1 : 0,
            open: openRank(f.rank),
            crowded: crowd(f.front, kind),
            aligned: lines.size > 0 ? alignedAt(faceKeys[i][fi]) : 0,
            reach: reachAt(faceKeys[i][fi]),
            far: farOf(f.dir),
          };
          if (!best || compareFaces(option, best) < 0) best = option;
        }
        if (!best) return null;
        return {
          ...best,
          i,
          fixed: fixed.get(c.pos.join()) === kind ? c.unitIds.length : 0,
          score,
          waste: c.unitIds.length - score,
          wanted: later.reduce((n, k) => n + (c.kinds.has(k) ? 1 : 0), 0),
          faceRank: c.faces[best.face].rank,
        };
      };

      // Greedy pick of the best candidate, via a lazy max-heap. A candidate's rank only gets worse (counts
      // grow, so score falls and waste rises; this kind's own fronts never close its faces), except that
      // a placed hatch lines up the candidates on its lines: those are pushed again with their new rank.
      // So a popped entry whose re-evaluated rank is unchanged beats every other candidate's current rank.
      const heap = new EntryHeap();
      for (let i = 0; i < candidates.length; i++) {
        const e = evaluate(i);
        if (e) heap.push(e);
      }
      for (;;) {
        const top = heap.pop();
        if (!top) break;
        const now = evaluate(top.i);
        if (!now) continue;
        if (compareEntries(now, top) !== 0) {
          heap.push(now);
          continue;
        }
        const best = candidates[now.i];
        const bestFace = best.faces[now.face];
        used.add(best.key);
        casings.replace(best.pos, best.unitIds);
        if (frontIndex) frontIndex[bestFace.front as number] = HATCH_PRIORITY.indexOf(kind);
        else frontMap.set(bestFace.front, kind);
        for (const id of best.unitIds) count.set(id, (count.get(id) ?? 0) + 1);
        if (alternativeLimits[kind])
          for (const id of best.unitIds) {
            const key = `${id}:${kind}`;
            alternativeCounts.set(key, (alternativeCounts.get(key) ?? 0) + 1);
          }
        served(best);
        hatches.push({ kind, cell: best.pos, face: bestFace.dir, unitIds: [...best.unitIds] });
        for (const k of faceKeys[now.i][now.face]) {
          lines.set(k, (lines.get(k) ?? 0) + 1);
          for (const i of onLine.get(k) ?? []) {
            const e = evaluate(i);
            if (e) heap.push(e);
          }
        }
      }
    };

    // Regions that each need one hatch of this kind come first (e.g. every Distillation Tower layer),
    // then the remaining count up to the target anywhere allowed.
    const regions = def.requiredHatches?.[kind]?.regions ?? [];
    const missing = new Map<number, number>(unitIds.map((id) => [id, 0]));
    for (const region of regions) {
      const done = new Set<number>();
      pass(
        (site, id) => site.regions.get(id) === region && !done.has(id),
        (site) => {
          for (const id of site.unitIds) if (site.regions.get(id) === region) done.add(id);
        },
      );
      for (const id of unitIds) if (!done.has(id)) missing.set(id, (missing.get(id) ?? 0) + 1);
    }
    pass(
      (_, id) => (count.get(id) ?? 0) < target,
      () => {},
    );

    const placedCells = new Set(
      hatches.filter((hatch) => hatch.kind === kind).map((hatch) => hatch.cell.join()),
    );
    for (const id of unitIds) {
      const fixedMissing = [...(requiredCells.get(`${id}:${kind}`) ?? [])].filter(
        (pos) => !placedCells.has(pos),
      ).length;
      const short = Math.max(target - (count.get(id) ?? 0), missing.get(id) ?? 0, fixedMissing);
      for (let n = 0; n < short; n++) unplaced.push({ unitId: id, kind });
    }
  });

  return { hatches, unplaced };
}
