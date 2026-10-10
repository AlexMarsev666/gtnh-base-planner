import { derived, readable, writable, type Readable } from 'svelte/store';
import type { GtnhProject, ImportOptions, MachineChoice } from '../import/gtnhplanner';
import type { SiteBuild, SiteBuildOptions } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import type { SceneModel } from '../model/render/types';
import { appMode, isolate, site, siteCables, sitePipes } from '../state/site';
import { connectBelow } from '../state/store';
import { withDimensions } from './dimensions';
import type { Arranged } from './siteArrange';
import {
  createSiteWorkerController,
  JobCancelled,
  type ImportResult,
  type SiteResult,
} from './siteWorkerController';

export type { SiteResult } from './siteWorkerController';

/**
 * The built site; recomputes when the site or the pipe / cable toggles change (not on selection). Large
 * templates take seconds to pack and route, so the build runs in a worker: the last result stays on screen
 * (and `siteBusy` is true) until the new one arrives, with the groups shown before their pipes when routing
 * is slow. Changes made meanwhile are coalesced into one more build. Without workers (tests, old browsers,
 * a worker that fails to load) it builds right here. While the user moves groups (`holdRouting`), builds
 * skip routing: the groups follow at once and the pipes are routed when input has been quiet for a moment.
 */
export const siteBuild = writable<SiteResult>({ build: null, error: null }, () => {
  // Only while something shows the site (the machine view never builds it).
  const stop = derived([site, sitePipes, siteCables, connectBelow], (x) => x).subscribe(
    ([$site, $pipes, $cables, $below]) => request($site, { pipes: $pipes, cables: $cables, below: $below }),
  );
  return () => {
    stop();
    // Nothing shows the site any more: no stale request may be submitted later. A build already running
    // finishes (its groups stay cached for coming back).
    clearTimeout(idleTimer);
    idleTimer = undefined;
    latest = null;
    controller.dropQueued();
  };
});
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

let lastBuild: SiteBuild | null = null;

/**
 * The latest build, read without subscribing to `siteBuild` (a subscription starts building the whole
 * template). Null before the first build, or after one that failed.
 */
export function peekSiteBuild(): SiteBuild | null {
  return lastBuild;
}

const controller = createSiteWorkerController({
  onBuild: (result) => {
    lastBuild = result.build;
    siteBuild.set(result);
  },
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

/** Builds the latest requested site again (what a dropped import or arrange left stale on screen). */
export function resubmitLatest(): void {
  if (latest) request(latest.site, latest.opts);
}

/**
 * A failed or aborted job stopped the build of the displayed template; a job replaced by a newer one or by an
 * edit leaves that to whatever replaced it.
 */
function rebuildAfter(err: unknown): never {
  if (!(err instanceof JobCancelled) || err.reason === 'aborted') resubmitLatest();
  throw err;
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
  signal?: AbortSignal,
): Promise<ImportResult> {
  return controller.importSite(project, choices, opts, signal).catch(rebuildAfter);
}

/**
 * Arranges a site inside its own size (on floors if the chain does not fit the ground, see `arrangeOnFloors`)
 * in the build worker: a big template can take seconds to measure. With `optimize` the arrangement is then
 * annealed and routed a few times, which takes longer.
 */
export function arrangeInSize(site: SiteState, below: boolean, optimize = false): Promise<Arranged> {
  return controller.arrange(site, below, optimize).catch(rebuildAfter);
}

/** Forgets the pipes the scene keeps to show faded; set while something shows `siteScene`. */
let forgetLastPipes = () => {};

/**
 * A whole template was replaced (import, file, link, reset): a pending build of the new one must not show the
 * previous template's pipes.
 */
export function forgetPipes(): void {
  forgetLastPipes();
}

/**
 * The scene with nets of every resource but the isolated one faded (cheap: no re-routing), and the
 * site's width and depth named beside its edges. While pipes wait for editing to pause, the last routed
 * ones are shown, all faded.
 */
export const siteScene = readable<SceneModel | null>(null, (set) => {
  /** Pipes of the last routed build: shown faded while a pending build has none. */
  let lastPipes: SceneModel['pipes'] = null;
  forgetLastPipes = () => {
    lastPipes = null;
  };
  const stop = derived([siteBuild, isolate], ([$b, $iso]): SceneModel | null => {
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
  }).subscribe(set);
  return () => {
    stop();
    forgetLastPipes = () => {};
  };
});

/**
 * Follows `source` only while the site view is shown, so its subscription (and the builds it starts) ends
 * when the user goes back to the machine view; outside it holds `empty`.
 */
function inSiteView<T>(source: Readable<T>, empty: T): Readable<T> {
  return readable(empty, (set) => {
    let stopSource: (() => void) | undefined;
    const stopMode = appMode.subscribe(($mode) => {
      if ($mode === 'site' && !stopSource) stopSource = source.subscribe(set);
      else if ($mode !== 'site' && stopSource) {
        stopSource();
        stopSource = undefined;
        set(empty);
      }
    });
    return () => {
      stopMode();
      stopSource?.();
    };
  });
}

/** `siteBuild` while the site view is shown; empty in the machine view. */
export const siteBuildInView = inSiteView<SiteResult>(siteBuild, { build: null, error: null });
/** `siteScene` while the site view is shown; null in the machine view. */
export const siteSceneInView = inSiteView<SceneModel | null>(siteScene, null);
