import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { defaultPlan } from '../state/store';
import {
  createMachineWorkerController,
  SUPERSEDE_AFTER_MS,
  type MachineRequest,
} from './machineWorkerController';
import type { MachineWorkerRequest, MachineWorkerResponse } from './machineWorkerHandler';
import { notices } from './notices';
import type { PipelineResult } from './pipelineCore';

vi.spyOn(console, 'warn').mockImplementation(() => {});

/** A worker that records what it is sent and answers only when told to. */
function fakeWorker() {
  const sent: MachineWorkerRequest[] = [];
  const w = {
    sent,
    terminated: false,
    onmessage: null as ((e: MessageEvent<MachineWorkerResponse>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: (m: MachineWorkerRequest) => void sent.push(m),
    terminate() {
      this.terminated = true;
    },
    reply(msg: MachineWorkerResponse) {
      this.onmessage?.({ data: msg } as MessageEvent<MachineWorkerResponse>);
    },
    fail() {
      this.onerror?.({ preventDefault() {}, message: 'boom' } as ErrorEvent);
    },
  };
  return w;
}
type FakeWorker = ReturnType<typeof fakeWorker>;

const result = (error: string | null = null): PipelineResult => ({
  def: undefined,
  pack: null,
  loosened: false,
  hatches: null,
  stats: null,
  pipes: null,
  scene: null,
  error,
});

const req = (count: number, pipes = false): MachineRequest => ({
  plan: { ...defaultPlan(), count },
  pipes,
  cables: false,
  below: false,
});
const counts = (w: FakeWorker) => w.sent.map((m) => m.plan.count);

function setup(createWorker?: () => Worker | null) {
  const results: { r: PipelineResult; pending: boolean }[] = [];
  const busy: boolean[] = [];
  const clock = { t: 0 };
  const run = vi.fn((plan: { count: number }, pipes: boolean, cables: boolean, _below: boolean) =>
    result(`local ${plan.count} pipes=${pipes} cables=${cables}`),
  );
  const workers: FakeWorker[] = [];
  const c = createMachineWorkerController(
    { onResult: (r, { pending }) => results.push({ r, pending }), onBusy: (b) => busy.push(b) },
    {
      createWorker:
        createWorker ??
        (() => {
          const w = fakeWorker();
          workers.push(w);
          return w as unknown as Worker;
        }),
      run: run as never,
      now: () => clock.t,
    },
  );
  return { c, results, busy, clock, run, workers };
}

describe('machine worker controller', () => {
  beforeEach(() => notices.set([]));

  it('builds the full pipeline right here without a worker', () => {
    const { c, results, run } = setup(() => null);
    c.submit(req(3, true));
    expect(run).toHaveBeenCalledWith(expect.anything(), true, false, false);
    expect(results).toHaveLength(1);
    expect(results[0].pending).toBe(false);
  });

  it('builds right here when the worker cannot be created', () => {
    const { c, results } = setup(() => {
      throw new Error('blocked');
    });
    c.submit(req(3, true));
    expect(results).toHaveLength(1);
    expect(get(notices)).toHaveLength(0);
  });

  it('sends only the newest request once the running one is done', () => {
    const { c, results, workers } = setup();
    c.submit(req(1));
    c.submit(req(2));
    c.submit(req(3));
    const w = workers[0];
    expect(counts(w)).toEqual([1]);
    w.reply({ id: w.sent[0].id, machine: result('one') });
    expect(results.map((x) => x.r.error)).toEqual(['one']);
    expect(counts(w)).toEqual([1, 3]);
  });

  it('ignores an answer for a request it no longer waits for', () => {
    const { c, results, workers } = setup();
    c.submit(req(1));
    workers[0].reply({ id: 99, machine: result('stale') });
    expect(results).toHaveLength(0);
  });

  it('shows the partial build as pending, then the final one', () => {
    const { c, results, busy, workers } = setup();
    c.submit(req(1, true));
    const w = workers[0];
    const id = w.sent[0].id;
    w.reply({ id, machine: result('partial'), partial: true });
    w.reply({ id, machine: result('final') });
    expect(results.map((x) => [x.r.error, x.pending])).toEqual([
      ['partial', true],
      ['final', false],
    ]);
    expect(busy.at(-1)).toBe(false);
  });

  it('drops a partial build when a newer request is waiting', () => {
    const { c, results, workers } = setup();
    c.submit(req(1, true));
    c.submit(req(2, true));
    const w = workers[0];
    w.reply({ id: w.sent[0].id, machine: result('partial'), partial: true });
    expect(results).toHaveLength(0);
  });

  it('queues a request while the running job is not old enough', () => {
    const { c, workers, clock } = setup();
    c.submit(req(1));
    clock.t = SUPERSEDE_AFTER_MS;
    c.submit(req(2));
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(counts(workers[0])).toEqual([1]);
  });

  it('restarts the worker with the newest request when the running job is old', () => {
    const { c, workers, clock } = setup();
    c.submit(req(1));
    clock.t = SUPERSEDE_AFTER_MS + 1;
    c.submit(req(2));
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(counts(workers[1])).toEqual([2]);
    // The new job is young, so the next request waits behind it.
    c.submit(req(3));
    expect(counts(workers[1])).toEqual([2]);
    // An answer from the stopped worker is not heard.
    const stale = workers[0];
    stale.reply({ id: stale.sent[0].id, machine: result('stale') });
    workers[1].reply({ id: workers[1].sent[0].id, machine: result('two') });
    expect(counts(workers[1])).toEqual([2, 3]);
  });

  it('cancel drops the queue and stops the running job', () => {
    const { c, results, busy, workers } = setup();
    c.submit(req(1));
    c.submit(req(2));
    c.cancel();
    const w = workers[0];
    expect(w.terminated).toBe(true);
    w.reply({ id: w.sent[0].id, machine: result('late') });
    expect(results).toHaveLength(0);
    expect(busy.at(-1)).toBe(false);
    c.submit(req(3));
    expect(workers).toHaveLength(2);
    expect(counts(workers[1])).toEqual([3]);
  });

  it('reports an error answer as a result with the error', () => {
    const { c, results, workers } = setup();
    c.submit(req(1));
    workers[0].reply({ id: workers[0].sent[0].id, error: 'bad' });
    expect(results[0].r.error).toBe('bad');
  });

  it('builds the latest request here without pipes when the worker dies, and says so once', () => {
    const { c, results, run, workers } = setup();
    c.submit(req(1, true));
    c.submit(req(2, true));
    workers[0].fail();
    expect(workers[0].terminated).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }), false, false, false);
    expect(results).toHaveLength(1);
    expect(get(notices)).toHaveLength(1);
    // Later requests stay here, without routing, and do not repeat the notice.
    c.submit(req(3, true));
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ count: 3 }), false, false, false);
    expect(workers).toHaveLength(1);
    expect(get(notices)).toHaveLength(1);
  });
});
