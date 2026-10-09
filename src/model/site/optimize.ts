import { annealSteps, defaultIterations, type AnnealOptions } from './anneal';
import { localFootprints, localHeights } from './build';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import { shapeSteps } from './shapes';
import { finishSearch, runSearch, type SearchControl } from './search';
import { SURFACE_COST } from './router';
import { addsLayoutViolations, layoutViolationCount } from './layoutViolations';
import type { SiteGroup, SiteState } from './types';

/**
 * Optimises the current user layout in two stages, and keeps whatever the real router likes best.
 *
 * 1. Explore: anneal the groups' places from several seeds on a cheap estimate of pipe length
 *    (`annealGroups`), then route the start layout and the results, best estimate first. The estimate cannot
 *    see hatches or walls, so it is only good for finding candidates: its best layout often routes worse than
 *    the start.
 * 2. Polish: anneal again from the best layout found, this time judging every step by the router itself
 *    (`scoreBuild`, cached per layout), for a fixed number of iterations and runs.
 *
 * The seed, calibration counts, iteration counts and shape order determine the complete search. The shared
 * time limit is only a safety cutoff (within one synchronous routing). An interrupted search publishes no
 * partial winner and returns its input unchanged; elapsed time never changes temperature or iteration quotas.
 *
 * Groups of several units may also be packed another way (other `limits`: rows, layers; see `groupShapes`), and
 * the result says how many were. Runs alternate between allowing that and keeping every packing: repacking
 * widens the spread of results more than it moves the median, and the best layout wins either way.
 *
 * Ranking, in order: build problems (overlaps, groups outside, ...), terminals left unconnected, neat
 * routing cost (length + 4 per surface block + 8 per bend + depth penalty), surface, bends, length, then span.
 * Compact routing retains its existing length ranking. The start wins ties, so the result is never worse than
 * the user layout it was given.
 */

export interface OptimizeOptions extends Pick<AnnealOptions, 'iterations' | 'now'> {
  /** Milliseconds for the whole search, including the routing of the start layout. Default scales with groups and links (see `optimizationBudget`). */
  budgetMs?: number;
  /** Shifts every random seed, so a run can be repeated differently. Default 0. */
  seedOffset?: number;
  /** Explore runs, from seeds 1 to `seeds`. Default `DEFAULT_SEEDS`. */
  seeds?: number;
  /** Let groups be repacked with other limits (units along X and Z, layers). Default true. */
  reshape?: boolean;
  /** Whether the site is built with connections from below (see `SiteBuildOptions.below`). */
  below?: boolean;
  /** Router-judged steps per polish run; 0 skips the polish. Default scales with groups (see `optimizationBudget`). */
  refineSteps?: number;
  /** Polish runs, one after the other from the best layout so far. Default `DEFAULT_REFINE_RUNS`. */
  refineRuns?: number;
  /** Start temperature of a polish run (see `AnnealOptions.heat`). Default `DEFAULT_REFINE_HEAT`. */
  refineHeat?: number;
}

export const DEFAULT_SEEDS = 4;
export const DEFAULT_REFINE_RUNS = 2;
export const DEFAULT_BUDGET_MS = 10000;

/** Start temperature of a polish run, as a share of the typical uphill step of a random move. */
export const DEFAULT_REFINE_HEAT = 0.2;

/** What the router made of one layout. */
export interface LayoutScore {
  problems: number;
  unconnected: number;
  blocks: number;
  span: number;
  surface?: number;
  bends?: number;
  routingCost?: number;
}

export interface OptimizeResult {
  site: SiteState;
  /** Whether an optimised layout replaced the start. */
  improved: boolean;
  /** The start layout, and the one returned. */
  start: LayoutScore;
  result: LayoutScore;
  /** Different layouts that were routed and compared. */
  tried: number;
  /** Groups that were repacked (their limits differ from the start's). */
  reshaped: number;
  /** Interrupted searches retain the original, never a machine-speed-dependent partial winner. */
  stopped?: 'time-limit';
}

export function scoreBuild(build: SiteBuild): LayoutScore {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const pg of build.groups) {
    x0 = Math.min(x0, pg.min[0]);
    x1 = Math.max(x1, pg.max[0]);
    z0 = Math.min(z0, pg.min[2]);
    z1 = Math.max(z1, pg.max[2]);
  }
  return {
    // Unrouted nets are counted by `unconnected`, terminal by terminal; `problems` are the rest.
    problems: layoutViolationCount(build),
    unconnected: build.stats.terminals - build.stats.connected,
    blocks: build.stats.pipeBlocks + build.stats.cableBlocks,
    span: x1 > x0 ? x1 - x0 + (z1 - z0) : 0,
    ...(build.stats.surfaceBlocks === undefined
      ? {}
      : {
          surface: build.stats.surfaceBlocks,
          bends: build.stats.bends ?? 0,
          routingCost:
            build.stats.pipeBlocks +
            build.stats.cableBlocks +
            SURFACE_COST * build.stats.surfaceBlocks +
            8 * (build.stats.bends ?? 0) +
            (build.stats.depthPenalty ?? 0),
        }),
  };
}

/** Whether `a` is strictly better than `b`. */
export function better(a: LayoutScore, b: LayoutScore): boolean {
  for (const k of ['problems', 'unconnected', 'routingCost', 'surface', 'bends', 'blocks', 'span'] as const)
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return (a[k] ?? 0) < (b[k] ?? 0);
  return false;
}

/** One number for the annealer, ordered like `better` for any realistic layout. */
export function scoreValue(s: LayoutScore): number {
  return (
    s.problems * 1e12 +
    s.unconnected * 1e8 +
    (s.routingCost === undefined
      ? (s.surface ?? 0) * 1e5 + (s.bends ?? 0) * 100 + s.blocks
      : s.routingCost * 1000) +
    0.1 * s.span
  );
}

export function* optimizeSteps(
  site: SiteState,
  builder: SiteBuilder,
  opts: OptimizeOptions = {},
): Generator<OptimizationProgress, OptimizeResult> {
  yield { percent: 0, tried: 0 };
  const below = !!opts.below;
  const now = opts.now ?? (() => performance.now());
  const began = now();
  const budget = opts.budgetMs ?? optimizationBudget(site).budgetMs;
  const used = () => now() - began;
  // Many layouts of one site are built: keep every pack, then prune once at the end.
  const measured = builder(site, { pipes: true, cables: true, below, keepCache: true });
  const start = scoreBuild(measured);
  const unchanged = (tried = 0): OptimizeResult => ({
    site,
    improved: false,
    start,
    result: start,
    tried,
    reshaped: 0,
    stopped: 'time-limit',
  });
  if (used() >= budget) return unchanged();
  const footprints = localFootprints(measured);
  const heights = localHeights(measured);
  const sizeOf = (id: string) => footprints.get(id);
  const shapes =
    opts.reshape === false
      ? undefined
      : yield* report(
          shapeSteps(site, builder, below, {
            now,
            deadline: began + budget,
            baseline: measured,
          }),
          () => ({ percent: 10, tried: 0 }),
        );
  const heightOf = (id: string) => heights.get(id) ?? 1;
  if (used() >= budget) return unchanged();

  /** The router's verdict on a layout, remembered: the annealer comes back to the same layouts often. */
  const scores = new Map<string, LayoutScore>();
  scores.set(layoutKey(site.groups), start);
  let best = { groups: site.groups, score: start };
  const interrupted = Symbol('search deadline');
  const route = (groups: SiteGroup[]): LayoutScore => {
    if (used() >= budget) throw interrupted;
    const key = layoutKey(groups);
    let score = scores.get(key);
    if (!score) {
      const built = builder({ ...site, groups }, { pipes: true, cables: true, below, keepCache: true });
      score = scoreBuild(built);
      if (addsLayoutViolations(measured, built) || score.unconnected > start.unconnected)
        score = { ...score, problems: Math.max(start.problems, score.problems) + 1 };
      scores.set(key, score);
      if (used() >= budget) throw interrupted;
    }
    // The scalar guides random search; every evaluated candidate is retained using the exact priorities.
    if (better(score, best.score)) best = { groups, score };
    return score;
  };

  const consider = (groups: SiteGroup[]) => {
    const score = route(groups);
    if (better(score, best.score)) best = { groups, score };
  };

  const offset = (opts.seedOffset ?? site.optimizationSeed ?? 0) * 1000;
  const seeds = Math.max(1, opts.seeds ?? DEFAULT_SEEDS);
  const candidates: { groups: SiteGroup[]; estimate: number }[] = [];
  try {
    for (let seed = 1; seed <= seeds; seed++) {
      if (used() >= budget) throw interrupted;
      const r = yield* report(
        annealSteps(site, sizeOf, {
          seed: seed + offset,
          heightOf,
          shapes: seed % 2 === 1 ? shapes : undefined,
          iterations: opts.iterations ?? optimizationBudget(site).iterations,
          deadline: began + budget,
          now,
        }),
        (fraction) => ({ percent: 20 + (35 * (seed - 1 + fraction)) / seeds, tried: scores.size - 1 }),
      );
      if (used() >= budget) throw interrupted;
      if (r.improved) candidates.push({ groups: r.groups, estimate: r.after });
    }
    // Route every candidate in a fixed order; a safety interruption discards the incomplete search.
    candidates.sort((a, b) => a.estimate - b.estimate);
    for (let i = 0; i < candidates.length; i++) {
      yield { percent: 55 + (5 * i) / candidates.length, tried: scores.size - 1 };
      consider(candidates[i].groups);
    }

    const steps = opts.refineSteps ?? optimizationBudget(site).refineSteps;
    const runs = Math.max(1, opts.refineRuns ?? DEFAULT_REFINE_RUNS);
    if (steps > 0) {
      for (let run = 1; run <= runs; run++) {
        if (used() >= budget) throw interrupted;
        const r = yield* report(
          annealSteps({ ...site, groups: best.groups }, sizeOf, {
            seed: run + offset,
            heightOf,
            shapes: run % 2 === 1 ? shapes : undefined,
            iterations: steps,
            deadline: began + budget,
            now,
            heat: opts.refineHeat ?? DEFAULT_REFINE_HEAT,
            evaluate: (groups) => scoreValue(route(groups)),
          }),
          (fraction) => ({ percent: 60 + (39 * (run - 1 + fraction)) / runs, tried: scores.size - 1 }),
        );
        if (used() >= budget) throw interrupted;
        if (r.improved) consider(r.groups);
      }
    }
  } catch (err) {
    if (err !== interrupted) throw err;
    return unchanged(scores.size - 1);
  }

  const improved = best.groups !== site.groups;
  // Back to the ordinary build, which drops the packs the result does not use.
  if (used() < budget)
    builder(improved ? { ...site, groups: best.groups } : site, { pipes: false, cables: false, below });
  if (used() >= budget) return unchanged(scores.size - 1);
  yield { percent: 100, tried: scores.size - 1 };
  return {
    site: improved
      ? {
          ...site,
          groups: best.groups.map((g, i) =>
            limitsKey(g) !== limitsKey(site.groups[i])
              ? { ...g, arrangeLimits: { ...(site.groups[i].arrangeLimits ?? site.groups[i].limits) } }
              : g,
          ),
        }
      : site,
    improved,
    start,
    result: best.score,
    tried: scores.size - 1,
    reshaped: improved ? best.groups.filter((g, i) => limitsKey(g) !== limitsKey(site.groups[i])).length : 0,
  };
}

function layoutKey(groups: readonly SiteGroup[]): string {
  return groups.map((g) => `${g.origin[0]},${g.origin[1]},${g.rotation},${limitsKey(g)}`).join(';');
}

function limitsKey(g: SiteGroup): string {
  return `${g.limits.x}/${g.limits.y}/${g.limits.z}`;
}

export interface OptimizationProgress {
  percent: number;
  tried: number;
}

/** Fixed quotas grow with the plan; elapsed time is only a safety ceiling. */
export function optimizationBudget(site: SiteState) {
  const groups = site.groups.length;
  return {
    iterations: defaultIterations(groups),
    refineSteps: Math.min(96, 12 + 4 * groups),
    budgetMs: Math.min(120000, Math.max(DEFAULT_BUDGET_MS, 1000 * groups + 250 * site.links.length)),
  };
}

function* report<P, T>(
  steps: Generator<P, T>,
  progress: (part: P) => OptimizationProgress,
): Generator<OptimizationProgress, T> {
  let step = steps.next();
  while (!step.done) {
    yield progress(step.value);
    step = steps.next();
  }
  return step.value;
}

export function optimizeSite(
  site: SiteState,
  builder: SiteBuilder,
  opts: OptimizeOptions = {},
): OptimizeResult {
  return finishSearch(optimizeSteps(site, builder, opts));
}

export function optimizeSiteAsync(
  site: SiteState,
  builder: SiteBuilder,
  opts: OptimizeOptions = {},
  control: SearchControl<OptimizationProgress> = {},
): Promise<OptimizeResult> {
  return runSearch(optimizeSteps(site, builder, opts), control);
}
