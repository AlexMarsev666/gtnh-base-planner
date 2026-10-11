import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { getSiteDef } from '../data/generic';
import { t } from '../i18n/en';
import { emptySite } from '../share/siteCodec';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteRouting, SiteState } from '../model/site/types';
import { arrange, freeOrigin, neatArrange, optimizeAfterImport, whenBuilt } from './siteCommands';
import { canRedo, canUndo, redo, startSiteHistory, undo as undoStep } from './siteHistory';
import { arrangeOutcome, site } from '../state/site';
import { JobCancelled } from './siteWorkerController';
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

describe('arrange', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const undo = { label: 'Undo', run: () => {} };
  function setup(job: (s: SiteState, routing: SiteRouting) => Promise<unknown>) {
    const s = imported();
    const sites = writable(s);
    const cleared: string[] = [];
    const said: [string, number | undefined, string | undefined][] = [];
    const deps = {
      cleared,
      arrangeInSize: job as never,
      sites,
      below: writable(false),
      notify: (text: string, ms?: number, slot?: string) => void said.push([text, ms, slot]),
      clearSlot: (slot: string) => void cleared.push(slot),
      undo: () => undo,
    };
    return { s, sites, said, cleared, deps };
  }
  const arranged = (s: SiteState) => ({
    site: { ...s, name: 'arranged' },
    fits: true,
    needed: [1, 1],
    floors: 1,
  });

  it('clears the old notice while arranging (the progress bar shows it), then says the outcome', async () => {
    const { s, sites, said, deps } = setup(async (x) => arranged(x));
    await arrange(false, deps);
    expect(deps.cleared).toEqual(['arrange']);
    expect(said).toHaveLength(1);
    expect(said[0][2]).toBe('arrange');
    expect(get(sites).name).toBe('arranged');
    expect(s.name).not.toBe('arranged');
  });

  it('reports an error instead of staying silent', async () => {
    const { said, deps } = setup(async () => {
      throw new Error('boom');
    });
    await arrange(true, deps);
    expect(said[0]).toEqual([expect.stringContaining('boom'), 6000, 'arrange']);
  });

  it('says so when an edit stopped it, and when the result is discarded', async () => {
    const stopped = setup(async () => {
      throw new JobCancelled('edit');
    });
    await arrange(true, stopped.deps);
    expect(stopped.said[0]).toEqual([expect.stringMatching(/optimizing stopped/), 4000, 'arrange']);
    const later = setup(async (x) => {
      later.sites.set({ ...x, name: 'edited' });
      return arranged(x);
    });
    await arrange(false, later.deps);
    expect(later.said[0]).toEqual([expect.stringMatching(/arranging stopped/), 4000, 'arrange']);
    expect(get(later.sites).name).toBe('edited');
  });

  it('leaves the notice to a newer arrange, and clears it when an import replaced the job', async () => {
    const newer = setup(async () => {
      throw new JobCancelled('arrange');
    });
    await arrange(false, newer.deps);
    expect(newer.said).toHaveLength(0);
    expect(newer.cleared).toEqual(['arrange']);
    const imp = setup(async () => {
      throw new JobCancelled('import');
    });
    await arrange(false, imp.deps);
    expect(imp.said).toHaveLength(0);
    expect(imp.cleared).toEqual(['arrange', 'arrange']);
  });
  it('arranges and optimises with the site routing, or the browser switch for sites without one', async () => {
    const seen: unknown[] = [];
    const { s, deps } = setup(async (x, routing) => (seen.push(routing), arranged(x)));
    await arrange(false, deps);
    expect(seen.at(-1)).toEqual({ style: 'classic', depth: 0 });
    deps.below.set(true);
    await arrange(false, deps);
    expect(seen.at(-1)).toEqual({ style: 'classic', depth: 1 });
    deps.sites.set({ ...s, routing: { style: 'neat', depth: 2 } });
    await arrange(true, deps);
    expect(seen.at(-1)).toEqual({ style: 'neat', depth: 2 });
    // A legacy site keeps having no routing of its own.
    deps.sites.set(s);
    await arrange(false, deps);
    expect(get(deps.sites).routing).toBeUndefined();
  });

  it('reports what an applied run did, and leaves everything alone when cancelled', async () => {
    const done = setup(async (x) => ({
      ...arranged(x),
      optimized: { improved: true, truncated: true, start: {}, result: {}, reshaped: 0 },
    }));
    await arrange(true, done.deps);
    expect(get(arrangeOutcome)).toEqual({
      kind: 'optimize',
      fits: true,
      floors: 1,
      improved: true,
      truncated: true,
    });
    const stopped = setup(async () => {
      throw new JobCancelled('aborted');
    });
    await arrange(true, stopped.deps);
    expect(get(stopped.sites)).toBe(stopped.s);
    expect(stopped.said[0]).toEqual([t.site.arrangeStopped, 4000, 'arrange']);
    expect(get(arrangeOutcome)).toBeNull();
  });

  it('changes nothing and says so when optimising found nothing better', async () => {
    const same = setup(async (x) => ({
      ...arranged(x),
      optimized: { improved: false, truncated: true, start: {}, result: {}, reshaped: 0 },
    }));
    const said: unknown[][] = [];
    await arrange(true, { ...same.deps, notify: (...a: unknown[]) => void said.push(a) } as never);
    expect(get(same.sites)).toBe(same.s);
    expect(said).toEqual([
      [`${t.site.optimizedSame} ${t.site.optimizeTruncated}`, 6000, 'arrange', undefined],
    ]);
    expect(get(arrangeOutcome)).toMatchObject({ kind: 'optimize', improved: false, truncated: true });
  });

  it('drops the result when the effective routing changed while it ran', async () => {
    const later = setup(async (x) => {
      later.deps.below.set(true);
      return arranged(x);
    });
    await arrange(false, later.deps);
    expect(later.said[0]).toEqual([expect.stringMatching(/arranging stopped/), 4000, 'arrange']);
    expect(get(later.sites)).toBe(later.s);
  });

  describe('neat', () => {
    const run = async (routing: SiteState['routing']) => {
      const seen: unknown[] = [];
      const { s, deps } = setup(async (x, r) => (seen.push(r), arranged(x)));
      const start = { ...s, routing };
      site.set(start);
      deps.sites = site as never;
      const stop = startSiteHistory();
      await neatArrange(deps);
      return { start, seen, stop };
    };

    it('arranges and switches to neat routing at least one layer deep, as one undo step', async () => {
      const { start, seen, stop } = await run(undefined);
      expect(seen).toEqual([{ style: 'neat', depth: 1 }]);
      expect(get(site)).toMatchObject({ name: 'arranged', routing: { style: 'neat', depth: 1 } });
      expect(get(canUndo)).toBe(true);
      expect(undoStep()).toBe(true);
      expect(get(site)).toBe(start);
      // Both the layout and the routing came back in that one step.
      expect(get(canUndo)).toBe(false);
      expect(get(canRedo)).toBe(true);
      expect(redo()).toBe(true);
      expect(get(site).routing).toEqual({ style: 'neat', depth: 1 });
      stop();
    });

    it('sets the template once, with neat routing at least one layer deep', async () => {
      const { s, sites, deps } = setup(async (x) => arranged(x));
      const sets: SiteState[] = [];
      let first = true;
      sites.subscribe((v) => (first ? (first = false) : sets.push(v)));
      sites.set(s);
      sets.length = 0;
      await neatArrange(deps);
      expect(sets).toHaveLength(1);
      expect(sets[0].routing).toEqual({ style: 'neat', depth: 1 });
    });

    it('keeps a deeper setting', async () => {
      const { seen, stop } = await run({ style: 'classic', depth: 3 });
      expect(seen).toEqual([{ style: 'neat', depth: 3 }]);
      expect(get(site).routing).toEqual({ style: 'neat', depth: 3 });
      stop();
    });
  });
});

describe('freeOrigin', () => {
  it('estimates the extent of an unbuilt template from its groups', () => {
    let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
    s = { ...s, groups: [{ ...s.groups[0], count: 3, limits: { x: 2, y: null, z: null } }] };
    const width = getSiteDef('electric-blast-furnace')!.size[0];
    expect(freeOrigin(s, null)[0]).toBe(3 + 2 * width + Math.max(1, s.corridor));
    // Without limits every unit counts.
    s = { ...s, groups: [{ ...s.groups[0], limits: { x: null, y: null, z: null } }] };
    expect(freeOrigin(s, null)[0]).toBe(3 + 3 * width + Math.max(1, s.corridor));
  });

  it('uses the other side of the machine when it is turned', () => {
    let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
    s = { ...s, groups: [{ ...s.groups[0], count: 1, limits: { x: null, y: null, z: null }, rotation: 1 }] };
    const depth = getSiteDef('electric-blast-furnace')!.size[2];
    expect(freeOrigin(s, null)[0]).toBe(3 + depth + Math.max(1, s.corridor));
  });

  it('keeps the start of an empty template, and the built extent when there is a build', () => {
    const empty = emptySite();
    const edge = 1 + Math.max(1, empty.corridor);
    expect(freeOrigin(empty, null)).toEqual([edge, edge]);
    const s = imported();
    const build = { groups: [{ def: {}, max: [20, 9] }] } as never;
    expect(freeOrigin(s, build)).toEqual([20 + Math.max(1, s.corridor), edge]);
  });
});
