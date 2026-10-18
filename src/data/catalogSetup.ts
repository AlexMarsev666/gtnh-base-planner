import { loadCatalog } from './catalog';

// Vitest setup file (see vitest.config.ts): the tests read the catalog synchronously.
await loadCatalog();
