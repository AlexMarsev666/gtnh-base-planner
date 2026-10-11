import { derived, writable, type Readable } from 'svelte/store';
import { getMultiblock } from '../data/catalog';
import { requiredBlocks, type Bom } from '../model/bom';
import { mirroredDef } from '../model/mirror';
import { effectiveSize, sizedDef } from '../model/resize';
import type { PlanState } from '../model/plan/types';
import type { SceneModel } from '../model/render/types';
import type { MultiblockDef } from '../model/multiblock/types';
import type { AppMode } from '../share/sitePersist';
import { appMode } from '../state/site';
import { connectBelow, plan, showCables, showPipes } from '../state/store';
import { createMachineWorkerController, type MachineWorkerController } from './machineWorkerController';
import { createPipeline, type PipelineResult } from './pipelineCore';

export * from './pipelineCore';

/** What the machine view shows before it has been built (the template view never builds it). */
const NOT_BUILT: PipelineResult = {
  def: undefined,
  pack: null,
  loosened: false,
  hatches: null,
  stats: null,
  pipes: null,
  scene: null,
  error: null,
};

/** The build for the current plan, and whether it is still waiting for its pipes and cables. */
export type BuildResult = PipelineResult & { pending?: boolean };

/** Quick builds do not flash the busy indicator. */
const BUSY_DELAY_MS = 250;

/**
 * The build for the current plan; recomputes only when the plan or the view toggles change. Packing and
 * routing run in a worker (`machineWorkerController`): the last result stays on screen while a newer one is
 * computed, and with pipes or cables on the build without them is shown first (`pending`). Without workers
 * it builds right here. While the template view is shown it keeps the last result and requests nothing (the
 * machine view is not on screen); coming back to the machine view builds it again.
 */
export function createBuildStore(
  run: ReturnType<typeof createPipeline> = createPipeline(),
  mode: Readable<AppMode> = appMode,
  createController: (
    events: Parameters<typeof createMachineWorkerController>[0],
  ) => MachineWorkerController = (events) => createMachineWorkerController(events, { run }),
) {
  const result = writable<BuildResult>(NOT_BUILT, () => {
    const stop = derived([plan, showPipes, showCables, connectBelow, mode], (x) => x).subscribe(
      ([$plan, $pipes, $cables, $below, $mode]) => {
        if ($mode === 'machine')
          controller.submit({ plan: $plan, pipes: $pipes, cables: $cables, below: $below });
      },
    );
    return () => {
      stop();
      controller.cancel();
    };
  });
  const busy = writable(false);
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = createController({
    onResult: (r, { pending }) => result.set(pending ? { ...r, pending: true } : r),
    onBusy: (on) => {
      if (on) busyTimer ??= setTimeout(() => busy.set(true), BUSY_DELAY_MS);
      else {
        clearTimeout(busyTimer);
        busyTimer = undefined;
        busy.set(false);
      }
    },
  });
  return { build: result as Readable<BuildResult>, busy: busy as Readable<boolean> };
}

const machine = createBuildStore();
export const build = machine.build;
/** A build has been running for a while for a plan newer than the one shown. */
export const machineBusy = machine.busy;

/** The multiblock of the current plan at its size, known at once (the build itself arrives later). */
export const machineDef: Readable<MultiblockDef | undefined> = derived(plan, ($plan) => {
  const raw = getMultiblock($plan.multiblockId);
  if (!raw) return undefined;
  const sized = sizedDef(raw, effectiveSize(raw, $plan.size));
  return $plan.mirror ? mirroredDef(sized) : sized;
});

/** The bill of materials of a machine build, with the plan's machine and hatch tiers. */
export function planBom(scene: SceneModel, p: Pick<PlanState, 'tier' | 'hatchTiers'>): Bom {
  return requiredBlocks(scene, undefined, {
    machineTier: p.tier,
    hatchTiers: p.hatchTiers,
  });
}

/** The bill of materials of the machine on screen (empty before it is built). */
export const machineBom: Readable<Bom> = derived([build, plan], ([$build, $plan]) =>
  $build.scene ? planBom($build.scene, $plan) : { blocks: [], io: [], totalBlocks: 0 },
);
