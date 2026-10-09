import { arrangeOnFloors } from '../import/gtnhplanner';
import type { createSiteBuilder } from '../model/site/build';
import { optimizeSite, scoreBuild, type LayoutScore, type OptimizeOptions } from '../model/site/optimize';
import { addsLayoutViolations } from '../model/site/layoutViolations';
import type { SiteState } from '../model/site/types';

/** What optimising changed: the router's numbers for the user's original layout and for the result. */
export interface Optimized {
  /** Whether an annealed layout replaced the arranged one. */
  improved: boolean;
  start: LayoutScore;
  result: LayoutScore;
  /** Groups that were repacked with other limits. */
  reshaped: number;
}

/** A site arranged inside its own size (see `arrangeOnFloors`). */
export interface Arranged {
  site: SiteState;
  fits: boolean;
  needed: [number, number];
  floors: number;
  /** Present when the arrangement was optimised as well (see `optimizeSite`). */
  optimized?: Optimized;
  /** The proposed arrangement added build violations; the original layout was retained. */
  rejected?: boolean;
}

/**
 * `arrangeOnFloors` with the plain result the worker sends back. With `optimize`, an arrangement that fits
 * is then annealed and the best layout by the router's numbers is kept.
 */
export function arrangeHere(
  site: SiteState,
  below: boolean,
  builder: ReturnType<typeof createSiteBuilder>,
  optimize = false,
  options?: OptimizeOptions,
): Arranged {
  const buildOptions = { pipes: true, cables: true, below };
  const baseline = builder(site, buildOptions);
  const r = arrangeOnFloors(site, builder, below);
  const candidate = builder(r.site, buildOptions);
  const rejected = addsLayoutViolations(baseline, candidate);
  const out: Arranged = {
    site: rejected ? site : r.site,
    fits: r.arranged.fits,
    needed: r.arranged.needed,
    floors: r.arranged.floors,
    ...(rejected ? { rejected: true } : {}),
  };
  if (optimize && r.arranged.fits) {
    const o = optimizeSite(out.site, builder, { ...options, below });
    const start = scoreBuild(baseline);
    // The button also arranges first: compare with the user's original, including invalid originals.
    if (o.result.problems <= start.problems) {
      out.site = o.site;
      out.optimized = { improved: o.improved, start, result: o.result, reshaped: o.reshaped };
      delete out.rejected;
    } else {
      out.site = site;
      out.rejected = true;
    }
  }
  return out;
}
