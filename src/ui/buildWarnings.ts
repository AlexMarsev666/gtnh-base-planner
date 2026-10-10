import { t } from '../i18n/en';
import { isSlowBuild } from './fields';
import { clearSlot, notify } from './notices';
import type { BuildResult } from './pipeline';

/** Notice slots of the machine view, and of the template view. */
const MACHINE_SLOTS = ['pack', 'hatches', 'pipes'];
const SITE_SLOTS = ['arrange', 'import', 'import-placeholders'];

/**
 * Tells the user once per new machine result when the model had to compromise: fewer units, a loosened
 * layout, a slow count, unplaced hatches, unconnected pipes. Each warning has its own notice slot, so a
 * fixed problem's stale warning disappears with the next result. Results from the build worker are new
 * objects every time, so a result is compared by what it says (a small signature), not by identity; a
 * result still waiting for its pipes (`pending`) says nothing yet.
 */
export function createBuildWarnings(): (result: BuildResult) => void {
  let lastPack: string | undefined;
  let lastHatches: string | undefined;
  let lastPipes: string | undefined;
  return ({ def, pack, hatches, pipes, loosened, routingTruncated, pending }) => {
    if (pending) return;
    const packSig = `${pack?.placed}/${pack?.requested}/${pack?.reason}/${loosened}/${pipes !== null}/${def?.id}/${def?.size.join()}`;
    if (packSig !== lastPack) {
      if (pack && pack.placed < pack.requested)
        notify(t.placedFewer(pack.placed, pack.requested, pack.reason), 6000, 'pack');
      else if (loosened) notify(t.spacedOut(pipes !== null), 5000, 'pack');
      else clearSlot('pack');
      if (pack && def && isSlowBuild(pack.requested, def.size))
        notify(t.manyUnits(pack.requested), 8000, 'count');
      else clearSlot('count');
    }
    const hatchSig = `${def?.id}/${hatches?.unplaced.length}`;
    if (hatchSig !== lastHatches) {
      if (hatches?.unplaced.length) notify(t.unplacedHatches(hatches.unplaced.length), 6000, 'hatches');
      else clearSlot('hatches');
    }
    const missing = pipes?.reduce((s, n) => s + (n.total - n.connected), 0) ?? 0;
    const pipeSig = `${missing}/${routingTruncated === true}`;
    if (pipeSig !== lastPipes) {
      if (missing > 0 && routingTruncated) notify(t.routingTruncated(missing), 8000, 'pipes');
      else if (missing > 0) notify(t.unconnectedPipes(missing), 6000, 'pipes');
      else clearSlot('pipes');
    }
    lastPack = packSig;
    lastHatches = hatchSig;
    lastPipes = pipeSig;
  };
}

/** Machine warnings do not belong to the template view, nor template warnings to the machine view. */
export function clearOtherViewWarnings(siteMode: boolean): void {
  for (const slot of siteMode ? MACHINE_SLOTS : SITE_SLOTS) clearSlot(slot);
}
