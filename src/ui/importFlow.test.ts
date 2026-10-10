import { describe, expect, it, vi } from 'vitest';
import type { GtnhProject } from '../import/gtnhplanner';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import { runImport, type ImportFlowDeps } from './importFlow';
import { JobCancelled } from './siteWorkerController';

const project = { name: 'p' } as unknown as GtnhProject;
const next: SiteState = { ...emptySite(), name: 'imported' };
const report = {
  groups: 2,
  ports: 0,
  links: 1,
  aspects: 0,
  skipped: 0,
  placeholders: [],
  truncated: false,
  fits: true,
  needed: [10, 10],
  floors: 1,
};

function flow(importSite: ImportFlowDeps['importSite']) {
  const calls: string[] = [];
  const deps: ImportFlowDeps = {
    importSite,
    releaseIfBackedUp: () => void calls.push('release'),
    replaceSite: () => void calls.push('replace'),
    showSite: () => void calls.push('show'),
    notify: () => void calls.push('notify'),
    close: () => void calls.push('close'),
    optimizeAfterImport: async () => void calls.push('optimize'),
  };
  return { calls, deps };
}
const run = (deps: ImportFlowDeps, signal: AbortSignal, optimize = false) =>
  runImport(project, new Map(), { fit: true }, optimize, signal, deps);

describe('runImport', () => {
  it('releases the backed-up site, then replaces it, then reports and closes', async () => {
    const { calls, deps } = flow(async () => ({ site: next, report: report as never }));
    expect(await run(deps, new AbortController().signal, true)).toBeNull();
    expect(calls).toEqual(['release', 'replace', 'show', 'notify', 'close', 'optimize']);
  });

  it('still optimises when the dialog is destroyed right after it closed itself', async () => {
    const ac = new AbortController();
    const optimized: SiteState[] = [];
    const { deps } = flow(async () => ({ site: next, report: report as never }));
    deps.close = () => ac.abort();
    deps.optimizeAfterImport = async (s) => void optimized.push(s);
    expect(await run(deps, ac.signal, true)).toBeNull();
    expect(optimized).toEqual([next]);
  });

  it('changes nothing when the dialog was closed before the result came', async () => {
    const ac = new AbortController();
    const { calls, deps } = flow(async () => {
      ac.abort();
      return { site: next, report: report as never };
    });
    expect(await run(deps, ac.signal)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('ignores a cancelled job silently', async () => {
    const { calls, deps } = flow(async () => {
      throw new JobCancelled('aborted');
    });
    expect(await run(deps, new AbortController().signal)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns the error of a failed import without touching the template', async () => {
    const { calls, deps } = flow(vi.fn().mockRejectedValue(new Error('bad file')));
    expect(await run(deps, new AbortController().signal)).toBe('bad file');
    expect(calls).toEqual([]);
  });
});
