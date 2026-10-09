import {
  buildSiteFromGtnh,
  type GtnhProject,
  type ImportOptions,
  type ImportReport,
  type MachineChoice,
} from '../import/gtnhplanner';
import { createSiteBuilder } from '../model/site/build';
import type { SiteBuild, SiteBuildOptions } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { warnOnce } from './notices';
import { registerBuild } from './buildIdentity';
import { arrangeHere, type Arranged } from './siteArrange';
import type { SiteWorkerRequest, SiteWorkerResponse } from './siteWorker';

export interface SiteResult {
  requestId?: number;
  sourceRevision?: number;
  build: SiteBuild | null;
  error: string | null;
  /** The build has no pipes yet: they are routed once editing pauses (see `holdRouting`). */
  pending?: boolean;
}

export type ImportResult = { site: SiteState; report: ImportReport };

/** What the controller reports back: finished builds, and whether a build is taking a while. */
export interface SiteWorkerEvents {
  onBuild: (result: SiteResult) => void;
  /** `now`: show it at once (routing is known to be slow), else only if the build is not quick. */
  onBusy: (busy: boolean, now?: boolean) => void;
}

export interface SiteWorkerController {
  /** Builds `site`, replacing any build not started yet. `pending`: a build without pipes while editing. */
  submit: (site: SiteState, opts: SiteBuildOptions, pending: boolean) => void;
  /** Imports a project into a new site; drops the current job, which the import replaces. */
  importSite: (
    project: GtnhProject,
    choices: Map<string, MachineChoice>,
    opts: ImportOptions,
  ) => Promise<ImportResult>;
  /**
   * Arranges `site` inside its own size, on floors if need be; drops the current job, which it replaces. With
   * `optimize`, the arrangement is then annealed and the best layout by the router's numbers kept.
   */
  arrange: (site: SiteState, below: boolean, optimize?: boolean) => Promise<Arranged>;
}

type BuildRequest = {
  site: SiteState;
  opts: SiteBuildOptions;
  pending: boolean;
  requestId: number;
  sourceRevision: number;
};
interface PendingImport {
  project: GtnhProject;
  choices: Map<string, MachineChoice>;
  opts: ImportOptions;
  resolve: (r: ImportResult) => void;
  reject: (err: Error) => void;
}

interface PendingArrange {
  site: SiteState;
  below: boolean;
  optimize: boolean;
  resolve: (r: Arranged) => void;
  reject: (err: Error) => void;
}

/** The site build worker, or null where workers are unavailable. */
export function defaultSiteWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./siteWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * Runs site builds and imports in a worker, one at a time: while one runs, only the newest build request
 * waits (older ones are dropped). Without a worker (none available, or it fails to load, throws or sends
 * something unreadable) everything is done right here from then on, including the job the worker was on.
 */
export function createSiteWorkerController(
  events: SiteWorkerEvents,
  createWorker: () => Worker | null = defaultSiteWorker,
): SiteWorkerController {
  let worker: Worker | null = null;
  let workerFailed = false;
  let nextId = 0;
  /** What the worker is on, if anything. */
  let inFlight:
    | { id: number; build: BuildRequest }
    | { id: number; import: PendingImport }
    | { id: number; arrange: PendingArrange }
    | null = null;
  /** The newest build not sent yet. */
  let queued: BuildRequest | null = null;

  /** The builder used when there is no worker (shared with imports, so their packs are reused). */
  let localBuilder: ReturnType<typeof createSiteBuilder> | null = null;
  const here = () => (localBuilder ??= createSiteBuilder());

  function buildHere(req: BuildRequest): SiteResult {
    try {
      return {
        build: here()(req.site, req.opts),
        error: null,
        pending: req.pending,
        requestId: req.requestId,
        sourceRevision: req.sourceRevision,
      };
    } catch (err) {
      warnOnce('buildSite', err);
      return {
        build: null,
        error: err instanceof Error ? err.message : String(err),
        requestId: req.requestId,
        sourceRevision: req.sourceRevision,
      };
    }
  }

  function importHere(imp: PendingImport): void {
    try {
      imp.resolve(buildSiteFromGtnh(imp.project, imp.choices, imp.opts, here()));
    } catch (err) {
      imp.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function arrangeLocally(job: PendingArrange): void {
    try {
      job.resolve(arrangeHere(job.site, job.below, here(), job.optimize));
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** The worker cannot be used: finish what it was doing here, and build here from now on. */
  function fallBack(err: unknown): void {
    warnOnce('siteWorker', err);
    worker?.terminate();
    worker = null;
    workerFailed = true;
    const was = inFlight;
    inFlight = null;
    if (was && 'import' in was) importHere(was.import);
    if (was && 'arrange' in was) arrangeLocally(was.arrange);
    const req = queued ?? (was && 'build' in was ? was.build : null);
    queued = null;
    events.onBusy(false);
    if (req) events.onBuild(buildHere(req));
  }

  /** Drops whatever the worker is doing (its result is no longer wanted). */
  function stopWorker(): void {
    worker?.terminate();
    worker = null;
    const was = inFlight;
    inFlight = null;
    if (was && 'import' in was) was.import.reject(new Error('Import replaced by a newer one.'));
    if (was && 'arrange' in was) was.arrange.reject(new Error('Arrange replaced by a newer job.'));
  }

  function startWorker(): Worker | null {
    if (worker || workerFailed) return worker;
    let w: Worker | null;
    try {
      w = createWorker();
    } catch (err) {
      fallBack(err);
      return null;
    }
    if (!w) {
      workerFailed = true;
      return null;
    }
    worker = w;
    w.onmessage = (e: MessageEvent<SiteWorkerResponse>) => {
      const msg = e.data;
      const job = inFlight;
      if (!job || msg.id !== job.id) return;
      if ('partial' in msg && msg.partial) {
        // Groups first; the routed build of the same request is still coming.
        if (!queued && 'build' in job)
          events.onBuild({
            build: msg.build,
            error: null,
            pending: true,
            requestId: job.build.requestId,
            sourceRevision: job.build.sourceRevision,
          });
        events.onBusy(true, true);
        return;
      }
      inFlight = null;
      if ('import' in job) {
        if ('imported' in msg) job.import.resolve(msg.imported);
        else job.import.reject(new Error('error' in msg ? msg.error : 'Import failed'));
      } else if ('arrange' in job) {
        if ('arranged' in msg) job.arrange.resolve(msg.arranged);
        else job.arrange.reject(new Error('error' in msg ? msg.error : 'Arrange failed'));
      } else if ('error' in msg) {
        warnOnce('buildSite', msg.error);
        events.onBuild({
          build: null,
          error: msg.error,
          requestId: job.build.requestId,
          sourceRevision: job.build.sourceRevision,
        });
      } else if ('build' in msg)
        events.onBuild({
          build: msg.build,
          error: null,
          pending: job.build.pending,
          requestId: job.build.requestId,
          sourceRevision: job.build.sourceRevision,
        });
      sendQueued();
    };
    w.onerror = (e) => {
      e.preventDefault();
      fallBack(e.message || 'Site worker failed');
    };
    w.onmessageerror = () => fallBack('Site worker message could not be read');
    return w;
  }

  function post(w: Worker, msg: SiteWorkerRequest): void {
    try {
      w.postMessage(msg);
    } catch (err) {
      // Not cloneable (should not happen: sites and projects are plain data).
      fallBack(err);
    }
  }

  function sendQueued(): void {
    if (!queued) {
      events.onBusy(false);
      return;
    }
    // Taken before starting the worker: if that fails, `fallBack` finds nothing queued and it is built here.
    const req = queued;
    queued = null;
    const w = startWorker();
    if (!w) {
      events.onBuild(buildHere(req));
      events.onBusy(false);
      return;
    }
    inFlight = { id: req.requestId, build: req };
    post(w, {
      id: inFlight.id,
      sourceRevision: req.sourceRevision,
      type: 'build',
      site: req.site,
      opts: req.opts,
    });
  }

  return {
    submit(site, opts, pending) {
      const requestId = ++nextId;
      const req = { site, opts, pending, requestId, sourceRevision: registerBuild(site, requestId) };
      if (workerFailed) {
        events.onBuild(buildHere(req));
        return;
      }
      queued = req;
      events.onBusy(true);
      // The worker is busy with a site that is gone (an import or an opened file replaced it): drop that
      // build rather than wait for it. Its group cache would not help the new site anyway.
      if (inFlight && 'build' in inFlight && replaced(inFlight.build.site, site)) stopWorker();
      if (inFlight === null) sendQueued();
    },

    importSite(project, choices, opts) {
      return new Promise((resolve, reject) => {
        const imp: PendingImport = { project, choices, opts, resolve, reject };
        // Builds of the current site are no longer wanted either: the imported site replaces it.
        queued = null;
        if (inFlight) stopWorker();
        const w = workerFailed ? null : startWorker();
        if (!w) {
          importHere(imp);
          return;
        }
        inFlight = { id: ++nextId, import: imp };
        post(w, { id: inFlight.id, type: 'import', project, choices, opts });
      });
    },

    arrange(site, below, optimize = false) {
      return new Promise((resolve, reject) => {
        const job: PendingArrange = { site, below, optimize, resolve, reject };
        // Builds of the current site wait: the arrangement changes it.
        queued = null;
        if (inFlight) stopWorker();
        const w = workerFailed ? null : startWorker();
        if (!w) {
          arrangeLocally(job);
          return;
        }
        inFlight = { id: ++nextId, arrange: job };
        post(w, { id: inFlight.id, type: 'arrange', site, below, optimize });
      });
    },
  };
}

/** Whether `next` shares fewer than half of its groups (same id, machine and count) with `prev`. */
function replaced(prev: SiteState, next: SiteState): boolean {
  const key = (g: SiteState['groups'][number]) => `${g.id}|${g.multiblockId}|${g.count}`;
  const old = new Set(prev.groups.map(key));
  const kept = next.groups.filter((g) => old.has(key(g))).length;
  return kept * 2 < Math.max(next.groups.length, prev.groups.length);
}
