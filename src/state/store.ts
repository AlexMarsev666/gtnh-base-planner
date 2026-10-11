import { writable } from 'svelte/store';
import { DEFAULT_MULTIBLOCK_ID, getMultiblock } from '../data/catalog';
import type { Vec3, ViewMode } from '../model/core/types';
import type { PlanState } from '../model/plan/types';

export function defaultPlan(multiblockId = DEFAULT_MULTIBLOCK_ID): PlanState {
  const def = getMultiblock(multiblockId);
  return {
    v: 1,
    multiblockId,
    count: 4,
    limits: { x: null, y: null, z: null },
    enabledHatches: def ? [...def.defaultHatches] : [],
    colors: {},
  };
}

export const plan = writable<PlanState>(defaultPlan());
/** Always DETAILED in the app; the renderer falls back to SIMPLE when the textures cannot load. */
export const viewMode = writable<ViewMode>('detailed');
export const showPipes = writable(false);
export const showCables = writable(false);
export const xray = writable(false);

const BELOW_KEY = 'gtnh-planner:below';

function storedBelow(): boolean {
  try {
    return globalThis.localStorage?.getItem(BELOW_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Hatches may face down from a build's lowest layer and pipes may run in the layer under it (a trench), in
 * the machine and template views alike. On by default; remembered per browser.
 */
export const connectBelow = writable(storedBelow());
connectBelow.subscribe((on) => {
  try {
    globalThis.localStorage?.setItem(BELOW_KEY, on ? '1' : '0');
  } catch {
    // Not important enough to report.
  }
});
export const selectedUnits = writable<number[]>([]);
/**
 * The hatch picked in the 3D view, by its `planHatchKeys` key and cell: highlighted, and its row in Settings
 * emphasised. It is dropped once the build has no such hatch at that cell.
 */
export const selectedHatch = writable<{ key: string; cell: Vec3 } | null>(null);
// A key names a hatch of one build only.
let hatchPlanId = '';
plan.subscribe((p) => {
  if (p.multiblockId !== hatchPlanId) selectedHatch.set(null);
  hatchPlanId = p.multiblockId;
});
