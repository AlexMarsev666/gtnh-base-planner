import type { PlanState } from '../model/plan/types';
import type { PipelineResult, createPipeline } from './pipelineCore';

/** A machine build for the worker (see `handleMachineRequest`). */
export interface MachineWorkerRequest {
  id: number;
  type: 'machine';
  plan: PlanState;
  pipes: boolean;
  cables: boolean;
  below: boolean;
}

/** `partial`: the build without pipes and cables, sent first when routing follows. */
export type MachineWorkerResponse =
  { id: number; machine: PipelineResult; partial?: true } | { id: number; error: string };

/**
 * Handles machine requests. With pipes or cables on and an automatic layout, the unrouted build is posted
 * first, then the routed one. The two use separate pipelines: sharing one would make every request evict the
 * other's memo (the unrouted run has a different hatch key), so routing would restart from scratch even for a
 * colour change. A request that differs from the previous one only in colours posts no preview: the routed
 * build comes straight from the memo, and the pipes on screen do not flash away.
 */
export function createMachineHandler(
  preview: ReturnType<typeof createPipeline>,
  full: ReturnType<typeof createPipeline>,
) {
  let lastShape: string | undefined;
  return (req: MachineWorkerRequest, post: (out: MachineWorkerResponse) => void): void => {
    try {
      const { id, plan, pipes, cables, below } = req;
      const shape = JSON.stringify([{ ...plan, colors: undefined }, pipes, cables, below]);
      const colourOnly = shape === lastShape;
      lastShape = shape;
      if ((pipes || cables) && !plan.manualUnits && !colourOnly)
        post({ id, machine: preview(plan, false, false, below), partial: true });
      post({ id, machine: full(plan, pipes, cables, below) });
    } catch (err) {
      post({ id: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
