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
  /** Fully routed, independently checked result of the Neat command. */
  routingSummary?: { bends: number; surface: number; length: number; unconnected: number };
}

/**
 * `arrangeOnFloors` with the plain result the worker sends back. With `optimize`, an arrangement that fits
 * is then annealed and the best layout by the router's numbers is kept. `neat` enables neat routing,
 * retains packing limits and returns its routed summary; both are compared with the original mode.
 */
export function arrangeHere(
  site: SiteState,
  below: boolean,
  builder: ReturnType<typeof createSiteBuilder>,
  optimize = false,
  options?: OptimizeOptions,
  neat = false,
): Arranged {
  const buildOptions = { pipes: true, cables: true, below };
  const baseline = builder(site, buildOptions);
  const prepared: SiteState = neat
    ? { ...site, routing: { mode: 'neat', depth: site.routing?.depth ?? 3 } }
    : site;
  const r = arrangeOnFloors(prepared, builder, below, neat);
  const candidate = builder(r.site, buildOptions);
  const unsafe = (before: typeof baseline, after: typeof baseline) =>
    addsLayoutViolations(before, after) || scoreBuild(after).unconnected > scoreBuild(before).unconnected;
  const rejected = unsafe(baseline, candidate);
  const out: Arranged = {
    site: rejected || (neat && !r.arranged.fits) ? site : r.site,
    fits: r.arranged.fits,
    needed: r.arranged.needed,
    floors: r.arranged.floors,
    ...(rejected ? { rejected: true } : {}),
    ...(neat && r.arranged.fits && !rejected
      ? {
          routingSummary: {
            bends: candidate.stats.bends ?? 0,
            surface: candidate.stats.surfaceBlocks ?? 0,
            length: candidate.stats.pipeBlocks + candidate.stats.cableBlocks,
            unconnected: scoreBuild(candidate).unconnected,
          },
        }
      : {}),
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
