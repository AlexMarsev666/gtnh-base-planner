import { t } from '../i18n/en';
import type { HatchResult, PackResult } from '../model/plan/types';
import type { RouteNet } from '../model/routing/routeNet';
import { isSlowBuild } from './fields';
import { clearSlot, notify } from './notices';
import type { PipelineResult } from './pipeline';

/** Notice slots of the machine view, and of the template view. */
const MACHINE_SLOTS = ['pack', 'hatches', 'pipes'];
const SITE_SLOTS = ['arrange', 'import', 'import-placeholders'];

/**
 * Tells the user once per new machine result when the model had to compromise: fewer units, a loosened
 * layout, a slow count, unplaced hatches, unconnected pipes. Each warning has its own notice slot, so a
 * fixed problem's stale warning disappears with the next result.
 */
export function createBuildWarnings(): (result: PipelineResult) => void {
  let lastPack: PackResult | null = null;
  let lastHatches: HatchResult | null = null;
  let lastPipes: RouteNet[] | null = null;
  return ({ def, pack, hatches, pipes, loosened, routingTruncated }) => {
    if (pack !== lastPack) {
      if (pack && pack.placed < pack.requested)
        notify(t.placedFewer(pack.placed, pack.requested, pack.reason), 6000, 'pack');
      else if (loosened) notify(t.spacedOut(pipes !== null), 5000, 'pack');
      else clearSlot('pack');
      if (pack && def && isSlowBuild(pack.requested, def.size))
        notify(t.manyUnits(pack.requested), 8000, 'count');
      else clearSlot('count');
    }
    if (hatches !== lastHatches) {
      if (hatches?.unplaced.length) notify(t.unplacedHatches(hatches.unplaced.length), 6000, 'hatches');
      else clearSlot('hatches');
    }
    if (pipes !== lastPipes) {
      const missing = pipes?.reduce((s, n) => s + (n.total - n.connected), 0) ?? 0;
      if (missing > 0 && routingTruncated) notify(t.routingTruncated(missing), 8000, 'pipes');
      else if (missing > 0) notify(t.unconnectedPipes(missing), 6000, 'pipes');
      else clearSlot('pipes');
    }
    lastPack = pack;
    lastHatches = hatches;
    lastPipes = pipes;
  };
}

/** Machine warnings do not belong to the template view, nor template warnings to the machine view. */
export function clearOtherViewWarnings(siteMode: boolean): void {
  for (const slot of siteMode ? MACHINE_SLOTS : SITE_SLOTS) clearSlot(slot);
}
