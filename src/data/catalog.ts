import type { MultiblockDef } from '../model/multiblock/types';

/**
 * All multiblock definitions, sorted by name. Empty until `loadCatalog()` has resolved: the app awaits it
 * before mounting, the workers before handling their first message, and the Vitest setup before each test
 * file. It is filled in place, so `import { catalog }` bindings stay valid.
 */
export const catalog: MultiblockDef[] = [];

let loading: Promise<void> | undefined;

/** Loads the definitions (a separate chunk). Idempotent: calls share one promise, until it fails. */
export function loadCatalog(): Promise<void> {
  loading ??= import('./catalogData').then(
    ({ definitions }) => {
      catalog.push(...[...definitions].sort((a, b) => a.name.localeCompare(b.name)));
    },
    (err: unknown) => {
      loading = undefined; // a later call retries
      throw err;
    },
  );
  return loading;
}

export function getMultiblock(id: string): MultiblockDef | undefined {
  if (catalog.length === 0) throw new Error('The catalog is not loaded yet: await loadCatalog() first.');
  return catalog.find((d) => d.id === id);
}

export const DEFAULT_MULTIBLOCK_ID = 'coke-oven';
