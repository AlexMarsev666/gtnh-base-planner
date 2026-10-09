import { derived, writable } from 'svelte/store';
import type { GtnhProject, ImportOptions, MachineChoice } from '../import/gtnhplanner';
import type { SiteBuildOptions } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import type { SceneModel } from '../model/render/types';
import { isolate, site, siteCables, sitePipes } from '../state/site';
import { connectBelow } from '../state/store';
import { withDimensions } from './dimensions';
import type { Arranged } from './siteArrange';
import { createSiteWorkerController, type ImportResult, type SiteResult } from './siteWorkerController';

export type { SiteResult } from './siteWorkerController';

/**
 * The built site; recomputes when the site or the pipe / cable toggles change (not on selection). Large
 * templates take seconds to pack and route, so the build runs in a worker: the last result stays on screen
 * (and `siteBusy` is true) until the new one arrives, with the groups shown before their pipes when routing
 * is slow. Changes made meanwhile are coalesced into one more build. Without workers (tests, old browsers,
 * a worker that fails to load) it builds right here. While the user moves groups (`holdRouting`), builds
 * skip routing: the groups follow at once and the pipes are routed when input has been quiet for a moment.
 */
export const siteBuild = writable<SiteResult>({ build: null, error: null }, () =>
  // Only while something shows the site (the machine view never builds it).
  derived([site, sitePipes, siteCables, connectBelow], (x) => x).subscribe(
    ([$site, $pipes, $cables, $below]) => request($site, { pipes: $pipes, cables: $cables, below: $below }),
  ),
);
/** A build has been running for a while for a site newer than the one shown. */
export const siteBusy = writable(false);

/** Quick builds do not flash the busy notice. */
const BUSY_DELAY_MS = 250;
let busyTimer: ReturnType<typeof setTimeout> | undefined;
function setBusy(on: boolean, now = false): void {
  if (on) {
    if (now) {
      clearTimeout(busyTimer);
      siteBusy.set(true);
    } else busyTimer ??= setTimeout(() => siteBusy.set(true), BUSY_DELAY_MS);
    return;
  }
  clearTimeout(busyTimer);
  busyTimer = undefined;
  siteBusy.set(false);
}

const controller = createSiteWorkerController({
  onBuild: (result) => siteBuild.set(result),
  onBusy: setBusy,
});

/** Pipes are not routed while the user is editing; they follow this long after the last edit. */
export const ROUTE_IDLE_MS = 600;
let quietAt = 0;
let latest: { site: SiteState; opts: SiteBuildOptions } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The user is moving or turning something: until input has paused for ROUTE_IDLE_MS, builds place the
 * groups without routing (fast), and the last routed pipes stay on screen, faded.
 */
export function holdRouting(): void {
  quietAt = Date.now() + ROUTE_IDLE_MS;
}

function request(s: SiteState, opts: SiteBuildOptions): void {
  latest = { site: s, opts };
  clearTimeout(idleTimer);
  const wait = quietAt - Date.now();
  if ((opts.pipes || opts.cables) && wait > 0) {
    idleTimer = setTimeout(() => {
      if (latest) controller.submit(latest.site, latest.opts, false);
    }, wait);
    controller.submit(s, { ...opts, pipes: false, cables: false }, true);
    return;
  }
  controller.submit(s, opts, false);
}

/**
 * Imports a GTNH Planner project into a new site (see `buildSiteFromGtnh`) in the build worker, so a large
 * chain does not freeze the page and the build that follows reuses the packed groups. The worker's current
 * job is dropped: the import replaces the site.
 */
export function importSite(
  project: GtnhProject,
  choices: Map<string, MachineChoice>,
  opts: ImportOptions,
): Promise<ImportResult> {
  return controller.importSite(project, choices, opts);
}

/**
 * Arranges a site inside its own size (on floors if the chain does not fit the ground, see `arrangeOnFloors`)
 * in the build worker: a big template can take seconds to measure. With `optimize` the arrangement is then
 * annealed and routed a few times, which takes longer.
 */
export function arrangeInSize(
  site: SiteState,
  below: boolean,
  optimize = false,
  neat = false,
): Promise<Arranged> {
  return controller.arrange(site, below, optimize, neat);
}

/** Pipes of the last routed build: shown faded while a pending build has none. */
let lastPipes: SceneModel['pipes'] = null;

/**
 * The scene with nets of every resource but the isolated one faded (cheap: no re-routing), and the
 * site's width and depth named beside its edges. While pipes wait for editing to pause, the last routed
 * ones are shown, all faded.
 */

export const siteScene = derived([siteBuild, isolate], ([$b, $iso]): SceneModel | null => {
  const scene = $b.build?.scene ?? null;
  if (!scene) return scene;
  if (!$b.pending) lastPipes = scene.pipes;
  else if (!scene.pipes && lastPipes) {
    const faded = lastPipes.map((p) => ({ ...p, dim: true }));
    return { ...(scene.site ? withDimensions(scene, [0, 0], scene.site.size, 0) : scene), pipes: faded };
  }
  const measured = scene.site ? withDimensions(scene, [0, 0], scene.site.size, 0) : scene;
  if (!scene.pipes) return measured;
  const nets = $b.build!.nets;
  const resourceOf = new Map(nets.map((n) => [n.id, n.resource]));
  return {
    ...measured,
    pipes: scene.pipes.map((p) => ({ ...p, dim: !!$iso && resourceOf.get(p.id ?? -1) !== $iso })),
  };
});
