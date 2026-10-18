import { step } from './geometry';
import { plainOf } from './layout/cache';
import type { HatchAvoid, HatchRequest, PlaceOptions, PlaceResult } from './hatches/types';
import { DEFAULT_TURN_COST, MAX_ROUNDS, RESOLVE_POP_BUDGET, ROUTE_POP_CAP } from './routing/constants';
import type { RouteOptions, WorkBudget } from './routing/types';
import type { Vec3 } from './core/types';
import type { HatchKind, MultiblockDef, PlanLimits, Unit } from './multiblock/types';
import type { HatchPlacement, PackResult } from './plan/types';
import type { RouteNet } from './routing/routeNet';

export interface LayoutDeps {
  placeHatches: (
    def: MultiblockDef,
    units: Unit[],
    enabled: HatchKind[],
    avoid?: HatchAvoid,
    opts?: PlaceOptions,
  ) => PlaceResult;
  layoutCandidates: (def: MultiblockDef, count: number, limits: PlanLimits) => Iterable<Unit[]>;
}

export interface ResolvedLayout {
  pack: PackResult;
  hatches: PlaceResult;
  /** True when a looser layout than the most compact one was chosen to fit every hatch. */
  loosened: boolean;
}

/** How many alternative layouts to try before settling for the one with the fewest unplaced hatches. */
export const MAX_LAYOUT_TRIES = 96;

/** `deps.placeHatches` with an explicit hatch list (see `PlaceOptions.requests`), or the plain call without. */
function placeWith(
  deps: LayoutDeps,
  def: MultiblockDef,
  units: Unit[],
  enabled: HatchKind[],
  requests: readonly HatchRequest[] | undefined,
  avoid?: HatchAvoid,
): PlaceResult {
  if (!requests)
    return avoid ? deps.placeHatches(def, units, enabled, avoid) : deps.placeHatches(def, units, enabled);
  return deps.placeHatches(def, units, enabled, avoid, { requests });
}

/**
 * Pick the most compact layout on which every enabled hatch can be placed.
 *
 * The densest packing shares the most walls, but it can leave a unit without enough open, unshared cells
 * for hatches that cannot be shared (energy, maintenance, muffler). Starting from `base` (the compact
 * layout from `packUnits`) this walks `layoutCandidates` best-first and returns the first layout with no
 * unplaced hatches; if none of the first `maxTries` works, the one with the fewest unplaced hatches wins
 * (the earliest, i.e. most compact, on ties). Deterministic. `requests` places that explicit hatch list
 * instead of the enabled kinds (`PlaceOptions.requests`).
 */
export function resolveLayout(
  def: MultiblockDef,
  base: PackResult,
  enabled: HatchKind[],
  limits: PlanLimits,
  deps: LayoutDeps,
  maxTries = MAX_LAYOUT_TRIES,
  requests?: readonly HatchRequest[],
): ResolvedLayout {
  const first = placeWith(deps, def, base.units, enabled, requests);
  if (first.unplaced.length === 0 || base.units.length === 0) {
    return { pack: base, hatches: first, loosened: false };
  }
  // A deep or turned layout that cannot hold its hatches gives way to the plain layout it replaced, which is
  // then resolved as if it had been the base all along.
  const plain = plainOf.get(base.units);
  if (plain) {
    return resolveLayout(def, { ...base, units: plain }, enabled, limits, deps, maxTries, requests);
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
    const hatches = placeWith(deps, def, units, enabled, requests);
    const h = layers(units);
    // Fewest unplaced hatches first, then the lowest build (tall stacks are awkward in game), then rank.
    const better =
      hatches.unplaced.length < best.hatches.unplaced.length ||
      (hatches.unplaced.length === best.hatches.unplaced.length && h < best.layers);
    if (better) best = { units, hatches, layers: h };
    // A layout with every hatch placed on as few layers as the limits allow cannot be beaten by a later
    // (less compact) one.
    if (best.hatches.unplaced.length === 0 && best.layers <= fewestLayers) break;
  }
  const loosened = best.units !== base.units;
  return { pack: loosened ? { ...base, units: best.units } : base, hatches: best.hatches, loosened };
}

const terminalsOf = (nets: readonly RouteNet[]) => nets.reduce((n, r) => n + r.total, 0);

/** Number of distinct unit heights (stacked layers). */
function layers(units: Unit[]): number {
  return new Set(units.map((u) => u.origin[1])).size;
}

function sameLayout(a: Unit[], b: Unit[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (u, i) =>
      u.rotation === b[i].rotation &&
      (u.variant ?? 0) === (b[i].variant ?? 0) &&
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
  /**
   * True when the work budget (see `RESOLVE_POP_BUDGET`) cut routing short and hatches are left
   * unconnected that more search might have connected.
   */
  truncated: boolean;
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

/** Kinds with at least one unconnected hatch. */
function kindsUnconnected(nets: readonly RouteNet[]): number {
  return nets.reduce((n, r) => n + (r.total > r.connected ? 1 : 0), 0);
}

/**
 * Whether routing `a` is strictly better than `b`: fewer unconnected hatches, then fewer kinds with any
 * unconnected hatch, then cheaper networks (`networkCost`). Equal keeps `b`.
 */
export function betterRouting(a: readonly RouteNet[], b: readonly RouteNet[]): boolean {
  return (
    (unconnected(a) - unconnected(b) ||
      kindsUnconnected(a) - kindsUnconnected(b) ||
      networkCost(a) - networkCost(b)) < 0
  );
}

/**
 * `resolveLayout`, then make sure every routed hatch gets its pipe or cable: when the chosen layout leaves
 * some hatch unconnected (typically a one-block walkway between rows of units that cannot hold a line per
 * kind), walk its `loosenings` from the most compact and take the first one on which every hatch is
 * placed (no more unplaced than before) and connected. At most `maxTries` looser layouts are routed, the
 * loosest always among them; if none connects everything, the layout with the fewest unplaced, then
 * unconnected hatches wins (the most compact on ties). All routing shares one work budget
 * (`RESOLVE_POP_BUDGET`, or `opts.budget`): once a run hit its cap or the budget cannot pay for another
 * run, the intermediate tries, hatch moves and the full-round reroute are skipped (the loosest layout is
 * still routed) and the result is `truncated` if hatches stay unconnected. Deterministic.
 */
export function resolveRoutedLayout(
  def: MultiblockDef,
  base: PackResult,
  enabled: HatchKind[],
  limits: PlanLimits,
  opts: RouteOptions,
  deps: RoutedLayoutDeps,
  maxTries = MAX_ROUTED_TRIES,
  requests?: readonly HatchRequest[],
): ResolvedRoutedLayout {
  const start = resolveLayout(def, base, enabled, limits, deps, undefined, requests);
  const budget: WorkBudget = opts.budget ?? { limit: RESOLVE_POP_BUDGET, used: 0 };
  const trial = { ...opts, budget, rounds: Math.min(opts.rounds ?? TRIAL_ROUNDS, TRIAL_ROUNDS) };
  // The most pops one routing run took so far: what the next one is expected to cost.
  let routeCost = 0;
  let skipped = false;
  const route = (units: Unit[], hatches: PlaceResult) => {
    const before = budget.used;
    const nets = deps.routePipes(def, units, hatches.hatches, trial);
    routeCost = Math.max(routeCost, budget.used - before);
    return nets;
  };
  const first = route(start.pack.units, start.hatches);
  let best = { units: start.pack.units, hatches: start.hatches, pipes: first, missing: unconnected(first) };
  if (best.missing > 0 && maxTries > 0) {
    const looser = [...deps.loosenings(def, start.pack.units)];
    // The first tries in order, then the loosest (most room for pipes) if it was not reached.
    const tries =
      looser.length <= maxTries ? looser : [...looser.slice(0, maxTries - 1), looser[looser.length - 1]];
    for (let t = 0; t < tries.length; t++) {
      const units = tries[t];
      if (t < tries.length - 1 && (budget.capped || budget.used + 2 * routeCost > budget.limit)) {
        skipped = true;
        continue;
      }
      const hatches = placeWith(deps, def, units, enabled, requests);
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
    requests ? (d, u, e, a) => placeWith(deps, d, u, e, requests, a) : deps.placeHatches,
    // Tightly packed layouts with turned units have long branches everywhere, so moves would go on and on:
    // two passes are what plain layouts need.
    best.units.some((u) => u.variant) ? Math.min(2, hatchMoves(terminalsOf(best.pipes))) : undefined,
    () => {
      // Asked only while moves remain, so a refusal means the budget cut the moves short.
      const ok = !budget.capped && budget.used + routeCost <= budget.limit;
      if (!ok) skipped = true;
      return ok;
    },
  );
  if (improved.hatches !== best.hatches)
    best = {
      ...best,
      hatches: improved.hatches,
      pipes: improved.pipes,
      missing: unconnected(improved.pipes),
    };
  if (best.missing > 0 && trial.rounds !== opts.rounds) {
    // Nothing fit in the trial rounds: give the best layout the full negotiation, if the budget allows.
    const fullCost = Math.min(ROUTE_POP_CAP, (routeCost * (opts.rounds ?? MAX_ROUNDS)) / TRIAL_ROUNDS);
    if (!budget.capped && budget.used + fullCost <= budget.limit) {
      const pipes = deps.routePipes(def, best.units, best.hatches.hatches, { ...opts, budget });
      if (betterRouting(pipes, best.pipes)) best = { ...best, pipes, missing: unconnected(pipes) };
    } else skipped = true;
  }
  const truncated = best.missing > 0 && (budget.capped === true || skipped);
  if (best.units === start.pack.units)
    return { ...start, hatches: best.hatches, pipes: best.pipes, truncated };
  return {
    pack: { ...base, units: best.units },
    hatches: best.hatches,
    loosened: true,
    pipes: best.pipes,
    truncated,
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
 * more hatches are routed, see `hatchMoves`), and only while `afford()` says another run is affordable.
 * Deterministic.
 */
export function improveHatches(
  def: MultiblockDef,
  units: Unit[],
  enabled: HatchKind[],
  hatches: PlaceResult,
  pipes: RouteNet[],
  route: (hatches: PlaceResult) => RouteNet[],
  place: LayoutDeps['placeHatches'],
  maxMoves = hatchMoves(pipes.reduce((n, r) => n + r.total, 0)),
  afford: () => boolean = () => true,
): { hatches: PlaceResult; pipes: RouteNet[] } {
  let best = { hatches, pipes, missing: unconnected(pipes), cost: networkCost(pipes) };
  const avoid = new Map<HatchKind, Set<string>>();
  const tried = new Set<string>();
  for (let moves = 0; moves < maxMoves && afford();) {
    const next = longBranches(best.pipes).find((b) => !tried.has(`${b.kind}|${b.cell.join()}`));
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
