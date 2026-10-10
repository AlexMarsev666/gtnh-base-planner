import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { emptySite } from '../share/siteCodec';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { optimizeAfterImport, whenBuilt } from './siteCommands';
import type { SiteResult } from './sitePipeline';
import { withGroupAdded } from './siteActions';

function imported(): SiteState {
  let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
  s = withGroupAdded(s, 'vacuum-freezer', [12, 3]);
  return s;
}

/** Just what `whenBuilt` reads of a build: the groups, in order, and the site it was made from. */
const builtFrom = (s: SiteState): SiteBuild => ({ groups: s.groups.map((group) => ({ group })) }) as never;
const resultOf = (s: SiteState, pending?: boolean): SiteResult => ({
  build: builtFrom(s),
  error: null,
  pending,
  of: s,
});

describe('whenBuilt', () => {
  it('waits for the imported template to be built and routed, not for groups alone or for another site', async () => {
    const s = imported();
    const sites = writable(s);
    const builds = writable<SiteResult>({ build: builtFrom(emptySite()), error: null });
    const result = vi.fn();
    void whenBuilt(s, sites, builds).then(result);
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    // The groups arrive first, routing still to come.
    builds.set(resultOf(s, true));
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set(resultOf(s));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith(true));
  });

  it('is true at once when the build is already there', async () => {
    const s = imported();
    const ok = await whenBuilt(s, writable(s), writable<SiteResult>(resultOf(s)));
    expect(ok).toBe(true);
  });

  it('does not count a build of another template with the same group ids', async () => {
    const s = imported();
    const other = { ...s, name: 'earlier' };
    const builds = writable<SiteResult>(resultOf(other));
    const result = vi.fn();
    void whenBuilt(s, writable(s), builds).then(result);
    await Promise.resolve();
    expect(result).not.toHaveBeenCalled();
    builds.set(resultOf(s));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith(true));
  });

  it('is false when the template is edited or replaced first, or the build fails, or time runs out', async () => {
    const s = imported();
    const sites = writable(s);
    const builds = writable<SiteResult>({ build: null, error: null });
    const edited = whenBuilt(s, sites, builds);
    sites.set({ ...s, name: 'edited' });
    expect(await edited).toBe(false);
    expect(await whenBuilt(s, writable(s), writable<SiteResult>({ build: null, error: 'boom' }))).toBe(false);
    vi.useFakeTimers();
    const slow = whenBuilt(s, writable(s), writable<SiteResult>({ build: null, error: null }), 1000);
    vi.advanceTimersByTime(1001);
    vi.useRealTimers();
    expect(await slow).toBe(false);
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
