import type { HatchKind, MultiblockDef } from '../multiblock/types';
import type { ResourceBinding } from './types';
import { hasLayeredFluidOutputs, isOilCracker } from '../multiblock/structureAdapters';

export function resourceRegion(
  def: MultiblockDef,
  kind: HatchKind,
  binding?: ResourceBinding,
): string | null | undefined {
  const roles = def.resourceHatchRegions?.[kind];
  if (roles) return binding?.role ? (roles[binding.role] ?? null) : null;
  if (isOilCracker(def) && kind === 'fluidIn') {
    return binding?.role === 'catalyst' ? 'middle' : binding?.role === 'feed' ? 'side' : null;
  }
  if (hasLayeredFluidOutputs(def) && kind === 'fluidOut') {
    if (binding?.outputSlot === undefined) return null;
    const regions = def.fluidOutputRegions ?? def.requiredHatches?.fluidOut?.regions ?? [];
    return regions[binding.outputSlot] ?? null;
  }
  return undefined;
}
