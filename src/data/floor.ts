/**
 * Blocks a template's floor can be made of (`SiteState.floor`). Ids from `blocks.ts`, each with a texture in
 * the atlas; the first is the one a new floor starts with.
 */
export const FLOOR_BLOCKS = [
  'gregtech:gt.blockconcretes@8',
  'gt.casing.solidSteel',
  'gt.casing.cleanStainless',
  'gt.casing.ulv',
  'mc.ironBlock',
] as const;

export type FloorBlock = (typeof FLOOR_BLOCKS)[number];

export function isFloorBlock(id: unknown): id is FloorBlock {
  return typeof id === 'string' && (FLOOR_BLOCKS as readonly string[]).includes(id);
}
