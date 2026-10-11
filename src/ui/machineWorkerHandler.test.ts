import { describe, expect, it } from 'vitest';
import { defaultPlan } from '../state/store';
import {
  createMachineHandler,
  type MachineWorkerRequest,
  type MachineWorkerResponse,
} from './machineWorkerHandler';
import { createPipeline, defaultDeps } from './pipelineCore';

type Built = Extract<MachineWorkerResponse, { machine: unknown }>;

/** A handler over real pipelines; `routed` counts how often the routing model ran. */
function setup() {
  let routed = 0;
  const counting = {
    ...defaultDeps,
    routePipes: ((...args: Parameters<typeof defaultDeps.routePipes>) => {
      routed++;
      return defaultDeps.routePipes(...args);
    }) as typeof defaultDeps.routePipes,
    loosenings: defaultDeps.loosenings,
  };
  const handler = createMachineHandler(createPipeline(counting), createPipeline(counting));
  const handle = (over: Partial<MachineWorkerRequest>) => {
    const out: MachineWorkerResponse[] = [];
    handler(
      { id: 7, type: 'machine', plan: defaultPlan(), pipes: false, cables: false, below: false, ...over },
      (m) => out.push(m),
    );
    return out;
  };
  return { handle, routed: () => routed };
}

const handle = (over: Partial<MachineWorkerRequest>) => setup().handle(over);

describe('machine worker handler', () => {
  it('posts the build without pipes first, then the routed one', () => {
    const out = handle({ pipes: true });
    expect(out.map((m) => m.id)).toEqual([7, 7]);
    const [partial, final] = out as Built[];
    expect(partial.partial).toBe(true);
    expect(partial.machine.pipes).toBeNull();
    expect(final.partial).toBeUndefined();
    expect(final.machine.pipes).not.toBeNull();
  });

  it('answers a colour-only change from the memo, with no preview and no new routing', () => {
    const { handle, routed } = setup();
    const plan = defaultPlan();
    handle({ plan, pipes: true });
    const before = routed();
    expect(before).toBeGreaterThan(0);
    const out = handle({ plan: { ...plan, colors: { ...plan.colors, itemIn: '#123456' } }, pipes: true });
    expect(out).toHaveLength(1);
    expect((out[0] as Built).partial).toBeUndefined();
    expect(routed()).toBe(before);
    // A real change previews again.
    expect(handle({ plan: { ...plan, count: plan.count + 1 }, pipes: true })).toHaveLength(2);
  });

  it('does not preview again for a tier change', () => {
    const { handle } = setup();
    const plan = defaultPlan();
    handle({ plan, pipes: true });
    expect(handle({ plan: { ...plan, tier: 'HV' }, pipes: true })).toHaveLength(1);
    expect(
      handle({ plan: { ...plan, tier: 'HV', hatchTiers: { 'itemIn:0': 'EV' } }, pipes: true }),
    ).toHaveLength(1);
  });

  it('posts one build when nothing is routed, and it survives structured clone', () => {
    const out = handle({});
    expect(out).toHaveLength(1);
    expect(() => structuredClone(out[0])).not.toThrow();
  });

  it('posts an unknown multiblock as a result with an error', () => {
    const out = handle({ plan: { ...defaultPlan(), multiblockId: 'nope' } });
    expect(out).toHaveLength(1);
    expect((out[0] as Built).machine.error).toContain('nope');
  });
});
