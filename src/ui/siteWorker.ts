/// <reference lib="webworker" />
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
import {
  createMachineHandler,
  type MachineWorkerRequest,
  type MachineWorkerResponse,
} from './machineWorkerHandler';
import { createPipeline } from './pipelineCore';
import { arrangeHere, type Arranged } from './siteArrange';

/**
 * Builds sites off the main thread: packing hundreds of units and routing a large template takes seconds,
 * and the page must stay responsive meanwhile. Imports from GTNH Planner run here too, with the same
 * per-group cache, so the build that follows an import does not pack its groups a second time.
 */

export type SiteWorkerRequest =
  | { id: number; type: 'build'; site: SiteState; opts: SiteBuildOptions }
  | { id: number; type: 'arrange'; site: SiteState; below: boolean; optimize?: boolean }
  | {
      id: number;
      type: 'import';
      project: GtnhProject;
      choices: Map<string, MachineChoice>;
      opts: ImportOptions;
    };

/** `partial`: the groups without pipes, sent first when routing will take a while; the full build follows. */
export type SiteWorkerResponse =
  | { id: number; build: SiteBuild; partial?: boolean }
  | { id: number; imported: { site: SiteState; report: ImportReport } }
  | { id: number; arranged: Arranged }
  | { id: number; error: string };

/** Above this many pipe and cable ends, the groups are shown before the nets are routed. */
const PROGRESSIVE_TERMINALS = 200;

const buildSite = createSiteBuilder();
/** Machine builds; the pipelines keep their memos warm across requests (see `createMachineHandler`). */
const handleMachine = createMachineHandler(createPipeline(), createPipeline());

self.onmessage = (e: MessageEvent<SiteWorkerRequest | MachineWorkerRequest>) => {
  const req = e.data;
  const post = (out: SiteWorkerResponse | MachineWorkerResponse) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(out);
  if (req.type === 'machine') {
    handleMachine(req, post);
    return;
  }
  try {
    if (req.type === 'import') {
      post({ id: req.id, imported: buildSiteFromGtnh(req.project, req.choices, req.opts, buildSite) });
      return;
    }
    if (req.type === 'arrange') {
      post({ id: req.id, arranged: arrangeHere(req.site, req.below, buildSite, req.optimize) });
      return;
    }
    const { id, site, opts } = req;
    if (opts.pipes || opts.cables) {
      // Packing is cached per group, so the full build below does not pack again.
      const groups = buildSite(site, { ...opts, pipes: false, cables: false });
      const ends = groups.nets
        .filter((n) => (n.kind === 'power' ? opts.cables : opts.pipes))
        .reduce((s, n) => s + n.terminals.length, 0);
      if (ends > PROGRESSIVE_TERMINALS) post({ id, build: groups, partial: true });
    }
    post({ id, build: buildSite(site, opts) });
  } catch (err) {
    post({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
