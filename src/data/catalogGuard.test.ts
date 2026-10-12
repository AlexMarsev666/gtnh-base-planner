import { beforeEach, describe, expect, it, vi } from 'vitest';

// The test setup loads the catalog before every test file, which hides modules that read it while they are
// evaluated: in the app those run before `loadCatalog()` has resolved and would blank the page. Resetting the
// module registry gives each import below a fresh, unloaded catalog.
describe('modules evaluate without the catalog loaded', () => {
  beforeEach(() => vi.resetModules());

  const modules: [string, () => Promise<unknown>][] = [
    ['state/store', () => import('../state/store')],
    ['state/site', () => import('../state/site')],
    ['ui/session', () => import('../ui/session')],
    ['ui/siteSession', () => import('../ui/siteSession')],
    ['ui/appSession', () => import('../ui/appSession')],
    ['ui/pipeline', () => import('../ui/pipeline')],
    ['ui/sitePipeline', () => import('../ui/sitePipeline')],
    ['share/codec', () => import('../share/codec')],
    ['share/siteCodec', () => import('../share/siteCodec')],
    ['data/generic', () => import('./generic')],
    ['data/gtnhplanner-machines', () => import('./gtnhplanner-machines')],
    ['import/gtnhplanner', () => import('../import/gtnhplanner')],
    ['model/hatches/legacyCases', () => import('../model/hatches/legacyCases')],
    ['ui/App', () => import('../ui/App.svelte')],
  ];

  it.each(modules)('%s', async (_name, load) => {
    await expect(load()).resolves.toBeDefined();
  });

  it('getMultiblock refuses to answer before the load', async () => {
    const { getMultiblock, loadCatalog } = await import('./catalog');
    expect(() => getMultiblock('coke-oven')).toThrow(/not loaded/);
    await loadCatalog();
    expect(getMultiblock('coke-oven')).toBeDefined();
  });
});
