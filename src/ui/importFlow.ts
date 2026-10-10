import { t } from '../i18n/en';
import type { GtnhProject, ImportOptions, MachineChoice } from '../import/gtnhplanner';
import type { SiteState } from '../model/site/types';
import { JobCancelled, type ImportResult } from './siteWorkerController';

/** What `runImport` does besides asking for the import, passed in so the flow can be tested. */
export interface ImportFlowDeps {
  importSite: (
    project: GtnhProject,
    choices: Map<string, MachineChoice>,
    opts: ImportOptions,
    signal: AbortSignal,
  ) => Promise<ImportResult>;
  releaseIfBackedUp: (kind: 'site') => void;
  replaceSite: (next: SiteState) => void;
  showSite: () => void;
  notify: (text: string, ms?: number, slot?: string) => void;
  /** Closes the dialog. */
  close: () => void;
  optimizeAfterImport: (imported: SiteState) => Promise<void>;
}

/**
 * Imports `project` and, unless `signal` was aborted meanwhile (the dialog was closed), replaces the template
 * with the result. Returns the error to show, or null when it succeeded or was cancelled.
 */
export async function runImport(
  project: GtnhProject,
  choices: Map<string, MachineChoice>,
  opts: ImportOptions,
  optimizeAfter: boolean,
  signal: AbortSignal,
  deps: ImportFlowDeps,
): Promise<string | null> {
  let result: ImportResult;
  try {
    result = await deps.importSite(project, choices, opts, signal);
  } catch (err) {
    if (err instanceof JobCancelled) return null;
    return err instanceof Error ? err.message : String(err);
  }
  // Closed while the import ran in here (not in the worker, which stops): the user no longer wants it.
  if (signal.aborted) return null;
  const { site: next, report } = result;
  deps.releaseIfBackedUp('site');
  deps.replaceSite(next);
  deps.showSite();
  const fit = opts.fit ?? true;
  const notes = [t.importer.done(report.groups, report.ports, report.links)];
  if (fit) notes.push(t.importer.sized(next.size[0], next.size[1]));
  else if (!report.fits) notes.push(t.site.needs(report.needed[0], report.needed[1]));
  if (!fit && report.floors > 1) notes.push(t.importer.floors(report.floors));
  if (report.aspects) notes.push(t.importer.aspects(report.aspects));
  if (report.adjusted) notes.push(t.importer.adjustedValues(report.adjusted));
  if (report.truncated) notes.push(t.importer.truncated);
  deps.notify(notes.join(' '), 9000, 'import');
  if (report.placeholders.length)
    deps.notify(t.importer.placeholders(report.placeholders), 9000, 'import-placeholders');
  deps.close();
  if (optimizeAfter) void deps.optimizeAfterImport(next);
  return null;
}
