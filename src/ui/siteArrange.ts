import { arrangeOnFloors } from '../import/gtnhplanner';
import type { createSiteBuilder } from '../model/site/build';
import {
  better,
  optimizeSite,
  scoreBuild,
  type LayoutScore,
  type OptimizeOptions,
} from '../model/site/optimize';
import { addsLayoutViolations, layoutViolations } from '../model/site/layoutViolations';
import type { SiteState } from '../model/site/types';

/** What optimising changed: the router's numbers for the user's original layout and for the result. */
export interface Optimized {
  /** Whether an annealed layout replaced the arranged one. */
  improved: boolean;
  start: LayoutScore;
  result: LayoutScore;
  /** Groups that were repacked with other limits. */
  reshaped: number;
  stopped?: 'time-limit';
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
  const unsafe = (before: typeof baseline, after: typeof baseline) =>
    addsLayoutViolations(before, after) || scoreBuild(after).unconnected > scoreBuild(before).unconnected;
  const rejected = unsafe(baseline, candidate);
  const out: Arranged = {
    site: rejected ? site : r.site,
    fits: r.arranged.fits,
    needed: r.arranged.needed,
    floors: r.arranged.floors,
    ...(rejected ? { rejected: true } : {}),
  };
  if (optimize && r.arranged.fits && !rejected) {
    const o = optimizeSite(out.site, builder, { ...options, below, alignRows: true });
    const start = scoreBuild(baseline);
    // The button also arranges first: compare with the user's original, including invalid originals.
    // An improvement must still allow the same canonical Arrange next time. Otherwise fixing an
    // existing collision here would make Arrange reject its old canonical result on the next click.
    if (
      !o.stopped &&
      better(o.result, start) &&
      (!(layoutViolations(candidate).length || scoreBuild(candidate).unconnected) ||
        !unsafe(builder(o.site, buildOptions), candidate))
    ) {
      out.site = o.site;
      out.optimized = { improved: true, start, result: o.result, reshaped: o.reshaped };
      delete out.rejected;
    } else {
      out.site = site;
      out.optimized = {
        improved: false,
        start,
        result: start,
        reshaped: 0,
        ...(o.stopped ? { stopped: o.stopped } : {}),
      };
    }
  } else if (optimize) {
    out.site = site;
  }
  return out;
}
