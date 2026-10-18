import { t } from '../i18n/en';
import type { PlanState } from '../model/plan/types';
import type { MachineWorkerRequest, MachineWorkerResponse } from './machineWorkerHandler';
import { notify, warnOnce } from './notices';
import type { PipelineResult, createPipeline } from './pipelineCore';
import { defaultSiteWorker } from './siteWorkerController';

/** A machine build to run: the plan and the pipe / cable / below toggles. */
export interface MachineRequest {
  plan: PlanState;
  pipes: boolean;
  cables: boolean;
  below: boolean;
}

export interface MachineWorkerEvents {
  /** `pending`: the build has no pipes yet; the routed one of the same request is still coming. */
  onResult: (result: PipelineResult, info: { pending: boolean }) => void;
  onBusy: (busy: boolean) => void;
}

export interface MachineWorkerController {
  /** Builds the request, replacing any request not started yet (see `SUPERSEDE_AFTER_MS`). */
  submit: (req: MachineRequest) => void;
  /** Forgets the queued request and stops a running one; nothing more is reported until the next `submit`. */
  cancel: () => void;
}

/** A job running longer than this is abandoned for a newer request instead of making it wait. */
export const SUPERSEDE_AFTER_MS = 2000;

export interface MachineWorkerOptions {
  /** The worker, or null where workers are unavailable. Same script as the site worker, own instance. */
  createWorker?: () => Worker | null;
  /** The pipeline used when there is no worker (the one tests and the dev harness use). */
  run: ReturnType<typeof createPipeline>;
  now?: () => number;
}

/** A result for a request the worker could not build. */
function failed(message: string): PipelineResult {
  return {
    def: undefined,
    pack: null,
    loosened: false,
    hatches: null,
    stats: null,
    pipes: null,
    scene: null,
    error: message,
  };
}

/**
 * Runs machine builds in a worker, one at a time. While one runs, only the newest request waits; if the
 * running one is already old (`SUPERSEDE_AFTER_MS`) it is stopped for the newest request, so a very slow
 * build never makes the user wait for a plan they have left. Without a worker from the start everything is
 * built right here. If the worker dies mid-job, the latest request is built here without pipes and cables,
 * and so are all later ones (routing on the main thread could freeze the tab).
 */
export function createMachineWorkerController(
  events: MachineWorkerEvents,
  { createWorker = defaultSiteWorker, run, now = Date.now }: MachineWorkerOptions,
): MachineWorkerController {
  let worker: Worker | null = null;
  /** No worker could be created: build everything here, routing included. */
  let unavailable = false;
  /** The worker died: build here, without routing. */
  let died = false;
  let nextId = 0;
  let inFlight: { id: number; req: MachineRequest; startedAt: number } | null = null;
  let queued: MachineRequest | null = null;

  function buildHere(req: MachineRequest, routing: boolean): void {
    let result: PipelineResult;
    try {
      result = run(req.plan, routing && req.pipes, routing && req.cables, req.below);
    } catch (err) {
      warnOnce('machine build', err);
      result = failed(err instanceof Error ? err.message : String(err));
    }
    events.onResult(result, { pending: false });
  }

  function stopWorker(): void {
    worker?.terminate();
    worker = null;
    inFlight = null;
  }

  /** The worker died: the latest request is built here, without pipes and cables, from now on too. */
  function fallBack(err: unknown): void {
    warnOnce('machineWorker', err);
    const req = queued ?? inFlight?.req ?? null;
    stopWorker();
    queued = null;
    if (!died) notify(t.machineWorkerStopped, 10000, 'machine-worker');
    died = true;
    events.onBusy(false);
    if (req) buildHere(req, false);
  }

  function startWorker(): Worker | null {
    if (worker) return worker;
    let w: Worker | null = null;
    try {
      w = createWorker();
    } catch {
      w = null;
    }
    if (!w) {
      unavailable = true;
      return null;
    }
    worker = w;
    w.onmessage = (e: MessageEvent<MachineWorkerResponse>) => {
      const msg = e.data;
      const job = inFlight;
      if (!job || msg.id !== job.id) return;
      if ('partial' in msg && msg.partial) {
        // The routed build of the same request is still coming; a newer request makes this one stale.
        if (!queued) events.onResult(msg.machine, { pending: true });
        return;
      }
      inFlight = null;
      if ('error' in msg) {
        warnOnce('machine build', msg.error);
        events.onResult(failed(msg.error), { pending: false });
      } else events.onResult(msg.machine, { pending: false });
      sendQueued();
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      fallBack(e.message || 'Machine worker failed');
    };
    w.onmessageerror = () => fallBack('Machine worker message could not be read');
    return w;
  }

  function sendQueued(): void {
    if (!queued) {
      events.onBusy(false);
      return;
    }
    const req = queued;
    queued = null;
    const w = startWorker();
    if (!w) {
      buildHere(req, true);
      events.onBusy(false);
      return;
    }
    inFlight = { id: ++nextId, req, startedAt: now() };
    const msg: MachineWorkerRequest = { id: inFlight.id, type: 'machine', ...req };
    try {
      w.postMessage(msg);
    } catch (err) {
      // Not cloneable (should not happen: plans are plain data).
      queued = req;
      fallBack(err);
    }
  }

  return {
    submit(req) {
      if (died) {
        buildHere(req, false);
        return;
      }
      if (unavailable) {
        buildHere(req, true);
        return;
      }
      queued = req;
      events.onBusy(true);
      if (inFlight && now() - inFlight.startedAt > SUPERSEDE_AFTER_MS) stopWorker();
      if (inFlight === null) sendQueued();
    },

    cancel() {
      queued = null;
      if (inFlight) stopWorker();
      events.onBusy(false);
    },
  };
}
