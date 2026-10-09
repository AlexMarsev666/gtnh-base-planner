import { step, unitCells } from './geometry';
import { fixedHatchKinds } from './multiblock/fixedHatches';
import type { HatchAvoid } from './hatches/types';
import { DEFAULT_TURN_COST } from './routing/constants';
import type { RouteOptions } from './routing/types';
import type { Vec3 } from './core/types';
import type { HatchKind, MultiblockDef, PlanLimits, Unit } from './multiblock/types';
import type { HatchPlacement, HatchResult, PackResult } from './plan/types';
import type { RouteNet } from './routing/routeNet';

export interface LayoutDeps {
  placeHatches: (def: MultiblockDef, units: Unit[], enabled: HatchKind[], avoid?: HatchAvoid) => HatchResult;
  layoutCandidates: (def: MultiblockDef, count: number, limits: PlanLimits) => Iterable<Unit[]>;
}

export interface ResolvedLayout {
  pack: PackResult;
  hatches: HatchResult;
  /** True when a looser layout than the most compact one was chosen to fit every hatch. */
  loosened: boolean;
}

/** How many alternative layouts to try before settling for the one with the fewest unplaced hatches. */
export const MAX_LAYOUT_TRIES = 96;

/**
 * Pick the most compact layout on which every enabled hatch can be placed.
 *
 * The densest packing shares the most walls, but it can leave a unit without enough open, unshared cells
 * for hatches that cannot be shared (energy, maintenance, muffler). Starting from `base` (the compact
 * layout from `packUnits`) this walks `layoutCandidates` best-first and returns the first layout with no
 * unplaced hatches; if none of the first `maxTries` works, the one with the fewest unplaced hatches wins
 * (the earliest, i.e. most compact, on ties). Deterministic.
 */
export function resolveLayout(
  def: MultiblockDef,
  base: PackResult,
  enabled: HatchKind[],
  limits: PlanLimits,
  deps: LayoutDeps,
  maxTries = MAX_LAYOUT_TRIES,
): ResolvedLayout {
  const first = deps.placeHatches(def, base.units, enabled);
  if (first.unplaced.length === 0 || base.units.length === 0) {
    return { pack: base, hatches: first, loosened: false };
  }

  let best = { units: base.units, hatches: first, layers: layers(base.units) };
  // No layout within the limits has fewer layers than this.
  const cap = (v: number | null) =>
    v === null || !Number.isFinite(v) ? Infinity : Math.max(1, Math.floor(v));
  const perLayer = cap(limits.x) * cap(limits.z);
  const fewestLayers = Math.max(1, Math.ceil(base.units.length / perLayer));
  let tries = 0;
  for (const units of deps.layoutCandidates(def, base.placed, limits)) {
    if (sameLayout(units, base.units)) continue;
    if (tries++ >= maxTries) break;
    const hatches = deps.placeHatches(def, units, enabled);
    const h = layers(units);
    const mandatory = hatches.unplacedMandatory ?? [0, 0];
    const bestMandatory = best.hatches.unplacedMandatory ?? [0, 0];
    const priority = mandatory[0] - bestMandatory[0] || mandatory[1] - bestMandatory[1];
    // Never trade required interfaces for more optional resource hatches on another layout.
    const better =
      priority < 0 ||
      (priority === 0 &&
        (hatches.unplaced.length < best.hatches.unplaced.length ||
          (hatches.unplaced.length === best.hatches.unplaced.length && h < best.layers)));
    if (better) best = { units, hatches, layers: h };
    // A layout with every hatch placed on as few layers as the limits allow cannot be beaten by a later
    // (less compact) one.
    if (best.hatches.unplaced.length === 0 && best.layers <= fewestLayers) break;
  }
  const loosened = best.units !== base.units;
  return { pack: loosened ? { ...base, units: best.units } : base, hatches: best.hatches, loosened };
}

/** Number of distinct unit heights (stacked layers). */
function layers(units: Unit[]): number {
  return new Set(units.map((u) => u.origin[1])).size;
}

function sameLayout(a: Unit[], b: Unit[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (u, i) =>
      u.rotation === b[i].rotation &&
      !!u.mirrored === !!b[i].mirrored &&
      u.origin[0] === b[i].origin[0] &&
      u.origin[1] === b[i].origin[1] &&
      u.origin[2] === b[i].origin[2],
  );
}

export interface RoutedLayoutDeps extends LayoutDeps {
  routePipes: (
    def: MultiblockDef,
    units: Unit[],
    hatches: HatchPlacement[],
    opts: RouteOptions,
  ) => RouteNet[];
  /** Looser versions of a layout (same arrangement, wider walkways and gaps), most compact first. */
  loosenings: (def: MultiblockDef, units: Unit[]) => Iterable<Unit[]>;
}

export interface ResolvedRoutedLayout extends ResolvedLayout {
  /** The pipe and cable networks of the chosen layout. */
  pipes: RouteNet[];
}

/** How many looser layouts to route before settling for the one with the fewest unconnected hatches. */
export const MAX_ROUTED_TRIES = 12;

/**
 * Negotiation rounds for each layout tried: most layouts whose pipes fit settle in a few rounds, and the
 * rounds spent on ones that never settle are what makes resolving slow.
 */
export const TRIAL_ROUNDS = 8;

/** Hatches the networks leave unconnected. */
export function unconnected(nets: readonly RouteNet[]): number {
  return nets.reduce((n, r) => n + r.total - r.connected, 0);
}

/**
 * `resolveLayout`, then make sure every routed hatch gets its pipe or cable: when the chosen layout leaves
 * some hatch unconnected (typically a one-block walkway between rows of units that cannot hold a line per
 * kind), walk its `loosenings` from the most compact and take the first one on which every hatch is
 * placed (no more unplaced than before) and connected. At most `maxTries` looser layouts are routed, the
 * loosest always among them; if none connects everything, the layout with the fewest unplaced, then
 * unconnected hatches wins (the most compact on ties). Deterministic.
 */
export function resolveRoutedLayout(
  def: MultiblockDef,
  base: PackResult,
  enabled: HatchKind[],
  limits: PlanLimits,
  opts: RouteOptions,
  deps: RoutedLayoutDeps,
  maxTries = MAX_ROUTED_TRIES,
): ResolvedRoutedLayout {
  const start = resolveLayout(def, base, enabled, limits, deps);
  const trial = { ...opts, rounds: Math.min(opts.rounds ?? TRIAL_ROUNDS, TRIAL_ROUNDS) };
  const route = (units: Unit[], hatches: HatchResult) => deps.routePipes(def, units, hatches.hatches, trial);
  const first = route(start.pack.units, start.hatches);
  let best = { units: start.pack.units, hatches: start.hatches, pipes: first, missing: unconnected(first) };
  if (best.missing > 0 && maxTries > 0) {
    const looser = [...deps.loosenings(def, start.pack.units)];
    // The first tries in order, then the loosest (most room for pipes) if it was not reached.
    const tries =
      looser.length <= maxTries ? looser : [...looser.slice(0, maxTries - 1), looser[looser.length - 1]];
    for (const units of tries) {
      const hatches = deps.placeHatches(def, units, enabled);
      if (hatches.unplaced.length > best.hatches.unplaced.length) continue;
      const pipes = route(units, hatches);
      const missing = unconnected(pipes);
      if (hatches.unplaced.length < best.hatches.unplaced.length || missing < best.missing)
        best = { units, hatches, pipes, missing };
      if (best.missing === 0) break;
    }
  }
  // Move the hatches whose pipes run furthest, where that makes the networks cheaper.
  const improved = improveHatches(
    def,
    best.units,
    enabled,
    best.hatches,
    best.pipes,
    (h) => route(best.units, h),
    deps.placeHatches,
  );
  if (improved.hatches !== best.hatches)
    best = {
      ...best,
      hatches: improved.hatches,
      pipes: improved.pipes,
      missing: unconnected(improved.pipes),
    };
  if (best.missing > 0 && trial.rounds !== opts.rounds) {
    // Nothing fit in the trial rounds: give the best layout the full negotiation.
    const pipes = deps.routePipes(def, best.units, best.hatches.hatches, opts);
    const missing = unconnected(pipes);
    if (missing < best.missing) best = { ...best, pipes, missing };
  }
  if (best.units === start.pack.units) return { ...start, hatches: best.hatches, pipes: best.pipes };
  return {
    pack: { ...base, units: best.units },
    hatches: best.hatches,
    loosened: true,
    pipes: best.pipes,
  };
}

/** How many re-placements `improveHatches` tries at most (each places every hatch and routes once more). */
export const MAX_HATCH_MOVES = 6;

/**
 * Routed hatches `improveHatches` may spend its tries on: a build with more gets fewer tries (a routing
 * run grows with the hatches), so 60-unit builds try once and small ones up to `MAX_HATCH_MOVES` times.
 */
export const HATCH_MOVE_BUDGET = 240;

/** `improveHatches` tries for networks connecting `terminals` hatches. */
export function hatchMoves(terminals: number): number {
  return Math.max(1, Math.min(MAX_HATCH_MOVES, Math.floor(HATCH_MOVE_BUDGET / Math.max(1, terminals))));
}

/** A branch this long or shorter is as good as a hatch gets; its hatch is never moved. */
const SHORT_BRANCH = 2;

/** Bends along the networks' paths. */
function bends(nets: readonly RouteNet[]): number {
  let n = 0;
  for (const net of nets)
    for (const p of net.paths)
      for (let i = 2; i < p.length; i++)
        for (let a = 0; a < 3; a++)
          if (p[i][a] - p[i - 1][a] !== p[i - 1][a] - p[i - 2][a]) {
            n++;
            break;
          }
  return n;
}

/** What the networks cost, in pipe blocks: blocks plus the router's price of a bend. */
export function networkCost(nets: readonly RouteNet[]): number {
  return nets.reduce((n, r) => n + r.length, 0) + DEFAULT_TURN_COST * bends(nets);
}

/**
 * Routed hatches by the length of the branch that reaches them, longest first (branches of `SHORT_BRANCH`
 * blocks or less left out). A branch is the path that joined the hatch to its network.
 */
function longBranches(nets: readonly RouteNet[]): { kind: HatchKind; cell: Vec3; length: number }[] {
  const out: { kind: HatchKind; cell: Vec3; length: number }[] = [];
  for (const net of nets) {
    const ends = new Map<string, number>();
    for (const p of net.paths) if (p.length > 0) ends.set(p[p.length - 1].join(), p.length);
    for (const a of net.attachments ?? []) {
      const length = ends.get(step(a.cell, a.face).join()) ?? 0;
      if (length > SHORT_BRANCH) out.push({ kind: net.kind, cell: a.cell, length });
    }
  }
  // Longest first; ties by kind, then cell, so the order is deterministic.
  return out.sort(
    (a, b) =>
      b.length - a.length ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      a.cell[1] - b.cell[1] ||
      a.cell[2] - b.cell[2] ||
      a.cell[0] - b.cell[0],
  );
}

/**
 * Feedback from routing to hatch placement, which picks sites without knowing what their pipes will
 * cost: take the hatch with the longest branch, keep its cell free of its kind, place every hatch again
 * and route; keep the change when it places and connects as many hatches and the networks cost less
 * (`networkCost`), else undo it and try the next hatch. At most `maxMoves` tries (by default fewer the
 * more hatches are routed, see `hatchMoves`). Deterministic.
 */
export function improveHatches(
  def: MultiblockDef,
  units: Unit[],
  enabled: HatchKind[],
  hatches: HatchResult,
  pipes: RouteNet[],
  route: (hatches: HatchResult) => RouteNet[],
  place: LayoutDeps['placeHatches'],
  maxMoves = hatchMoves(pipes.reduce((n, r) => n + r.total, 0)),
): { hatches: HatchResult; pipes: RouteNet[] } {
  let best = { hatches, pipes, missing: unconnected(pipes), cost: networkCost(pipes) };
  const avoid = new Map<HatchKind, Set<string>>();
  const tried = new Set<string>();
  const fixed = new Set<string>();
  for (const unit of units)
    for (const cell of unitCells(def, unit))
      for (const kind of fixedHatchKinds(def, def.legend[cell.char])) fixed.add(`${kind}|${cell.pos.join()}`);
  for (let moves = 0; moves < maxMoves;) {
    const next = longBranches(best.pipes).find(
      (b) => !tried.has(`${b.kind}|${b.cell.join()}`) && !fixed.has(`${b.kind}|${b.cell.join()}`),
    );
    if (!next) break;
    moves++;
    const id = `${next.kind}|${next.cell.join()}`;
    tried.add(id);
    let cells = avoid.get(next.kind);
    if (!cells) avoid.set(next.kind, (cells = new Set()));
    cells.add(next.cell.join());
    const h = place(def, units, enabled, avoid);
    if (h.unplaced.length <= best.hatches.unplaced.length) {
      const p = route(h);
      const missing = unconnected(p);
      const cost = networkCost(p);
      if (
        h.unplaced.length < best.hatches.unplaced.length ||
        missing < best.missing ||
        (missing === best.missing && cost < best.cost)
      ) {
        best = { hatches: h, pipes: p, missing, cost };
        continue;
      }
    }
    cells.delete(next.cell.join());
  }
  return { hatches: best.hatches, pipes: best.pipes };
}
