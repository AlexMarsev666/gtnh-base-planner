import { arrangeOnFloors } from '../import/gtnhplanner';
import type { createSiteBuilder } from '../model/site/build';
import { optimizeSite, type LayoutScore } from '../model/site/optimize';
import type { SiteRouting, SiteState } from '../model/site/types';

/** What optimising changed: the router's numbers for the arrangement it started from, and for the result. */
export interface Optimized {
  /** Whether an annealed layout replaced the arranged one. */
  improved: boolean;
  start: LayoutScore;
  result: LayoutScore;
  /** Groups that were repacked with other limits. */
  reshaped: number;
  /** The safety limit ended the search early: the result is the best so far, and a rerun may differ. */
  truncated: boolean;
}

/**
 * Progress of an arrange or optimise run on one scale that never goes backwards (`total` is fixed): with
 * `optimize` the arrangement takes the first tenth and the search the rest, else the arrangement takes it all.
 */
export interface ArrangeProgress {
  done: number;
  total: number;
  /** What is running now. */
  phase: 'arrange' | 'optimize';
}

const PROGRESS_TOTAL = 1000;
const ARRANGE_SHARE = 0.1;

/** Hatches may face down and pipes run under the ground exactly when the routing goes underground. */
export function belowOf(routing: SiteRouting): boolean {
  return routing.depth > 0;
}

/** A site arranged inside its own size (see `arrangeOnFloors`). */
export interface Arranged {
  site: SiteState;
  fits: boolean;
  needed: [number, number];
  floors: number;
  /** Present when the arrangement was optimised as well (see `optimizeSite`). */
  optimized?: Optimized;
}

/**
 * `arrangeOnFloors` with the plain result the worker sends back. With `optimize`, an arrangement that fits
 * is then annealed and the best layout by the router's numbers is kept.
 */
export function arrangeHere(
  site: SiteState,
  routing: SiteRouting,
  builder: ReturnType<typeof createSiteBuilder>,
  optimize = false,
  { onProgress, signal }: { onProgress?: (p: ArrangeProgress) => void; signal?: AbortSignal } = {},
): Arranged {
  // The arrangement and the search build with the same options as the final build of the site.
  const below = belowOf(routing);
  // The arrangement may measure twice (each with its own 0..total), the search has its own too: map them all
  // onto one scale, and never report less than before.
  let last = 0;
  const report =
    onProgress &&
    ((phase: ArrangeProgress['phase'], from: number, to: number) => (done: number, total: number) => {
      const at = Math.max(last, Math.round(PROGRESS_TOTAL * (from + (to - from) * (done / (total || 1)))));
      last = at;
      onProgress({ done: at, total: PROGRESS_TOTAL, phase });
    });
  const r = arrangeOnFloors(site, builder, below, {
    onProgress: report?.('arrange', 0, optimize ? ARRANGE_SHARE : 1),
    signal,
  });
  const out: Arranged = {
    site: r.site,
    fits: r.arranged.fits,
    needed: r.arranged.needed,
    floors: r.arranged.floors,
  };
  if (optimize && r.arranged.fits) {
    const o = optimizeSite(r.site, builder, {
      seed: site.seed,
      buildOptions: { routing },
      below,
      signal,
      onProgress: report?.('optimize', ARRANGE_SHARE, 1),
    });
    out.site = o.site;
    out.optimized = {
      improved: o.improved,
      start: o.start,
      result: o.result,
      reshaped: o.reshaped,
      truncated: o.truncated,
    };
  }
  return out;
}
