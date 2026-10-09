import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { emptySite } from '../share/siteCodec';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { arrange, neaten, optimizeAfterImport, whenBuilt } from './siteCommands';
import * as pipeline from './sitePipeline';
import { get } from 'svelte/store';
import type { SiteResult } from './sitePipeline';
import { withGroupAdded } from './siteActions';
import { registerBuild, sourceRevisionOf } from './buildIdentity';
import { startSiteHistory, undo, redo, canUndo } from './siteHistory';
import { notices } from './notices';

const identity = (s: SiteState) => ({ sourceRevision: sourceRevisionOf(s), requestId: 1 });

function imported(): SiteState {
  let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
  s = withGroupAdded(s, 'vacuum-freezer', [12, 3]);
  return s;
}

/** Just what `whenBuilt` reads of a build: the groups, in order. */
const builtFrom = (s: SiteState): SiteBuild => ({ groups: s.groups.map((group) => ({ group })) }) as never;

describe('whenBuilt', () => {
  it('ignores results of an earlier job for the same source state', async () => {
    const s = imported();
    const revision = registerBuild(s, 22);
    const builds = writable<SiteResult>({
      sourceRevision: revision,
      requestId: 21,
      build: builtFrom(s),
      error: null,
    });
    const result = vi.fn();
    void whenBuilt(s, writable(s), builds).then(result);
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set({ sourceRevision: revision, requestId: 21, build: null, error: 'old job' });
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set({ sourceRevision: revision, requestId: 22, build: builtFrom(s), error: null });
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith(true));
  });
  it('waits for the imported template to be built and routed, not for groups alone or for another site', async () => {
    const s = imported();
    const sites = writable(s);
    const builds = writable<SiteResult>({ build: builtFrom(emptySite()), error: null });
    const result = vi.fn();
    void whenBuilt(s, sites, builds).then(result);
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    // The groups arrive first, routing still to come.
    builds.set({ ...identity(s), build: builtFrom(s), error: null, pending: true });
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set({ ...identity(s), build: builtFrom(s), error: null });
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith(true));
  });

  it('is true at once when the build is already there', async () => {
    const s = imported();
    const ok = await whenBuilt(
      s,
      writable(s),
      writable<SiteResult>({ ...identity(s), build: builtFrom(s), error: null }),
    );
    expect(ok).toBe(true);
  });

  it('is false when the template is edited or replaced first, or the build fails, or time runs out', async () => {
    const s = imported();
    const sites = writable(s);
    const builds = writable<SiteResult>({ build: null, error: null });
    const edited = whenBuilt(s, sites, builds);
    sites.set({ ...s, name: 'edited' });
    expect(await edited).toBe(false);
    expect(
      await whenBuilt(s, writable(s), writable<SiteResult>({ ...identity(s), build: null, error: 'boom' })),
    ).toBe(false);
    vi.useFakeTimers();
    const slow = whenBuilt(s, writable(s), writable<SiteResult>({ build: null, error: null }), 1000);
    vi.advanceTimersByTime(1001);
    vi.useRealTimers();
    expect(await slow).toBe(false);
  });

  it('ignores a previous import with identical ids and its stale error', async () => {
    const s = imported();
    const old = imported();
    const builds = writable<SiteResult>({ ...identity(old), build: builtFrom(old), error: null });
    const result = vi.fn();
    void whenBuilt(s, writable(s), builds).then(result);
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set({ ...identity(old), build: null, error: 'stale failure' });
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    // Worker cloning does not preserve reference equality.
    builds.set({ ...identity(s), build: builtFrom(structuredClone(s)), error: null });
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith(true));
  });
});

describe('Neat UI transaction', () => {
  it('publishes mode and layout once, shows actual metrics, and supports one-step undo/redo', async () => {
    const { site } = await import('../state/site');
    const original = imported();
    delete original.routing;
    site.set(original);
    const stop = startSiteHistory();
    const summary = { bends: 7, surface: 11, length: 43, unconnected: 0 };
    const next = { ...original, routing: { mode: 'neat' as const, depth: 3 } };
    const spy = vi.spyOn(pipeline, 'arrangeInSize').mockResolvedValue({
      site: structuredClone(next),
      fits: true,
      needed: [20, 20],
      floors: 1,
      routingSummary: summary,
    });
    try {
      await neaten();
      expect(spy).toHaveBeenLastCalledWith(original, expect.any(Boolean), false, true);
      expect(get(site)).toEqual(next);
      expect(get(notices).find((n) => n.slot === 'arrange')?.text).toBe(
        'Neat: 7 bends, 11 surface blocks, 43 pipe and cable blocks, 0 unconnected terminals.',
      );
      expect(undo()).toBe(true);
      expect(get(site)).toBe(original);
      expect(undo()).toBe(false);
      expect(redo()).toBe(true);
      const applied = get(site);
      await neaten();
      expect(get(site)).toBe(applied);
      expect(undo()).toBe(true);
      expect(get(site)).toBe(original);
      expect(undo()).toBe(false);
    } finally {
      spy.mockRestore();
      stop();
    }
  });

  it.each(['rejected', 'edited', 'cancelled'] as const)('does not publish a %s result', async (reason) => {
    const { site } = await import('../state/site');
    const original = imported();
    site.set(original);
    const stop = startSiteHistory();
    const next = { ...original, routing: { mode: 'neat' as const, depth: 3 } };
    const spy = vi.spyOn(pipeline, 'arrangeInSize').mockImplementation(async () => {
      if (reason === 'edited') site.set({ ...original, name: 'newer edit' });
      if (reason === 'cancelled') throw new Error('replaced');
      return {
        site: next,
        fits: true,
        needed: [20, 20],
        floors: 1,
        ...(reason === 'rejected' ? { rejected: true } : {}),
      };
    });
    try {
      await neaten();
      expect(get(site).routing).toEqual(original.routing);
      if (reason === 'edited') expect(get(site).name).toBe('newer edit');
      else {
        expect(get(site)).toBe(original);
        expect(get(canUndo)).toBe(false);
      }
    } finally {
      spy.mockRestore();
      stop();
    }
  });
});

describe('Optimize cancellation', () => {
  it('reports cancellation without a document update or undo step', async () => {
    const { site } = await import('../state/site');
    const original = imported();
    site.set(original);
    const stop = startSiteHistory();
    const spy = vi
      .spyOn(pipeline, 'arrangeInSize')
      .mockRejectedValueOnce(new Error('Optimization cancelled.'));
    try {
      await arrange(true);
      expect(get(site)).toBe(original);
      expect(get(canUndo)).toBe(false);
      expect(get(notices).some((n) => n.text === 'Optimization cancelled. Layout unchanged.')).toBe(true);
    } finally {
      stop();
      spy.mockRestore();
    }
  });
});

describe('optimizeAfterImport', () => {
  it('optimises once the imported template is built, and only if it is still the current one', async () => {
    const { site } = await import('../state/site');
    const s = imported();
    site.set(s);
    const run = vi.fn(async () => {});
    await optimizeAfterImport(s, run, async () => true);
    expect(run).toHaveBeenCalledTimes(1);
    // Edited while it was being built: nothing is optimised.
    const edited = { ...s, name: 'edited' };
    site.set(edited);
    await optimizeAfterImport(s, run, async () => true);
    expect(run).toHaveBeenCalledTimes(1);
    // Not built (failed, replaced): nothing either.
    site.set(s);
    await optimizeAfterImport(s, run, async () => false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('worker command no-ops', () => {
  it.each(['no improvement', 'time limit', 'already arranged'] as const)(
    '%s does not republish the cloned document',
    async (reason) => {
      const { site } = await import('../state/site');
      const original = imported();
      site.set(original);
      const score = { problems: 0, unconnected: 0, blocks: 5, span: 10 };
      const spy = vi.spyOn(pipeline, 'arrangeInSize').mockResolvedValueOnce({
        site: structuredClone(original),
        fits: true,
        needed: [20, 20],
        floors: 1,
        ...(reason === 'already arranged'
          ? {}
          : {
              optimized: {
                improved: false,
                start: score,
                result: score,
                reshaped: 0,
                ...(reason === 'time limit' ? { stopped: 'time-limit' as const } : {}),
              },
            }),
      });
      const published = vi.fn();
      const unsubscribe = site.subscribe(published);
      published.mockClear();
      try {
        await arrange(reason !== 'already arranged');
        expect(get(site)).toBe(original);
        expect(published).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        spy.mockRestore();
      }
    },
  );
});
