import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import { site } from '../state/site';
import { withGroupAdded, withGroupMoved, withGroupPatched, withGroupRemoved } from './siteActions';
import { growAfterBuild, patchGroup, whenBuiltGroup } from './siteEditing';
import { startSiteHistory, undo } from './siteHistory';
import type { SiteResult } from './siteWorkerController';

function twoGroups(): SiteState {
  let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
  s = withGroupAdded(s, 'vacuum-freezer', [12, 3]);
  return s;
}

/** Just what the grow watch reads of a build: the placed groups with their extent. */
const buildOf = (s: SiteState, size: [number, number, number]): SiteBuild =>
  ({
    groups: s.groups.map((group) => ({ group, def: {}, min: [0, 0, 0], max: size })),
  }) as never;
const result = (of: SiteState, size: [number, number, number], pending?: boolean): SiteResult => ({
  build: buildOf(of, size),
  error: null,
  pending,
  of,
});

describe('whenBuiltGroup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves on the first build made with this very group object, even a pending one', async () => {
    const s = twoGroups();
    const id = s.groups[0].id;
    const patched = withGroupPatched(s, id, { count: 5 });
    const builds = writable<SiteResult>(result(s, [1, 1, 1]));
    const done = vi.fn();
    void whenBuiltGroup(id, patched.groups[0], builds, 1000, writable(patched)).then(done);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    builds.set(result(patched, [1, 1, 1], true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith(get(builds).build);
  });

  it('resolves null when the group is removed, a build fails, or time runs out', async () => {
    const s = twoGroups();
    const id = s.groups[0].id;
    const sites = writable(s);
    const builds = writable<SiteResult>({ build: null, error: null });
    const removed = whenBuiltGroup(id, s.groups[0], builds, 1000, sites);
    sites.set(withGroupRemoved(s, id));
    expect(await removed).toBeNull();
    const failed = whenBuiltGroup(
      id,
      s.groups[0],
      writable<SiteResult>({ build: null, error: 'boom', of: s }),
      1000,
      writable(s),
    );
    expect(await failed).toBeNull();
    const slow = whenBuiltGroup(id, s.groups[0], builds, 1000, writable(s));
    await vi.advanceTimersByTimeAsync(1001);
    expect(await slow).toBeNull();
  });
});

/** A store that counts its subscribers. */
function counted<T>(value: T) {
  const store = writable(value);
  let n = 0;
  return {
    set: store.set,
    subscribe: (fn: (v: T) => void) => {
      n++;
      const stop = store.subscribe(fn);
      return () => {
        n--;
        stop();
      };
    },
    count: () => n,
  };
}

describe('whenBuiltGroup ending early', () => {
  it('ends with null at once when the watched group is replaced, not when another group is edited', async () => {
    const s = twoGroups();
    const [a, b] = s.groups.map((g) => g.id);
    const sites = counted(s);
    const builds = counted<SiteResult>({ build: null, error: null });
    const done = vi.fn();
    void whenBuiltGroup(a, s.groups[0], builds, 100000, sites).then(done);
    await Promise.resolve();
    sites.set(withGroupPatched(s, b, { label: 'x' }));
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    sites.set(withGroupMoved(s, a, 1, 0));
    await Promise.resolve();
    expect(done).toHaveBeenCalledWith(null);
    expect(sites.count() + builds.count()).toBe(0);
  });

  it('stops watching at once when aborted', async () => {
    const s = twoGroups();
    const sites = counted(s);
    const builds = counted<SiteResult>({ build: null, error: null });
    const ctl = new AbortController();
    const p = whenBuiltGroup(s.groups[0].id, s.groups[0], builds, 100000, sites, ctl.signal);
    expect(sites.count() + builds.count()).toBe(2);
    ctl.abort();
    expect(await p).toBeNull();
    expect(sites.count() + builds.count()).toBe(0);
  });
});

describe('patchGroup and growAfterBuild', () => {
  let stopHistory: () => void;
  let before: SiteState;
  let id: string;
  beforeEach(() => {
    vi.useFakeTimers();
    before = { ...twoGroups(), size: [30, 30] };
    id = before.groups[0].id;
    site.set(before);
    stopHistory = startSiteHistory();
  });
  afterEach(() => {
    stopHistory();
    vi.useRealTimers();
  });

  it('ignores a stale build, then grows once on the build of the patched state, in one undo step', async () => {
    const builds = writable<SiteResult>(result(before, [60, 5, 60]));
    patchGroup(id, { count: 9 });
    const patched = get(site);
    expect(patched).not.toBe(before);
    growAfterBuild(id, patched, builds);
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(patched);
    builds.set(result(before, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(patched);
    builds.set(result(patched, [60, 5, 60], true));
    await vi.advanceTimersByTimeAsync(0);
    const grown = get(site);
    expect(grown.size[0]).toBeGreaterThan(30);
    builds.set(result(patched, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(grown);
    expect(undo()).toBe(true);
    expect(get(site)).toBe(before);
  });

  it('does nothing for a patch that changes nothing', () => {
    patchGroup(id, { count: before.groups[0].count });
    expect(get(site)).toBe(before);
  });

  it('a newer call supersedes the older one and ends its subscriptions at once', async () => {
    const builds = counted<SiteResult>({ build: null, error: null });
    patchGroup(id, { count: 9 });
    const first = get(site);
    growAfterBuild(id, first, builds);
    expect(builds.count()).toBe(1);
    patchGroup(id, { count: 10 });
    const second = get(site);
    growAfterBuild(id, second, builds);
    expect(builds.count()).toBe(1);
    builds.set(result(first, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(second);
    builds.set(result(second, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site).size[0]).toBeGreaterThan(30);
  });

  it('grows without merging when something else was edited meanwhile', async () => {
    const builds = writable<SiteResult>({ build: null, error: null });
    patchGroup(id, { count: 9 });
    const patched = get(site);
    growAfterBuild(id, patched, builds);
    const other = patched.groups[1].id;
    site.update((s) => ({ ...s, groups: s.groups.map((g) => (g.id === other ? { ...g, label: 'x' } : g)) }));
    const edited = get(site);
    builds.set(result(patched, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site).size[0]).toBeGreaterThan(30);
    // Two steps: the growth is its own.
    expect(undo()).toBe(true);
    expect(get(site)).toBe(edited);
  });

  it('ignores a stale error result and still grows on the matching build', async () => {
    const builds = writable<SiteResult>({ build: null, error: null });
    patchGroup(id, { count: 9 });
    const patched = get(site);
    growAfterBuild(id, patched, builds);
    builds.set({ build: null, error: 'old failure', of: before });
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(patched);
    builds.set(result(patched, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site).size[0]).toBeGreaterThan(30);
  });

  it('gives up when the group is removed', async () => {
    const builds = writable<SiteResult>({ build: null, error: null });
    patchGroup(id, { count: 9 });
    growAfterBuild(id, get(site), builds);
    site.update((s) => withGroupRemoved(s, id));
    const removed = get(site);
    builds.set(result(removed, [60, 5, 60]));
    await vi.advanceTimersByTimeAsync(0);
    expect(get(site)).toBe(removed);
  });
});
