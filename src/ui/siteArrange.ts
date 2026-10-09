import type { SearchControl } from '../model/site/search';
import { arrangeOnFloors } from '../import/gtnhplanner';
import type { createSiteBuilder } from '../model/site/build';
import {
  optimizeSite,
  optimizeSiteAsync,
  type OptimizationProgress,
  type OptimizeResult,
  scoreBuild,
  type LayoutScore,
  type OptimizeOptions,
} from '../model/site/optimize';
import { addsLayoutViolations } from '../model/site/layoutViolations';
import type { SiteState } from '../model/site/types';

/** What optimising changed: the router's numbers for the user's original layout and for the result. */
export interface Optimized {
  /** Whether the search improved the user layout. */
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
 * Align and Neat arrange on floors. Optimize searches directly from the user layout.
 */
export function arrangeHere(
  site: SiteState,
  below: boolean,
  builder: ReturnType<typeof createSiteBuilder>,
  optimize = false,
  options?: OptimizeOptions,
  neat = false,
): Arranged {
  if (optimize) return optimizedResult(site, optimizeSite(site, builder, { ...options, below }));
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
  return out;
}

function optimizedResult(site: SiteState, result: OptimizeResult): Arranged {
  return {
    site: result.site,
    fits: true,
    needed: site.size,
    floors: new Set(site.groups.map((g) => g.elevation ?? 0)).size,
    optimized: result,
  };
}

export async function optimizeHere(
  site: SiteState,
  below: boolean,
  builder: ReturnType<typeof createSiteBuilder>,
  control: SearchControl<OptimizationProgress> = {},
): Promise<Arranged> {
  return optimizedResult(site, await optimizeSiteAsync(site, builder, { below }, control));
}
