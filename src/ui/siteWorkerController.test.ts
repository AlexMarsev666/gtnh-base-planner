import { describe, expect, it, vi } from 'vitest';
import { emptySite } from '../share/siteCodec';
import type { SiteWorkerRequest, SiteWorkerResponse } from './siteWorker';
import { createSiteWorkerController, type SiteResult, type LocalSiteRuntime } from './siteWorkerController';
import { latestBuildRequest, sourceRevisionOf } from './buildIdentity';
import { referencePlans } from '../model/site/fixtures/referencePlans';
import type { OptimizationProgress } from '../model/site/optimize';

vi.spyOn(console, 'warn').mockImplementation(() => {});

const opts = { pipes: false, cables: false };

/** A worker that records what it is sent and answers only when told to. */
function fakeWorker() {
  const sent: SiteWorkerRequest[] = [];
  const w = {
    sent,
    terminated: false,
    onmessage: null as ((e: MessageEvent<SiteWorkerResponse>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: (m: SiteWorkerRequest) => void sent.push(m),
    terminate() {
      this.terminated = true;
    },
    reply(msg: SiteWorkerResponse) {
      this.onmessage?.({ data: msg } as MessageEvent<SiteWorkerResponse>);
    },
    fail() {
      this.onerror?.({ preventDefault() {}, message: 'boom' } as ErrorEvent);
    },
  };
  return w;
}

function setup(worker: () => Worker | null) {
  const builds: SiteResult[] = [];
  const busy: boolean[] = [];
  const c = createSiteWorkerController(
    { onBuild: (r) => builds.push(r), onBusy: (b) => busy.push(b) },
    worker,
  );
  return { c, builds, busy };
}

const named = (name: string) => ({ ...emptySite(), name });

describe('site worker controller', () => {
  it('forwards progress, terminates a cancelled worker and ignores its late progress/result', async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const progress: (OptimizationProgress | null)[] = [];
    const builds: SiteResult[] = [];
    let index = 0;
    const c = createSiteWorkerController(
      { onBuild: (r) => builds.push(r), onBusy: () => {}, onOptimization: (p) => progress.push(p) },
      () => workers[index++] as unknown as Worker,
    );
    const original = named('original');
    const result = c.arrange(original, true, true);
    const rejection = expect(result).rejects.toThrow('Optimization cancelled.');
    const id = workers[0].sent[0].id;
    workers[0].reply({ id, progress: { percent: 30, tried: 2 } });
    expect(progress.at(-1)).toEqual({ percent: 30, tried: 2 });
    c.submit(original, opts, false);
    c.cancelOptimization();
    await rejection;
    expect(workers[0].terminated).toBe(true);
    expect(progress.at(-1)).toBeNull();
    const count = progress.length;
    workers[0].reply({ id, progress: { percent: 100, tried: 100 } });
    workers[0].reply({ id, arranged: { site: named('stale'), fits: true, floors: 1, needed: [10, 10] } });
    expect(progress).toHaveLength(count);
    expect(workers[1].sent[0]).toMatchObject({ type: 'build', site: original });
    workers[1].reply({ id: workers[1].sent[0].id, build: { groups: [] } as never });
    expect(builds).toHaveLength(1);
  });

  it('cancels the real cooperative fallback and can build again without a stale result', async () => {
    const source = referencePlans()[1].site;
    const original = structuredClone(source);
    const progress: (OptimizationProgress | null)[] = [];
    const builds: SiteResult[] = [];
    const c = createSiteWorkerController(
      {
        onBuild: (r) => builds.push(r),
        onBusy: () => {},
        onOptimization: (p) => {
          progress.push(p);
          if (p && p.percent >= 20) c.cancelOptimization();
        },
      },
      () => null,
    );
    await expect(c.arrange(source, true, true)).rejects.toThrow('Optimization cancelled.');
    expect(source).toEqual(original);
    expect(progress.at(-1)).toBeNull();
    c.submit(source, opts, false);
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0].error).toBeNull();
    expect(builds[0].build?.groups).toHaveLength(source.groups.length);
    expect(progress.at(-1)).toBeNull();
  });
  it('forwards Neat to the worker, then finishes through the real fallback if it fails', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const source = named('neat');
    delete source.routing;
    const done = c.arrange(source, false, false, true);
    expect(w.sent[0]).toMatchObject({ type: 'arrange', optimize: false, neat: true, site: source });
    w.fail();
    const result = await done;
    expect(result.site.routing).toEqual({ mode: 'neat', depth: 3 });
    expect(result.routingSummary).toEqual({ bends: 0, surface: 0, length: 0, unconnected: 0 });
    expect(result.optimized).toBeUndefined();
  });
  it('builds right here without a worker', async () => {
    const { c, builds } = setup(() => null);
    const site = named('a');
    c.submit(site, opts, false);
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0].build?.groups).toEqual([]);
    expect(builds[0]).toMatchObject({
      sourceRevision: sourceRevisionOf(site),
      requestId: latestBuildRequest(site),
    });
  });

  it('assigns identities before queueing and retains the newest one through worker failure', async () => {
    const w = fakeWorker();
    const { c, builds } = setup(() => w as unknown as Worker);
    const first = named('a');
    const newest = named('b');
    c.submit(first, opts, false);
    c.submit(newest, opts, false);
    const requestId = latestBuildRequest(newest);
    expect(requestId).toBeDefined();
    expect(requestId).not.toBe(latestBuildRequest(first));
    w.fail();
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0]).toMatchObject({ sourceRevision: sourceRevisionOf(newest), requestId });
  });

  it('builds right here when the worker cannot be created', async () => {
    const { c, builds, busy } = setup(() => {
      throw new Error('blocked');
    });
    c.submit(named('a'), opts, false);
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0].error).toBeNull();
    expect(busy.at(-1)).toBe(false);
  });

  it('sends only the newest request once the running build is done', () => {
    const w = fakeWorker();
    const { c, builds } = setup(() => w as unknown as Worker);
    c.submit(named('a'), opts, false);
    c.submit(named('b'), opts, false);
    c.submit(named('c'), opts, false);
    expect(w.sent.map((m) => m.type === 'build' && m.site.name)).toEqual(['a']);
    w.reply({ id: w.sent[0].id, build: { scene: {} } as never });
    expect(builds).toHaveLength(1);
    expect(w.sent.map((m) => m.type === 'build' && m.site.name)).toEqual(['a', 'c']);
  });

  it('finishes the queued build here when the worker fails', async () => {
    const w = fakeWorker();
    const { c, builds } = setup(() => w as unknown as Worker);
    c.submit(named('a'), opts, false);
    c.submit(named('b'), opts, false);
    w.fail();
    expect(w.terminated).toBe(true);
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    // Later builds skip the worker.
    c.submit(named('c'), opts, false);
    await vi.waitFor(() => expect(builds).toHaveLength(2));
    expect(w.sent).toHaveLength(1);
  });

  it('rejects an import that a newer one replaces', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const project = { name: 'p', recipes: new Map(), nodes: [], storages: [], edges: [], skipped: 0 };
    const first = c.importSite(project, new Map(), {});
    void c.importSite(project, new Map(), {});
    await expect(first).rejects.toThrow(/replaced/);
  });

  it('arranges in the worker and hands back what it answers', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const site = named('a');
    const done = c.arrange(site, true);
    expect(w.sent[0]).toMatchObject({ type: 'arrange', site, below: true });
    const arranged = { site, fits: true, needed: [10, 10] as [number, number], floors: 2 };
    w.reply({ id: w.sent[0].id, arranged });
    await expect(done).resolves.toEqual(arranged);
  });

  it('asks the worker to optimise as well only when told to', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const site = named('a');
    const plain = c.arrange(site, false);
    expect(w.sent[0]).toMatchObject({ type: 'arrange', optimize: false });
    w.reply({ id: w.sent[0].id, arranged: { site, fits: true, needed: [10, 10], floors: 1 } });
    await plain;
    const tuned = c.arrange(site, false, true);
    expect(w.sent[1]).toMatchObject({ type: 'arrange', optimize: true });
    const optimized = {
      improved: false,
      reshaped: 0,
      start: { problems: 0, unconnected: 0, blocks: 1, span: 1 },
    };
    const arranged = { site, fits: true, needed: [10, 10] as [number, number], floors: 1, optimized };
    w.reply({
      id: w.sent[1].id,
      arranged: { ...arranged, optimized: { ...optimized, result: optimized.start } },
    });
    await expect(tuned).resolves.toMatchObject({ optimized: { improved: false } });
  });

  it('optimises right here without a worker', async () => {
    const { c } = setup(() => null);
    const r = await c.arrange(named('a'), false, true);
    expect(r.fits).toBe(true);
    expect(r.optimized).toBeDefined();
    expect((await c.arrange(named('a'), false)).optimized).toBeUndefined();
  });

  it('arranges right here without a worker, and rejects an arrangement a newer job replaces', async () => {
    const { c } = setup(() => null);
    const r = await c.arrange(named('a'), false);
    expect(r).toMatchObject({ fits: true, floors: 1 });
    const w = fakeWorker();
    const { c: c2 } = setup(() => w as unknown as Worker);
    const first = c2.arrange(named('a'), false);
    void c2.arrange(named('b'), false);
    await expect(first).rejects.toThrow(/replaced/);
  });
});

function delayedRuntime() {
  let resolve!: (runtime: LocalSiteRuntime) => void;
  const promise = new Promise<LocalSiteRuntime>((r) => {
    resolve = r;
  });
  const runtime = {
    build: vi.fn(() => ({ groups: [] }) as never),
    importSite: vi.fn((project) => ({ site: named(project.name), report: {} }) as never),
    arrange: vi.fn((site) => ({ site, fits: true, needed: [1, 1], floors: 1 }) as never),
  } satisfies LocalSiteRuntime;
  const builds: SiteResult[] = [];
  const load = vi.fn(() => promise);
  const c = createSiteWorkerController({ onBuild: (r) => builds.push(r), onBusy() {} }, () => null, load);
  return { c, builds, runtime, load, finish: () => resolve(runtime) };
}

const project = { name: 'p', recipes: new Map(), nodes: [], storages: [], edges: [], skipped: 0 };

describe('lazy local site runtime', () => {
  it('discards a superseded Neat request while the local runtime downloads', async () => {
    const { c, runtime, finish } = delayedRuntime();
    const first = c.arrange(named('old'), false, false, true);
    const rejected = expect(first).rejects.toThrow(/replaced/);
    const newer = named('new');
    const next = c.arrange(newer, true, false, true);
    finish();
    await rejected;
    await next;
    expect(runtime.arrange).toHaveBeenCalledExactlyOnceWith(newer, true, false, true);
  });
  it('runs only the latest build after downloading and reuses the runtime', async () => {
    const { c, builds, runtime, load, finish } = delayedRuntime();
    c.submit(named('old'), opts, false);
    const newest = named('new');
    c.submit(newest, opts, true);
    expect(runtime.build).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(runtime.build).toHaveBeenCalledExactlyOnceWith(newest, opts);
    expect(builds[0]).toMatchObject({ requestId: latestBuildRequest(newest), pending: true });
    await c.arrange(newest, false);
    await c.importSite(project, new Map(), {});
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects a superseded import and never executes it after downloading', async () => {
    const { c, runtime, finish } = delayedRuntime();
    const first = c.importSite(project, new Map(), {});
    const rejected = expect(first).rejects.toThrow(/replaced/);
    const next = c.importSite({ ...project, name: 'new' }, new Map(), {});
    finish();
    await rejected;
    await expect(next).resolves.toMatchObject({ site: { name: 'new' } });
    expect(runtime.importSite).toHaveBeenCalledTimes(1);
  });

  it('rejects a superseded arrangement and drops its result', async () => {
    const { c, runtime, finish } = delayedRuntime();
    const first = c.arrange(named('old'), false, true);
    const rejected = expect(first).rejects.toThrow(/replaced/);
    const next = c.arrange(named('new'), true);
    finish();
    await rejected;
    await expect(next).resolves.toMatchObject({ site: { name: 'new' } });
    expect(runtime.arrange).toHaveBeenCalledTimes(1);
  });

  it('allows a newer import to replace a build while its code is loading', async () => {
    const { c, builds, runtime, finish } = delayedRuntime();
    c.submit(named('old'), opts, false);
    const next = c.importSite(project, new Map(), {});
    finish();
    await next;
    expect(builds).toEqual([]);
    expect(runtime.build).not.toHaveBeenCalled();
  });

  it('reports a failed download and retries on the next request', async () => {
    const { runtime } = delayedRuntime();
    const load = vi.fn().mockRejectedValueOnce(new Error('download failed')).mockResolvedValue(runtime);
    const builds: SiteResult[] = [];
    const c = createSiteWorkerController({ onBuild: (r) => builds.push(r), onBusy() {} }, () => null, load);
    c.submit(named('a'), opts, false);
    await vi.waitFor(() => expect(builds[0]?.error).toBe('download failed'));
    c.submit(named('b'), opts, false);
    await vi.waitFor(() => expect(builds[1]?.error).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not load local code when the worker works', () => {
    const w = fakeWorker();
    const load = vi.fn();
    const c = createSiteWorkerController({ onBuild() {}, onBusy() {} }, () => w as unknown as Worker, load);
    c.submit(named('a'), opts, false);
    expect(w.sent).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores a late error from a replaced worker', async () => {
    const old = fakeWorker();
    const fresh = fakeWorker();
    const workers = [old, fresh];
    const load = vi.fn();
    const c = createSiteWorkerController(
      { onBuild() {}, onBusy() {} },
      () => workers.shift() as unknown as Worker,
      load,
    );
    const first = c.arrange(named('old'), false);
    const rejected = expect(first).rejects.toThrow(/replaced/);
    const next = c.arrange(named('new'), false);
    old.fail();
    expect(fresh.terminated).toBe(false);
    expect(load).not.toHaveBeenCalled();
    fresh.reply({
      id: fresh.sent[0].id,
      arranged: { site: named('new'), fits: true, needed: [1, 1], floors: 1 },
    });
    await rejected;
    await next;
  });
});

describe('worker failure while loading the local fallback', () => {
  it.each(['import', 'arrange'] as const)('finishes an active %s through the real fallback', async (kind) => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const task = kind === 'import' ? c.importSite(project, new Map(), {}) : c.arrange(named('p'), true);
    w.fail();
    await expect(task).resolves.toMatchObject({ site: { name: 'p' } });
    expect(w.terminated).toBe(true);
    await expect(c.arrange(named('later'), true)).resolves.toMatchObject({ site: { name: 'later' } });
    expect(w.sent).toHaveLength(1);
  });

  it('ignores a late reply from the failed worker while fallback code is downloading', async () => {
    const w = fakeWorker();
    const { runtime } = delayedRuntime();
    let finish!: (r: LocalSiteRuntime) => void;
    const load = () =>
      new Promise<LocalSiteRuntime>((resolve) => {
        finish = resolve;
      });
    const builds: SiteResult[] = [];
    const c = createSiteWorkerController(
      { onBuild: (r) => builds.push(r), onBusy() {} },
      () => w as unknown as Worker,
      load,
    );
    c.submit(named('p'), opts, false);
    w.fail();
    w.reply({ id: w.sent[0].id, error: 'obsolete worker response' });
    expect(builds).toEqual([]);
    finish(runtime);
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    expect(builds[0].error).toBeNull();
  });
});
