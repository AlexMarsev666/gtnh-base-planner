import { getSiteDef, isSingleBlock } from '../../data/generic';
import { FLOOR_CLEARANCE } from './arrange';
import { annealGroups, defaultIterations, type AnnealOptions } from './anneal';
import { localFaces, localFootprints, localHeights, localTerminals } from './build';
import type { SiteBuild, SiteBuildOptions, SiteBuilder } from './buildTypes';
import { AbortedError, throttledProgress, throwIfAborted } from './progress';
import { groupShapes } from './shapes';
import type { SiteGroup, SiteState } from './types';

export { AbortedError };

/**
 * Optimises an arranged site in two stages, and keeps whatever the real router likes best.
 *
 * 1. Explore: anneal the groups' places from several seeds on a cheap estimate of pipe length
 *    (`annealGroups`), then route the start layout and the results. The estimate cannot see hatches or
 *    walls, so it is only good for finding candidates: its best layout often routes worse than the start.
 * 2. Polish: anneal again from the best layout found, this time judging every step by the router itself
 *    (`scoreBuild`, cached per layout).
 *
 * Repeatable: the work is counted in iterations that grow with the size of the plan (`exploreIterations`,
 * `refineStepsFor`, `SHAPE_UNITS`), never in time, and the random numbers come from `seed`. The same site,
 * seed and options give the same result on any machine, unless the safety limit `limitMs` cuts the run
 * short; the result then says `truncated`. Strictly this holds per JavaScript engine: `Math.exp` and
 * `Math.pow` may differ in the last bit between engines, which can flip an annealing decision.
 *
 * Groups of several units may also be packed another way (other `limits`: rows, layers; see `groupShapes`), and
 * the result says how many were. Runs alternate between allowing that and keeping every packing: repacking
 * widens the spread of results more than it moves the median, and the best layout wins either way.
 *
 * Ranking, in order: build problems (overlaps, groups outside, ...), terminals left unconnected, pipe and
 * cable blocks less the structure blocks that shared walls save, then the width + depth of the layout. The start wins ties, so the result is never worse than
 * the arrangement it was given; when nothing beats it, it is returned as it is (`improved: false`). With a
 * `baseline` (the user's own layout) the result must also beat that, else the baseline is returned.
 */

export interface OptimizeOptions extends Pick<AnnealOptions, 'now'> {
  /** Estimate-annealing proposals per seed. Default `exploreIterations(groups, links)`. */
  iterations?: number;
  /**
   * Safety limit in milliseconds for the whole search, including the routing of the start layout. Not a
   * budget: a run that finishes inside it does not depend on it. Default `DEFAULT_LIMIT_MS`.
   */
  limitMs?: number;
  /** Random seed. Default `site.seed`, else 0. */
  seed?: number;
  /** Explore runs, from seeds 1 to `seeds`. Default `DEFAULT_SEEDS`. */
  seeds?: number;
  /** Let groups be repacked with other limits (units along X and Z, layers). Default true. */
  reshape?: boolean;
  /** Whether the site is built with connections from below (see `SiteBuildOptions.below`). */
  below?: boolean;
  /** Further build options (routing, ...), handed to every build of the search unchanged. */
  buildOptions?: Partial<Omit<SiteBuildOptions, 'pipes' | 'cables' | 'keepCache'>>;
  /** Router-judged steps per polish run; 0 skips the polish. Default `refineStepsFor(groups, machines)`. */
  refineSteps?: number;
  /** Polish runs, one after the other from the best layout so far. Default `DEFAULT_REFINE_RUNS`. */
  refineRuns?: number;
  /** Start temperature of a polish run (see `AnnealOptions.heat`). Default `DEFAULT_REFINE_HEAT`. */
  refineHeat?: number;
  /** Called with (work done, work in all), at most ~20 times a second; the last call has done = total. */
  onProgress?: (done: number, total: number) => void;
  /**
   * The user's layout the arrangement `site` came from, scored the same way. The result must strictly beat
   * the better of this and `site`; when nothing beats the baseline it is returned with `improved: false`
   * (and `start` is its score), and when only the arrangement does, the arrangement is returned as improved.
   */
  baseline?: SiteState;
  /** Aborting throws `AbortedError`; the site is left as it was given. */
  signal?: AbortSignal;
}

export const DEFAULT_SEEDS = 4;
export const DEFAULT_REFINE_RUNS = 2;
/** Fewest and most router-judged steps of a polish run. */
export const MIN_REFINE_STEPS = 20;
export const DEFAULT_REFINE_STEPS = 500;
/** Safety limit: about five times what the largest plans of a few dozen machines take. */
export const DEFAULT_LIMIT_MS = 60000;

/** Most estimate proposals per seed, and extra ones per link. */
const MAX_EXPLORE_ITERATIONS = 150000;
const EXPLORE_PER_LINK = 200;
/**
 * Router-judged steps in all (one polish run's share is `REFINE_WORK / DEFAULT_REFINE_RUNS`) per machine and
 * group: one routing costs about as much as the plan has machines and groups (roughly 2 ms each), so a plan
 * of any size is polished for about the same time, a few seconds.
 */
const REFINE_WORK = 5000;
/** Units (machines) of all groups that are measured in other packings; the smallest groups first. */
const SHAPE_UNITS = 150;
/** One routing or router-judged step counts this many estimate proposals in the progress. */
const ROUTE_WEIGHT = 40;

/** Estimate proposals per explore seed: grows with the groups and the links between them. */
export function exploreIterations(groups: number, links: number): number {
  return Math.min(MAX_EXPLORE_ITERATIONS, defaultIterations(groups) + EXPLORE_PER_LINK * links);
}

/**
 * Router-judged steps per polish run. A routing takes the longer the more machines and groups there are, so
 * the steps shrink with the plan (between `MIN_REFINE_STEPS` and `DEFAULT_REFINE_STEPS`): more steps would
 * only make a big plan wait, fewer a small one polish too little.
 */
export function refineStepsFor(groups: number, machines: number): number {
  const steps = Math.round(REFINE_WORK / DEFAULT_REFINE_RUNS / Math.max(1, groups + machines));
  return Math.min(DEFAULT_REFINE_STEPS, Math.max(MIN_REFINE_STEPS, steps));
}

/** Start temperature of a polish run, as a share of the typical uphill step of a random move. */
export const DEFAULT_REFINE_HEAT = 0.2;

/** What the router made of one layout. */
export interface LayoutScore {
  problems: number;
  unconnected: number;
  blocks: number;
  /** Structure blocks that walls shared between groups save (`SiteStats.sharedBlocks`). */
  shared?: number;
  span: number;
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
  /** The safety limit ended the search early: the result is the best so far, and a rerun may differ. */
  truncated: boolean;
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
    problems: build.warnings.filter((w) => w.type !== 'unrouted').length,
    unconnected: build.stats.terminals - build.stats.connected,
    blocks: build.stats.pipeBlocks + build.stats.cableBlocks,
    shared: build.stats.sharedBlocks,
    span: x1 > x0 ? x1 - x0 + (z1 - z0) : 0,
  };
}

/** Pipe and cable blocks less the structure blocks shared walls save: what the ranking counts. */
const netBlocks = (s: LayoutScore) => s.blocks - (s.shared ?? 0);

/** Whether `a` is strictly better than `b`. */
export function better(a: LayoutScore, b: LayoutScore): boolean {
  if (a.problems !== b.problems) return a.problems < b.problems;
  if (a.unconnected !== b.unconnected) return a.unconnected < b.unconnected;
  if (netBlocks(a) !== netBlocks(b)) return netBlocks(a) < netBlocks(b);
  return a.span !== b.span && a.span < b.span;
}

/** Radixes of `scoreValue`: no layout of the site has more unconnected terminals, blocks or span than these. */
export interface ScoreBounds {
  unconnected: number;
  blocks: number;
  span: number;
}

const MAX_UNCONNECTED = 1e4;

/**
 * Bounds for a site: pipes and cables fill at most width x depth x (highest group top + clearance + 4)
 * blocks, and the span is at most width + depth.
 */
export function scoreBounds(site: SiteState, heightOf: (id: string) => number): ScoreBounds {
  const [w, d] = site.size;
  const top = site.groups.reduce((t, g) => Math.max(t, (g.elevation ?? 0) + heightOf(g.id)), 0);
  return { unconnected: MAX_UNCONNECTED, blocks: w * d * (top + FLOOR_CLEARANCE + 4), span: w + d + 1 };
}

/**
 * One number for the annealer, ordered like `better` (problems, unconnected, blocks less shared, span) within
 * `bounds`. Every digit stays an exact integer: should the packed value pass `Number.MAX_SAFE_INTEGER`
 * (hundreds of problems on the largest sites), the problems are capped, which only blurs the order between
 * layouts that are all hopeless. The annealer needs a scalar, so no tuple compare is possible there. The blocks digit
 * is cut at zero (a layout whose walls save more than its pipes take is not ranked above one that saves exactly that).
 */
export function scoreValue(s: LayoutScore, bounds: ScoreBounds): number {
  const rest = (bounds.unconnected + 1) * (bounds.blocks + 1) * (bounds.span + 1);
  const problems = Math.min(s.problems, Math.floor(Number.MAX_SAFE_INTEGER / rest) - 1);
  return (
    ((problems * (bounds.unconnected + 1) + s.unconnected) * (bounds.blocks + 1) +
      Math.max(0, netBlocks(s))) *
      (bounds.span + 1) +
    s.span
  );
}

/** A 32-bit seed for run `index` of `stage`, mixed so no two (seed, stage, index) share a stream. */
function mixSeed(seed: number, stage: number, index: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(stage, 0x85ebca6b) ^ Math.imul(index, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function optimizeSite(
  site: SiteState,
  builder: SiteBuilder,
  opts: OptimizeOptions = {},
): OptimizeResult {
  const below = !!(opts.below ?? opts.buildOptions?.below);
  const now = opts.now ?? (() => performance.now());
  const began = now();
  const limit = opts.limitMs ?? DEFAULT_LIMIT_MS;
  const used = () => now() - began;
  const signal = opts.signal;
  const report = throttledProgress(opts.onProgress, now);
  const build = (s: SiteState, pipes: boolean) =>
    builder(s, { ...opts.buildOptions, pipes, cables: pipes, below, keepCache: true });
  throwIfAborted(signal);
  let result: SiteState = site;
  try {
    const found = search();
    // Back to the ordinary build, which drops the packs the result does not use.
    builder(result, { ...opts.buildOptions, pipes: false, cables: false, below });
    return found;
  } catch (err) {
    // An aborted search is not waited for; the packs are pruned by the next ordinary build.
    if (!(err instanceof AbortedError))
      builder(result, { ...opts.buildOptions, pipes: false, cables: false, below });
    throw err;
  }

  function search(): OptimizeResult {
    // Many layouts of one site are built: keep every pack, then prune once at the end.
    const measured = build(site, false);
    const footprints = localFootprints(measured);
    const heights = localHeights(measured);
    const ends = localTerminals(measured);
    const faces = localFaces(measured);
    const sizeOf = (id: string) => footprints.get(id);
    const heightOf = (id: string) => heights.get(id) ?? 1;
    const bounds = scoreBounds(site, heightOf);
    const shapes =
      opts.reshape === false ? undefined : groupShapes(shapeSite(site), builder, below, { signal });
    throwIfAborted(signal);

    const seeds = Math.max(1, opts.seeds ?? DEFAULT_SEEDS);
    const exploreSteps = opts.iterations ?? exploreIterations(site.groups.length, site.links.length);
    const steps =
      opts.refineSteps ??
      refineStepsFor(
        site.groups.length,
        site.groups.reduce((n, g) => n + g.count, 0),
      );
    const runs = Math.max(1, opts.refineRuns ?? DEFAULT_REFINE_RUNS);
    // Progress in estimate proposals; routings weigh more. Work that is skipped still counts as done.
    const total = ROUTE_WEIGHT * (1 + seeds + (steps > 0 ? runs * steps : 0)) + seeds * exploreSteps;
    let done = 0;

    let truncated = false;
    /** The router's verdict on a layout, remembered: the annealer comes back to the same layouts often. */
    const scores = new Map<string, LayoutScore>();
    const route = (groups: SiteGroup[]): LayoutScore => {
      const key = layoutKey(groups);
      let score = scores.get(key);
      if (!score) {
        throwIfAborted(signal);
        score = scoreBuild(build({ ...site, groups }, true));
        scores.set(key, score);
      }
      return score;
    };

    const start = route(site.groups);
    const baseline = opts.baseline && {
      site: opts.baseline,
      score: scoreBuild(build(opts.baseline, true)),
    };
    done += ROUTE_WEIGHT;
    report?.(done, total);
    let best = { groups: site.groups, score: start };
    const consider = (groups: SiteGroup[]) => {
      const score = route(groups);
      if (better(score, best.score)) best = { groups, score };
    };

    const seed = opts.seed ?? site.seed ?? 0;
    const candidates: { groups: SiteGroup[]; estimate: number }[] = [];
    for (let k = 1; k <= seeds; k++) {
      const r = annealGroups(site, sizeOf, {
        seed: mixSeed(seed, 1, k),
        heightOf,
        ends,
        faces,
        shapes: k % 2 === 1 ? shapes : undefined,
        iterations: exploreSteps,
        budgetMs: Math.max(0, limit - used()),
        now: opts.now,
        signal,
        onProgress: (n) => report?.(done + n, total),
      });
      done += exploreSteps;
      if (r.truncated) truncated = true;
      if (r.improved) candidates.push({ groups: r.groups, estimate: r.after });
    }
    // The best estimates first; all are routed (the limit permitting).
    candidates.sort((a, b) => a.estimate - b.estimate);
    for (const c of candidates) {
      if (used() >= limit) {
        truncated = true;
        break;
      }
      consider(c.groups);
    }
    done += ROUTE_WEIGHT * seeds;
    report?.(done, total);

    if (steps > 0) {
      for (let run = 1; run <= runs; run++) {
        if (used() >= limit) {
          truncated = true;
          break;
        }
        const r = annealGroups({ ...site, groups: best.groups }, sizeOf, {
          seed: mixSeed(seed, 2, run),
          heightOf,
          ends,
          faces,
          shapes: run % 2 === 1 ? shapes : undefined,
          iterations: steps,
          budgetMs: Math.max(0, limit - used()),
          now: opts.now,
          heat: opts.refineHeat ?? DEFAULT_REFINE_HEAT,
          evaluate: (groups) => scoreValue(route(groups), bounds),
          signal,
          onProgress: (n) => report?.(done + n * ROUTE_WEIGHT, total),
        });
        done += steps * ROUTE_WEIGHT;
        if (r.truncated) truncated = true;
        if (r.improved) consider(r.groups);
      }
    }
    report?.(total, total);

    const found = best.groups !== site.groups;
    if (baseline && !better(best.score, baseline.score)) {
      result = baseline.site;
      return {
        site: result,
        improved: false,
        start: baseline.score,
        result: baseline.score,
        tried: scores.size,
        reshaped: 0,
        truncated,
      };
    }
    const improved = found || !!baseline;
    result = found ? { ...site, groups: best.groups } : site;
    return {
      site: result,
      improved,
      start: baseline?.score ?? start,
      result: best.score,
      tried: scores.size - 1,
      reshaped: found ? best.groups.filter((g, i) => limitsKey(g) !== limitsKey(site.groups[i])).length : 0,
      truncated,
    };
  }
}

/**
 * The site as `groupShapes` should see it: groups beyond the first `SHAPE_UNITS` machines (smallest groups
 * first) are locked, so they are not measured. Counted in machines rather than milliseconds, so the same
 * site always gets the same shapes.
 */
function shapeSite(site: SiteState): SiteState {
  const open = new Set<string>();
  let units = 0;
  const order = site.groups
    .filter((g) => {
      const def = getSiteDef(g.multiblockId);
      return def && !isSingleBlock(def) && g.count >= 2 && !g.limitsLocked;
    })
    .sort((a, b) => a.count - b.count);
  for (const g of order) {
    if (units + g.count > SHAPE_UNITS) break;
    units += g.count;
    open.add(g.id);
  }
  return { ...site, groups: site.groups.map((g) => (open.has(g.id) ? g : { ...g, limitsLocked: true })) };
}

/** Elevation is not in the key: the search never changes it (each group keeps its floor). */
function layoutKey(groups: readonly SiteGroup[]): string {
  return groups.map((g) => `${g.origin[0]},${g.origin[1]},${g.rotation},${limitsKey(g)}`).join(';');
}

function limitsKey(g: SiteGroup): string {
  return `${g.limits.x}/${g.limits.y}/${g.limits.z}`;
}
