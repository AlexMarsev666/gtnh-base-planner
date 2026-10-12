import { type CellKey, DefinitionError, step } from '../geometry';
import { ROUTED_KINDS } from '../routing/kinds';
import type { Dir, Vec3 } from '../core/types';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import { HATCH_PRIORITY } from './constants';
import { capacityOf } from './capacity';
import { lineKeys, openRank } from './geometry';
import { casingFloor, casingRooms, floorsOf } from './floor';
import { SHARE_LIMIT, SHARED_ALWAYS } from './sharing';
import { allUnplaced, anyMins, kindsToPlace, quota, sortedIds } from './quota';
import {
  FLUID_KINDS,
  minOf,
  type Stage,
  shortOfAny,
  shortOfMin,
  stagesOf,
  wantedOfKinds,
  wantedOfStages,
} from './requests';
import { compareEntries, compareFaces, EntryHeap, type FaceScore } from './scoring';
import { findSites } from './sites';
import { inZone, resolveZone, withHatchZones } from './zones';
import type {
  Entry,
  HatchAvoid,
  HatchRequest,
  KeyedHatch,
  PlaceOptions,
  PlaceResult,
  Site,
  UnplacedHatch,
} from './types';

/**
 * UNIT 3 — Hatch placement.
 *
 * Place one hatch of every enabled kind for every unit (respecting `def.requiredHatches` min/max where set):
 * - Only on casing cells whose legend allows that kind, with an exposed outward face
 *   (the neighbouring cell in that direction is not part of any unit).
 * - Prefer cells shared by as many units as possible for kinds in `def.shareableHatches` and the muffler
 *   (one hatch serves all of them, at most `SHARE_LIMIT` units); ties broken deterministically.
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
 *   kind (same block id). Such a cell hosts a hatch only for shareable kinds of a `wallshare` def (see `sharing.ts`), and
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
 * - With `opts.requests` the listed hatches are placed instead (see `HatchRequest`; `enabled` is ignored):
 *   mandatory ones (the first `requiredHatches[kind].min` requests of a kind) before the rest, each by kind
 *   priority, on cells of the request's zone, a fluid hatch only where every unit on the cell asked for it,
 *   and `key` copied to the hatch (`withHatchZones` is applied to `def` first). Nothing is placed that was
 *   not asked for; `unplaced` says what is missing and why (`UnplacedHatch.reason`): hatches that found no
 *   cell, kinds or unit ids that do not exist, and requirements (`requiredHatches` min or region) the
 *   requests leave open. A hatch in a wall shared by units serves all of them, as in GT.
 * - `minCasings`: a hatch never goes where it would leave a unit with fewer counted casing cells than the
 *   minimum asks (a hatch on a cell shared by units takes one from each). Hatches placed first win the room:
 *   with requests the mandatory ones go first anyway; without, the usual order is tried and, only if the floor
 *   turned a hatch away, redone with the mandatory kinds (`requiredHatches` min, `requiredAny`) first. A hatch
 *   that found a cell but no room under a floor is `unplaced` with reason `casings` (with requests).
 * - `requiredAny` groups: without requests the group's `min` is placed of its first enabled kind, as a
 *   `requiredHatches` min is; a group with no enabled kind is left unmet (see `checkValidity`).
 * - `capacity` lists the units that want more hatches than they have cells for (see `CapacityEntry`); it is
 *   absent when nothing is overfull, and never changes what is placed.
 * - Unit ids are expected to be unique. The result is independent of the order of `units` and
 *   `enabled`: hatches are listed in placement order, `unplaced` by kind priority then unit id.
 */
export function placeHatches(
  def: MultiblockDef,
  units: readonly Unit[],
  enabled: readonly HatchKind[],
  avoid?: HatchAvoid,
  opts: PlaceOptions = {},
): PlaceResult {
  if (opts.requests) return placeRequested(def, units, opts.requests, avoid, opts);
  let kinds: HatchKind[] = [];
  try {
    kinds = kindsToPlace(def, enabled);
    if (kinds.length === 0 || units.length === 0) return { hatches: [], unplaced: [] };
    return place(def, units, kinds, avoid, !!opts.below, opts.toward);
  } catch (err) {
    // Malformed definition (e.g. unknown legend char): nothing can be placed. Anything else is a bug.
    if (err instanceof DefinitionError) return allUnplaced(def, units, kinds);
    throw err;
  }
}

/** `placeHatches` with `PlaceOptions.requests`. */
function placeRequested(
  base: MultiblockDef,
  units: readonly Unit[],
  requests: readonly HatchRequest[],
  avoid: HatchAvoid | undefined,
  opts: PlaceOptions,
): PlaceResult {
  const def = withHatchZones(base);
  const ids = sortedIds(units);
  const kinds = kindsToPlace(
    def,
    requests.map((r) => r.kind),
  );
  const resolved = requests.map((r) => (r.zone === undefined ? r : { ...r, zone: resolveZone(def, r.zone) }));
  const { stages, rejected } = stagesOf(def, resolved, ids, kinds);
  let placed: PlaceResult = { hatches: [], unplaced: [] };
  if (stages.length > 0) {
    try {
      placed = place(def, units, kinds, avoid, !!opts.below, opts.toward, stages);
    } catch (err) {
      // Malformed definition (e.g. unknown legend char): nothing can be placed. Anything else is a bug.
      if (!(err instanceof DefinitionError)) throw err;
      for (const st of stages)
        for (const unitId of [...st.units].sort((a, b) => a - b))
          placed.unplaced.push({
            unitId,
            kind: st.kind,
            ...(st.key !== undefined ? { key: st.key } : {}),
            reason: 'noCell',
          });
    }
  }
  const regionMisses = (unitId: number, kind: HatchKind): number =>
    placed.unplaced.filter((u) => u.reason === 'required' && u.unitId === unitId && u.kind === kind).length;
  const out: PlaceResult = {
    hatches: placed.hatches,
    unplaced: [
      ...rejected,
      ...placed.unplaced,
      ...shortOfMin(def, ids, stages, regionMisses),
      ...shortOfAny(def, ids, stages),
    ],
  };
  if (placed.capacity) out.capacity = placed.capacity;
  return out;
}

function place(
  def: MultiblockDef,
  units: readonly Unit[],
  kinds: HatchKind[],
  avoid?: HatchAvoid,
  below = false,
  toward?: PlaceOptions['toward'],
  stages?: readonly Stage[],
  mandatoryFirst = false,
): PlaceResult {
  const { sites, openAround, openToward, nearby, volume } = findSites(def, units, below);
  const unitIds = sortedIds(units);
  const floor = def.minCasings?.length ? casingFloor(def, unitIds) : null;
  const any = anyMins(def, kinds);
  // With a casing floor the first hatches placed win the room. Kinds go by `HATCH_PRIORITY` until the floor
  // leaves a unit short of a hatch; the layout is then placed again with the mandatory kinds first, and
  // that result kept when it is no worse.
  const flooredKinds = new Set<string>();
  const must = (k: HatchKind) => Math.max(minOf(def, k), any.get(k) ?? 0) > 0;
  if (floor && !stages && mandatoryFirst) {
    kinds = [...kinds.filter(must), ...kinds.filter((k) => !must(k))];
  }
  const shareable = new Set([...(def.shareableHatches ?? []), ...(def.wallshare ? SHARED_ALWAYS : [])]);
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
  const hatches: KeyedHatch[] = [];
  const unplaced: UnplacedHatch[] = [];
  const canShareKind = (kind: HatchKind, units = 2): boolean =>
    !!def.wallshare && shareable.has(kind) && units <= (SHARE_LIMIT[kind] ?? Infinity);
  const wantedByUnit = stages ? wantedOfStages(stages) : null;
  const wantedAll = wantedByUnit ? [] : wantedOfKinds(def, kinds);
  const { entries: capacity, lacking } = capacityOf(
    sites,
    new Map(unitIds.map((id) => [id, wantedByUnit ? (wantedByUnit.get(id) ?? []) : wantedAll])),
    canShareKind,
    floor ? { rooms: casingRooms(def), of: (s, id) => floorsOf(def, s.chars.get(id)) } : undefined,
  );

  /** Per kind, the hatches placed per unit and per line (see `lineKeys`): shared by all requests of a kind. */
  const counts = new Map<HatchKind, Map<number, number>>();
  const lineCounts = new Map<HatchKind, Map<string, number>>();

  /**
   * Sets up placing hatches of `kind` on the sites `accept` allows (at most `max` per unit across calls);
   * `key` is copied to each hatch. Returns `count` (hatches of the kind per unit so far) and `pass`.
   */
  const setup = (
    kind: HatchKind,
    later: HatchKind[],
    max: number,
    accept: (s: Site) => boolean,
    key?: string,
  ) => {
    /** Units that asked for a hatch of this kind and found a cell only a casing floor kept them from. */
    const floored = new Set<number>();
    const avoided = avoid?.get(kind);
    const candidates = sites.filter(
      (s) =>
        s.kinds.has(kind) &&
        !used.has(s.key) &&
        (s.unitIds.length === 1 || canShareKind(kind, s.unitIds.length)) &&
        !avoided?.has(s.pos.join()) &&
        accept(s),
    );
    let count = counts.get(kind);
    if (!count) counts.set(kind, (count = new Map<number, number>(unitIds.map((id) => [id, 0]))));
    let lines = lineCounts.get(kind);
    if (!lines) lineCounts.set(kind, (lines = new Map<string, number>()));
    /** The candidates with a face on each line. */
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
        if (used.has(c.key)) return null;
        let score = 0;
        for (const id of c.unitIds) {
          if ((count.get(id) ?? 0) >= max) return null;
          if (needs(c, id)) score++;
        }
        if (score === 0) return null;
        if (floor && !floor.allows(c)) {
          for (const id of c.unitIds)
            if (needs(c, id)) {
              floored.add(id);
              flooredKinds.add(`${kind}|${id}`);
            }
          return null;
        }
        const blocked = c.blocked.get(kind);
        const disfavored = c.disfavored.get(kind);
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
            hinted: disfavored?.has(f.dir) ? 1 : 0,
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
        floor?.take(best);
        if (frontIndex) frontIndex[bestFace.front as number] = HATCH_PRIORITY.indexOf(kind);
        else frontMap.set(bestFace.front, kind);
        for (const id of best.unitIds) count.set(id, (count.get(id) ?? 0) + 1);
        served(best);
        hatches.push({
          kind,
          cell: best.pos,
          face: bestFace.dir,
          unitIds: [...best.unitIds],
          ...(key !== undefined ? { key } : {}),
        });
        for (const k of faceKeys[now.i][now.face]) {
          lines.set(k, (lines.get(k) ?? 0) + 1);
          for (const i of onLine.get(k) ?? []) {
            const e = evaluate(i);
            if (e) heap.push(e);
          }
        }
      }
    };

    return { count, pass, floored };
  };

  const legacy = (kind: HatchKind, ki: number): void => {
    const later = kinds.slice(ki + 1);
    const { target, max } = quota(def, kind, any.get(kind));
    if (target <= 0) return;
    const { count, pass } = setup(kind, later, max, () => true);
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

    for (const id of unitIds) {
      const short = Math.max(target - (count.get(id) ?? 0), missing.get(id) ?? 0);
      for (let n = 0; n < short; n++) unplaced.push({ unitId: id, kind });
    }
  };

  /**
   * Per kind and key: the units any of its stages names (a fluid hatch is one fluid's), and the hatches placed
   * for it, with the units that already counted one of them toward a stage.
   */
  const groupOf = (st: Stage): string => `${st.kind}|${st.key ?? ''}`;
  const union = new Map<string, Set<number>>();
  const made = new Map<string, { cell: string; units: number[]; used: Set<number> }[]>();
  for (const st of stages ?? []) {
    const g = groupOf(st);
    const set = union.get(g) ?? union.set(g, new Set()).get(g)!;
    for (const id of st.units) set.add(id);
  }
  const siteAt = new Map(sites.map((s) => [s.pos.join(), s]));

  const requested = (st: Stage, si: number, all: readonly Stage[]): void => {
    const later = [...new Set(all.slice(si + 1).map((x) => x.kind))].filter((k) => k !== st.kind);
    const fluid = FLUID_KINDS.includes(st.kind);
    const g = groupOf(st);
    const { max } = quota(def, st.kind);
    // A cell may hold a fluid hatch when every unit on it takes that fluid (some stage of the same kind and
    // key names it). A hatch an earlier stage of the same kind and key placed, on a cell in this stage's zone,
    // that serves a unit of this stage (and no earlier stage of the unit used it) counts for that unit.
    const { count, pass, floored } = setup(
      st.kind,
      later,
      max,
      (s) =>
        (st.zone === undefined || s.unitIds.every((id) => inZone(s, id, st.zone!))) &&
        (!fluid || s.unitIds.every((id) => union.get(g)!.has(id))),
      st.key,
    );
    const earlier = made.get(g) ?? made.set(g, []).get(g)!;
    const done = new Set<number>();
    for (const id of [...st.units].sort((a, b) => a - b)) {
      const h = earlier.find(
        (e) =>
          e.units.includes(id) &&
          !e.used.has(id) &&
          (st.zone === undefined || inZone(siteAt.get(e.cell)!, id, st.zone)),
      );
      if (h) {
        h.used.add(id);
        done.add(id);
      }
    }
    pass(
      (_, id) => st.units.has(id) && !done.has(id),
      (site) => {
        const used = new Set<number>();
        for (const id of site.unitIds) {
          if (st.units.has(id) && !done.has(id)) used.add(id);
          done.add(id);
        }
        earlier.push({ cell: site.pos.join(), units: site.unitIds, used });
      },
    );
    for (const id of [...st.units].sort((a, b) => a - b)) {
      if (done.has(id)) continue;
      const entry: UnplacedHatch = { unitId: id, kind: st.kind };
      if (st.key !== undefined) entry.key = st.key;
      entry.reason = (count.get(id) ?? 0) >= max ? 'max' : floored.has(id) ? 'casings' : 'noCell';
      unplaced.push(entry);
    }
  };

  if (stages) stages.forEach(requested);
  else kinds.forEach(legacy);
  const result: PlaceResult = { hatches, unplaced };
  if (capacity.length > 0) {
    result.capacity = capacity;
    if (stages) {
      // Only a hatch its unit's cells are too few for (per kind) is blamed on capacity.
      for (const u of unplaced) {
        const short = lacking.get(u.unitId);
        const left = u.reason === 'noCell' ? (short?.get(u.kind) ?? 0) : 0;
        if (left > 0) {
          u.reason = 'capacity';
          short!.set(u.kind, left - 1);
        }
      }
    }
  }
  if (stages) {
    // Required regions (e.g. a Distillation Tower layer) that no placed hatch of the kind serves the unit in.
    for (const kind of kinds)
      for (const region of def.requiredHatches?.[kind]?.regions ?? [])
        for (const id of unitIds) {
          if (!stages.some((st) => st.kind === kind && st.units.has(id))) continue;
          const ok = hatches.some(
            (h) =>
              h.kind === kind &&
              h.unitIds.includes(id) &&
              siteAt.get(h.cell.join())?.regions.get(id) === region,
          );
          if (!ok) unplaced.push({ unitId: id, kind, reason: 'required', region });
        }
  }
  if (!stages && !mandatoryFirst && unplaced.some((u) => flooredKinds.has(`${u.kind}|${u.unitId}`))) {
    const again = place(def, units, kinds, avoid, below, toward, stages, true);
    const cost = (r: PlaceResult) => [r.unplaced.filter((u) => must(u.kind)).length, r.unplaced.length];
    const [a, b] = [cost(again), cost(result)];
    if (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])) return again;
  }
  return result;
}
