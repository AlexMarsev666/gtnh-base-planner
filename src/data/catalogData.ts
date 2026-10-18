import type { MultiblockDef } from '../model/multiblock/types';

/**
 * All multiblock definitions, loaded from `./multiblocks/*.json` at build time. This module is the only
 * place that holds the JSON, and `loadCatalog` in `./catalog` imports it dynamically: the data is by far the
 * biggest part of the app, so it ships as its own chunk, fetched in parallel with the main script.
 */
const modules = import.meta.glob<MultiblockDef>('./multiblocks/*.json', { eager: true, import: 'default' });

export const definitions: readonly MultiblockDef[] = Object.values(modules);
