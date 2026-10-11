import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SiteRouting } from '../model/site/types';
import { emptySite, siteFromJson } from '../share/siteCodec';
import type { SiteWorkerRequest, SiteWorkerResponse } from './siteWorker';
import { createSiteWorkerController, JobCancelled, type SiteResult } from './siteWorkerController';

vi.spyOn(console, 'warn').mockImplementation(() => {});

const opts = { pipes: false, cables: false };
const flat: SiteRouting = { style: 'classic', depth: 0 };
const under: SiteRouting = { style: 'classic', depth: 1 };

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
  const progress: ({ done: number; total: number; phase: string } | null)[] = [];
  const c = createSiteWorkerController(
    { onBuild: (r) => builds.push(r), onBusy: (b) => busy.push(b), onProgress: (p) => progress.push(p) },
    worker,
  );
  return { c, builds, busy, progress };
}

const fixtureSite = (name: string) =>
  siteFromJson(readFileSync(new URL(`../share/fixtures/${name}`, import.meta.url), 'utf8'));

const named = (name: string) => ({ ...emptySite(), name });

describe('site worker controller', () => {
  it('builds right here without a worker', () => {
    const { c, builds } = setup(() => null);
    c.submit(named('a'), opts, false);
    expect(builds).toHaveLength(1);
    expect(builds[0].build?.groups).toEqual([]);
  });

  it('builds right here when the worker cannot be created', () => {
    const { c, builds, busy } = setup(() => {
      throw new Error('blocked');
    });
    c.submit(named('a'), opts, false);
    expect(builds).toHaveLength(1);
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

  it('finishes the queued build here when the worker fails', () => {
    const w = fakeWorker();
    const { c, builds } = setup(() => w as unknown as Worker);
    c.submit(named('a'), opts, false);
    c.submit(named('b'), opts, false);
    w.fail();
    expect(w.terminated).toBe(true);
    expect(builds).toHaveLength(1);
    // Later builds skip the worker.
    c.submit(named('c'), opts, false);
    expect(builds).toHaveLength(2);
    expect(w.sent).toHaveLength(1);
  });

  it('rejects an import that a newer one replaces', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const project = {
      name: 'p',
      recipes: new Map(),
      nodes: [],
      storages: [],
      edges: [],
      skipped: 0,
      adjusted: 0,
    };
    const first = c.importSite(project, new Map(), {});
    void c.importSite(project, new Map(), {});
    await expect(first).rejects.toEqual(new JobCancelled('import'));
  });

  it('arranges in the worker and hands back what it answers', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const site = named('a');
    const done = c.arrange(site, under);
    expect(w.sent[0]).toMatchObject({ type: 'arrange', site, routing: under });
    const arranged = { site, fits: true, needed: [10, 10] as [number, number], floors: 2 };
    w.reply({ id: w.sent[0].id, arranged });
    await expect(done).resolves.toEqual(arranged);
  });

  it('asks the worker to optimise as well only when told to', async () => {
    const w = fakeWorker();
    const { c } = setup(() => w as unknown as Worker);
    const site = named('a');
    const plain = c.arrange(site, flat);
    expect(w.sent[0]).toMatchObject({ type: 'arrange', optimize: false });
    w.reply({ id: w.sent[0].id, arranged: { site, fits: true, needed: [10, 10], floors: 1 } });
    await plain;
    const tuned = c.arrange(site, flat, true);
    expect(w.sent[1]).toMatchObject({ type: 'arrange', optimize: true });
    const optimized = {
      improved: false,
      reshaped: 0,
      start: { problems: 0, unconnected: 0, blocks: 1, span: 1 },
      truncated: false,
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
    const r = await c.arrange(named('a'), flat, true);
    expect(r.fits).toBe(true);
    expect(r.optimized).toBeDefined();
    expect((await c.arrange(named('a'), flat)).optimized).toBeUndefined();
  });

  it('arranges right here without a worker, and rejects an arrangement a newer job replaces', async () => {
    const { c } = setup(() => null);
    const r = await c.arrange(named('a'), flat);
    expect(r).toMatchObject({ fits: true, floors: 1 });
    const w = fakeWorker();
    const { c: c2 } = setup(() => w as unknown as Worker);
    const first = c2.arrange(named('a'), flat);
    void c2.arrange(named('b'), flat);
    await expect(first).rejects.toEqual(new JobCancelled('arrange'));
  });

  describe('cancelling', () => {
    const project = {
      name: 'p',
      recipes: new Map(),
      nodes: [],
      storages: [],
      edges: [],
      skipped: 0,
      adjusted: 0,
    };

    it('stops an import whose signal is aborted, and uses a new worker afterwards', async () => {
      const workers: ReturnType<typeof fakeWorker>[] = [];
      const { c } = setup(() => {
        workers.push(fakeWorker());
        return workers.at(-1) as unknown as Worker;
      });
      const ac = new AbortController();
      const imp = c.importSite(project, new Map(), {}, ac.signal);
      ac.abort();
      await expect(imp).rejects.toEqual(new JobCancelled('aborted'));
      expect(workers[0].terminated).toBe(true);
      c.submit(named('a'), opts, false);
      expect(workers).toHaveLength(2);
      expect(workers[1].sent[0]).toMatchObject({ type: 'build' });
    });

    it('does not touch a different job when an old import is aborted', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const ac = new AbortController();
      const first = c.importSite(project, new Map(), {}, ac.signal);
      const second = c.importSite(project, new Map(), {});
      await expect(first).rejects.toEqual(new JobCancelled('import'));
      w.terminated = false;
      ac.abort();
      expect(w.terminated).toBe(false);
      void second;
    });

    it('rejects at once for a signal already aborted', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const ac = new AbortController();
      ac.abort();
      await expect(c.importSite(project, new Map(), {}, ac.signal)).rejects.toEqual(
        new JobCancelled('aborted'),
      );
      expect(w.sent).toHaveLength(0);
    });

    it('cancels an arrange when another site is submitted, then sends that build', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const a = named('a');
      const job = c.arrange(a, flat);
      c.submit(named('b'), opts, false);
      await expect(job).rejects.toEqual(new JobCancelled('edit'));
      expect(w.terminated).toBe(true);
    });

    it('sends the new build to a new worker after cancelling an arrange', async () => {
      const workers: ReturnType<typeof fakeWorker>[] = [];
      const { c } = setup(() => {
        workers.push(fakeWorker());
        return workers.at(-1) as unknown as Worker;
      });
      const job = c.arrange(named('a'), flat);
      c.submit(named('b'), opts, false);
      await expect(job).rejects.toBeInstanceOf(JobCancelled);
      expect(workers).toHaveLength(2);
      expect(workers[1].sent[0]).toMatchObject({ type: 'build', site: { name: 'b' } });
    });

    it('keeps an arrange running when the same site is submitted again', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const a = named('a');
      const job = c.arrange(a, flat);
      c.submit(a, { pipes: true, cables: false }, false);
      expect(w.terminated).toBe(false);
      const arranged = { site: a, fits: true, needed: [10, 10] as [number, number], floors: 1 };
      w.reply({ id: w.sent[0].id, arranged });
      await expect(job).resolves.toEqual(arranged);
      expect(w.sent[1]).toMatchObject({ type: 'build' });
    });

    it('cancels an arrange when connecting from below changes', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const a = named('a');
      const job = c.arrange(a, flat);
      c.submit(a, { ...opts, below: false }, false);
      expect(w.terminated).toBe(false);
      c.submit(a, { ...opts, below: true }, false);
      await expect(job).rejects.toEqual(new JobCancelled('edit'));
    });
  });
  describe('arrange progress and cancel', () => {
    it('reports the worker progress of the running arrange, and null when it is over', async () => {
      const w = fakeWorker();
      const { c, progress } = setup(() => w as unknown as Worker);
      const site = named('a');
      const job = c.arrange(site, under, true);
      expect(progress).toEqual([{ done: 0, total: 0, phase: 'arrange' }]);
      w.reply({ id: w.sent[0].id, progress: { done: 3, total: 10, phase: 'optimize' } });
      // A report for another job is ignored.
      w.reply({ id: w.sent[0].id + 1, progress: { done: 9, total: 10, phase: 'optimize' } });
      expect(progress.at(-1)).toEqual({ done: 3, total: 10, phase: 'optimize' });
      w.reply({ id: w.sent[0].id, arranged: { site, fits: true, needed: [1, 1], floors: 1 } });
      await job;
      expect(progress.at(-1)).toBeNull();
      // Late reports after the end are ignored.
      w.reply({ id: w.sent[0].id, progress: { done: 10, total: 10, phase: 'optimize' } });
      expect(progress.at(-1)).toBeNull();
    });

    it('cancels the running arrange: the worker stops, the job rejects as aborted, nothing is delivered', async () => {
      const workers: ReturnType<typeof fakeWorker>[] = [];
      const { c, builds, progress } = setup(() => {
        workers.push(fakeWorker());
        return workers.at(-1) as unknown as Worker;
      });
      const site = named('a');
      const job = c.arrange(site, under, true);
      c.cancelArrange();
      await expect(job).rejects.toEqual(new JobCancelled('aborted'));
      expect(workers[0].terminated).toBe(true);
      expect(progress.at(-1)).toBeNull();
      // The result of the cancelled worker (if it still came) is not applied.
      workers[0].reply({
        id: workers[0].sent[0].id,
        arranged: { site, fits: true, needed: [1, 1], floors: 1 },
      });
      expect(builds).toEqual([]);
      // Cancelling with nothing running does nothing.
      c.cancelArrange();
      expect(workers).toHaveLength(1);
    });

    it('reports progress of the arrange phase too, without optimising', async () => {
      const { c, progress } = setup(() => null);
      await c.arrange(fixtureSite('import.json'), under);
      expect(progress.some((p) => p && p.total > 0 && p.done === p.total)).toBe(true);
      expect(progress.filter((p) => p && p.total > 0).every((p) => p!.phase === 'arrange')).toBe(true);
      expect(progress.at(-1)).toBeNull();
    });

    it('reports one monotonic scale across the arrange and optimise phases', async () => {
      const { c, progress } = setup(() => null);
      await c.arrange(fixtureSite('import.json'), under, true);
      const real = progress.filter((p) => p && p.total > 0) as {
        done: number;
        total: number;
        phase: string;
      }[];
      expect(new Set(real.map((p) => p.total)).size).toBe(1);
      expect(real.map((p) => p.done)).toEqual([...real.map((p) => p.done)].sort((a, b) => a - b));
      expect(real.some((p) => p.phase === 'arrange')).toBe(true);
      expect(real.some((p) => p.phase === 'optimize')).toBe(true);
      expect(real.filter((p) => p.phase === 'arrange').every((p) => p.done <= p.total / 10)).toBe(true);
    });

    it('does not cancel an import or a build', () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      c.submit(named('a'), opts, false);
      c.cancelArrange();
      expect(w.terminated).toBe(false);
    });

    it('drops the result when the template changed meanwhile, also when only the routing did', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const site = named('a');
      const job = c.arrange(site, under);
      // The same routing in another spelling does not matter.
      c.submit(site, { ...opts, below: true, routing: { style: 'classic', depth: 1 } }, false);
      expect(w.terminated).toBe(false);
      c.submit(site, { ...opts, routing: { style: 'neat', depth: 1 } }, false);
      await expect(job).rejects.toEqual(new JobCancelled('edit'));
      expect(w.terminated).toBe(true);
    });

    it('keeps a neat arrange running when the unchanged site is built, and cancels it when its routing changes', async () => {
      const w = fakeWorker();
      const { c } = setup(() => w as unknown as Worker);
      const site = named('a');
      const neat: SiteRouting = { style: 'neat', depth: 1 };
      const job = c.arrange(site, neat, false, flat);
      c.submit(site, { ...opts, below: false, routing: flat }, false);
      expect(w.terminated).toBe(false);
      c.submit(site, { ...opts, below: true, routing: under }, false);
      await expect(job).rejects.toEqual(new JobCancelled('edit'));
    });

    it('interrupts an arrangement done here from a progress report', async () => {
      const progress: ({ done: number; total: number; phase: string } | null)[] = [];
      let cancel = () => {};
      const c = createSiteWorkerController(
        {
          onBuild: () => {},
          onBusy: () => {},
          onProgress: (p) => {
            progress.push(p);
            if (p && p.total > 0) cancel();
          },
        },
        () => null,
      );
      cancel = () => c.cancelArrange();
      const job = c.arrange(fixtureSite('import.json'), under, true);
      await expect(job).rejects.toEqual(new JobCancelled('aborted'));
      expect(progress.at(-1)).toBeNull();
    });
  });
});
