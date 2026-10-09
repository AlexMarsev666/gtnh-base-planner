import type { MultiblockDef } from '../model/multiblock/types';
import { withRequiredDefaults, withSourceCounts } from '../model/multiblock/rules';
import { withReviewedStructure } from '../model/multiblock/structureAdapters';

/** All multiblock definitions, loaded from `./multiblocks/*.json` at build time. */
const modules = import.meta.glob<MultiblockDef>('./multiblocks/*.json', { eager: true, import: 'default' });

export const catalog: readonly MultiblockDef[] = Object.values(modules)
  .map(withSourceCounts)
  .map(withReviewedStructure)
  .map(withRequiredDefaults)
  .sort((a, b) => a.name.localeCompare(b.name));

export function getMultiblock(id: string): MultiblockDef | undefined {
  return catalog.find((d) => d.id === id);
}

export const DEFAULT_MULTIBLOCK_ID = 'coke-oven';
