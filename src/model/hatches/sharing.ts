import type { HatchKind, MultiblockDef } from '../multiblock/types';

/**
 * Which hatch kinds units that share a wall may share one block of. GT adds a hatch inside two structures to
 * both controllers' lists, so any kind can be shared; what differs is whether it is a good idea:
 * - Items, fluids and steam (`def.shareableHatches`) and the muffler (pollution is counted per controller, so a
 *   shared one just needs air in front) are always shared on a `wallshare` def (`SHARED_ALWAYS`).
 * - Maintenance is the user's choice: a manual repair fixes only the first controller that checks the hatch.
 * - Energy is the user's choice too: a hatch supplies 2 A and each controller draws 1 A, so it serves two units.
 */

/** Kinds shared on every `wallshare` def, besides the def's own `shareableHatches`. */
export const SHARED_ALWAYS: readonly HatchKind[] = ['muffler'];

/** Most units one hatch of a kind may serve; kinds not listed have no limit. */
export const SHARE_LIMIT: Partial<Record<HatchKind, number>> = { energy: 2 };

/** The optional sharing settings of a plan or template group (absent = off). */
export interface SharingOptions {
  maintenance?: boolean;
  energy?: boolean;
}

/**
 * The options that change anything on `def`, as flags for cache keys: an option does nothing on a def that
 * cannot share walls or has no cell for the kind, so toggling it there must not rebuild.
 */
export function effectiveSharing(
  def: MultiblockDef,
  opts: SharingOptions,
): { maintenance: boolean; energy: boolean } {
  return {
    maintenance: !!opts.maintenance && withSharing(def, { maintenance: true }) !== def,
    energy: !!opts.energy && withSharing(def, { energy: true }) !== def,
  };
}

const memo = new WeakMap<MultiblockDef, MultiblockDef[]>();

/**
 * `def` with maintenance and/or energy hatches added to its `shareableHatches`. Memoised per definition (so
 * the per-def caches keep working); the def itself when nothing changes (sharing off, no wall sharing, or the
 * def has no cell for the kind).
 */
export function withSharing(def: MultiblockDef, opts: SharingOptions): MultiblockDef {
  const add: HatchKind[] = [];
  if (def.wallshare) {
    if (opts.maintenance && def.hatchBlocks.maintenance && !def.shareableHatches.includes('maintenance'))
      add.push('maintenance');
    if (opts.energy && def.hatchBlocks.energy && !def.shareableHatches.includes('energy')) add.push('energy');
  }
  if (add.length === 0) return def;
  const index = (add.includes('maintenance') ? 1 : 0) + (add.includes('energy') ? 2 : 0);
  let variants = memo.get(def);
  if (!variants) memo.set(def, (variants = []));
  return (variants[index] ??= { ...def, shareableHatches: [...def.shareableHatches, ...add] });
}
