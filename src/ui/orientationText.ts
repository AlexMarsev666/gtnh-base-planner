import { t } from '../i18n/en';
import { composeVariants, variantOfDef } from '../model/mirror';
import type { MultiblockDef } from '../model/multiblock/types';

/** Can the Mirror toggle be switched on? Not when GT doesn't allow the machine mirrored; an old plan that has it on can still turn it off. */
export function mirrorDisabled(def: Pick<MultiblockDef, 'variants'> | undefined, on: boolean): boolean {
  return !on && !!def?.variants && !def.variants.includes(1);
}

/** The orientation of a unit as the player would build it (absolute variant), or null when it is plain. */
export function unitOrientation(
  def: MultiblockDef | undefined,
  unitVariant: 0 | 1 | 2 | 3 | undefined,
): string | null {
  const v = composeVariants(def ? variantOfDef(def) : 0, unitVariant ?? 0);
  return v === 0 ? null : t.orientation[v];
}
