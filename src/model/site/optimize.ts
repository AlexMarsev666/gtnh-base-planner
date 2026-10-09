import { annealGroups, type AnnealOptions } from './anneal';
import { localFootprints, localHeights } from './build';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import { groupShapes } from './shapes';
import type { SiteGroup, SiteState } from './types';

/**
 * Optimises an arranged site in two stages, and keeps whatever the real router likes best.
 *
 * 1. Explore: anneal the groups' places from several seeds on a cheap estimate of pipe length
 *    (`annealGroups`), then route the start layout and the results, best estimate first. The estimate cannot
 *    see hatches or walls, so it is only good for finding candidates: its best layout often routes worse than
 *    the start.
 * 2. Polish: anneal again from the best layout found, this time judging every step by the router itself
 *    (`scoreBuild`, cached per layout), for a number of steps or what is left of the time budget.
 *
 * One time budget covers it all. Routing one layout takes from milliseconds to seconds (a plan of a thousand
 * machines needs several), so the first routing of the start layout sets the pace: fewer candidates are
 * routed and the polish is skipped when it could make only a few steps. The budget is met to within one
 * routing.
 *
 * Groups of several units may also be packed another way (other `limits`: rows, layers; see `groupShapes`), and
 * the result says how many were. Runs alternate between allowing that and keeping every packing: repacking
 * widens the spread of results more than it moves the median, and the best layout wins either way.
 *
 * Ranking, in order: build problems (overlaps, groups outside, ...), terminals left unconnected, surface
 * blocks, bends, pipe and cable blocks, then the width + depth of the layout. The start wins ties, so the result is never worse than
 * the arrangement it was given.
 */

export interface OptimizeOptions extends Pick<AnnealOptions, 'iterations' | 'now'> {
  /** Milliseconds for the whole search, including the routing of the start layout. Default `DEFAULT_BUDGET_MS`. */
  budgetMs?: number;
  /** Shifts every random seed, so a run can be repeated differently. Default 0. */
  seedOffset?: number;
  /** Explore runs, from seeds 1 to `seeds`. Default `DEFAULT_SEEDS`. */
  seeds?: number;
  /** Let groups be repacked with other limits (units along X and Z, layers). Default true. */
  reshape?: boolean;
  /** Whether the site is built with connections from below (see `SiteBuildOptions.below`). */
  below?: boolean;
  /** Router-judged steps per polish run; 0 skips the polish. Default `DEFAULT_REFINE_STEPS`. */
  refineSteps?: number;
  /** Polish runs, one after the other from the best layout so far. Default `DEFAULT_REFINE_RUNS`. */
  refineRuns?: number;
  /** Start temperature of a polish run (see `AnnealOptions.heat`). Default `DEFAULT_REFINE_HEAT`. */
  refineHeat?: number;
}

export const DEFAULT_SEEDS = 4;
export const DEFAULT_REFINE_STEPS = 500;
export const DEFAULT_REFINE_RUNS = 2;
export const DEFAULT_BUDGET_MS = 10000;

/** Shares of the budget: the estimate runs, and all routing of candidates, may use this much before the polish. */
/** Share of the budget for measuring other packings of the groups. */
const SHAPES_SHARE = 0.15;
const EXPLORE_SHARE = 0.3;
const CANDIDATE_SHARE = 0.5;
/** The polish is skipped when what is left of the budget would buy fewer router-judged steps than this. */
const MIN_POLISH_STEPS = 8;

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
    problems: build.warnings.filter((w) => w.type !== 'unrouted' && w.type !== 'assignment').length,
    unconnected: build.stats.terminals - build.stats.connected,
    blocks: build.stats.pipeBlocks + build.stats.cableBlocks,
    span: x1 > x0 ? x1 - x0 + (z1 - z0) : 0,
    ...(build.stats.surfaceBlocks === undefined
      ? {}
      : { surface: build.stats.surfaceBlocks, bends: build.stats.bends ?? 0 }),
  };
}

/** Whether `a` is strictly better than `b`. */
export function better(a: LayoutScore, b: LayoutScore): boolean {
  for (const k of ['problems', 'unconnected', 'surface', 'bends', 'blocks', 'span'] as const)
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return (a[k] ?? 0) < (b[k] ?? 0);
  return false;
}

/** One number for the annealer, ordered like `better` for any realistic layout. */
export function scoreValue(s: LayoutScore): number {
  return (
    s.problems * 1e12 +
    s.unconnected * 1e8 +
    (s.surface ?? 0) * 1e5 +
    (s.bends ?? 0) * 100 +
    s.blocks +
    0.1 * s.span
  );
}

export function optimizeSite(
  site: SiteState,
  builder: SiteBuilder,
  opts: OptimizeOptions = {},
): OptimizeResult {
  const below = !!opts.below;
  const now = opts.now ?? (() => performance.now());
  const began = now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const used = () => now() - began;
  // Many layouts of one site are built: keep every pack, then prune once at the end.
  const measured = builder(site, { pipes: true, cables: true, below, keepCache: true });
  const start = scoreBuild(measured);
  const routeMs = Math.max(1, used());
  if (used() >= budget)
    return {
      site,
      improved: false,
      start,
      result: start,
      tried: 0,
      reshaped: 0,
    };
  const footprints = localFootprints(measured);
  const heights = localHeights(measured);
  const sizeOf = (id: string) => footprints.get(id);
  const shapes =
    opts.reshape === false
      ? undefined
      : groupShapes(site, builder, below, {
          budgetMs: Math.min(budget - used(), budget * SHAPES_SHARE),
          now,
          deadline: Math.min(began + budget, now() + budget * SHAPES_SHARE),
          baseline: measured,
        });
  const heightOf = (id: string) => heights.get(id) ?? 1;

  /** The router's verdict on a layout, remembered: the annealer comes back to the same layouts often. */
  const scores = new Map<string, LayoutScore>();
  scores.set(layoutKey(site.groups), start);
  let best = { groups: site.groups, score: start };
  const route = (groups: SiteGroup[]): LayoutScore => {
    const key = layoutKey(groups);
    let score = scores.get(key);
    if (!score) {
      score = scoreBuild(builder({ ...site, groups }, { pipes: true, cables: true, below, keepCache: true }));
      scores.set(key, score);
    }
    // The scalar guides random search; every evaluated candidate is retained using the exact priorities.
    if (better(score, best.score)) best = { groups, score };
    return score;
  };

  const consider = (groups: SiteGroup[]) => {
    if (!scores.has(layoutKey(groups)) && used() >= budget) return;
    const score = route(groups);
    if (better(score, best.score)) best = { groups, score };
  };

  const offset = (opts.seedOffset ?? 0) * 1000;
  const seeds = Math.max(1, opts.seeds ?? DEFAULT_SEEDS);
  const candidates: { groups: SiteGroup[]; estimate: number }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    if (used() >= budget * EXPLORE_SHARE) break;
    const r = annealGroups(site, sizeOf, {
      seed: seed + offset,
      heightOf,
      shapes: seed % 2 === 1 ? shapes : undefined,
      iterations: opts.iterations,
      budgetMs: (budget * EXPLORE_SHARE) / seeds,
      deadline: began + budget * EXPLORE_SHARE,
      now: opts.now,
    });
    if (r.improved) candidates.push({ groups: r.groups, estimate: r.after });
  }
  // The best estimates first; at least one is routed, more while the budget allows.
  candidates.sort((a, b) => a.estimate - b.estimate);
  candidates.forEach((c, i) => {
    if ((i === 0 && used() < budget) || used() < budget * CANDIDATE_SHARE) consider(c.groups);
  });

  const steps = opts.refineSteps ?? DEFAULT_REFINE_STEPS;
  const runs = Math.max(1, opts.refineRuns ?? DEFAULT_REFINE_RUNS);
  if (steps > 0) {
    for (let run = 1; run <= runs; run++) {
      const left = budget - used();
      if (left < MIN_POLISH_STEPS * routeMs) break;
      const r = annealGroups({ ...site, groups: best.groups }, sizeOf, {
        seed: run + offset,
        heightOf,
        shapes: run % 2 === 1 ? shapes : undefined,
        iterations: steps,
        budgetMs: left / (runs - run + 1),
        deadline: began + budget,
        now: opts.now,
        heat: opts.refineHeat ?? DEFAULT_REFINE_HEAT,
        evaluate: (groups) => scoreValue(route(groups)),
      });
      if (r.improved) consider(r.groups);
    }
  }

  const improved = best.groups !== site.groups;
  // Back to the ordinary build, which drops the packs the result does not use.
  if (used() < budget)
    builder(improved ? { ...site, groups: best.groups } : site, { pipes: false, cables: false, below });
  return {
    site: improved ? { ...site, groups: best.groups } : site,
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
