import {
  buildSiteFromGtnh,
  type GtnhProject,
  type MachineChoice,
  type ImportOptions,
} from '../import/gtnhplanner';
import { createSiteBuilder } from '../model/site/build';
import type { OptimizationProgress } from '../model/site/optimize';
import type { SearchControl } from '../model/site/search';
import { arrangeHere, optimizeHere } from './siteArrange';

/** Loaded only when the worker is unavailable. All operations reuse the same group cache. */
export function createLocalSiteRuntime() {
  const builder = createSiteBuilder();
  return {
    build: builder,
    importSite: (project: GtnhProject, choices: Map<string, MachineChoice>, opts: ImportOptions) =>
      buildSiteFromGtnh(project, choices, opts, builder),
    arrange: (
      site: Parameters<typeof arrangeHere>[0],
      below: boolean,
      optimize: boolean,
      neat = false,
      control?: SearchControl<OptimizationProgress>,
    ) =>
      optimize
        ? optimizeHere(site, below, builder, control)
        : arrangeHere(site, below, builder, false, undefined, neat),
  };
}
