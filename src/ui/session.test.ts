import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { encodePlan } from '../share/codec';
import { encodeSite, emptySite } from '../share/siteCodec';
import { MODE_STORAGE_KEY, SITE_STORAGE_KEY } from '../share/sitePersist';
import { t } from '../i18n/en';
import type { SiteState } from '../model/site/types';
import { appMode, site } from '../state/site';
import { defaultPlan } from '../state/store';
import { initSession } from './session';
import { notices } from './notices';
import { answerSharedSite, initSiteSession, pendingSite } from './siteSession';

vi.spyOn(console, 'warn').mockImplementation(() => {});

function stubBrowser(
  hash: string,
  mode: 'machine' | 'site',
  seed: Record<string, string> = {},
  failWrites = false,
) {
  const store = new Map<string, string>([[MODE_STORAGE_KEY, mode], ...Object.entries(seed)]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  const location = { hash, pathname: '/', search: '', href: `http://localhost/${hash}` };
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => {
      location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    },
  });
  return store;
}

/** Starts both sessions the way App.svelte's onMount does. */
async function start(): Promise<void> {
  await Promise.all([initSession(), initSiteSession()]);
}

describe('share links pick the view', () => {
  beforeEach(() => appMode.set('machine'));
  afterEach(() => vi.unstubAllGlobals());

  for (const mode of ['machine', 'site'] as const) {
    it(`a #p= link opens the machine view (last view: ${mode})`, async () => {
      stubBrowser(`#p=${await encodePlan(defaultPlan())}`, mode);
      await start();
      expect(get(appMode)).toBe('machine');
    });

    it(`a #s= link opens the template view (last view: ${mode})`, async () => {
      stubBrowser(`#s=${await encodeSite(emptySite())}`, mode);
      await start();
      expect(get(appMode)).toBe('site');
    });

    it(`no link keeps the last view (${mode})`, async () => {
      stubBrowser('', mode);
      await start();
      expect(get(appMode)).toBe(mode);
    });
  }
});

describe('a shared #s= template is saved at once', () => {
  const shared = (): SiteState => ({
    ...emptySite(),
    name: 'Shared',
    groups: [
      {
        id: 'ebf',
        multiblockId: 'electric-blast-furnace',
        count: 2,
        limits: { x: null, y: null, z: null },
        enabledHatches: [],
        origin: [4, 4],
        rotation: 0,
      },
    ],
  });
  const stored = (store: Map<string, string>) => JSON.parse(store.get(SITE_STORAGE_KEY) ?? 'null');

  beforeEach(() => {
    appMode.set('machine');
    site.set(emptySite());
    pendingSite.set(null);
    notices.set([]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes the site without any edit when storage is empty', async () => {
    const store = stubBrowser(`#s=${await encodeSite(shared())}`, 'site');
    await start();
    expect(stored(store)?.name).toBe('Shared');
    expect(stored(store).groups).toHaveLength(1);
  });

  it('keeps an equal stored site as it is', async () => {
    const raw = JSON.stringify(shared());
    const store = stubBrowser(`#s=${await encodeSite(shared())}`, 'site', { [SITE_STORAGE_KEY]: raw });
    await start();
    expect(get(pendingSite)).toBeNull();
    expect(store.get(SITE_STORAGE_KEY)).toBe(raw);
  });

  it('leaves a different stored site untouched until the user answers', async () => {
    const mine = { ...shared(), name: 'Mine', groups: [{ ...shared().groups[0]!, id: 'dt', count: 5 }] };
    const raw = JSON.stringify(mine);
    const store = stubBrowser(`#s=${await encodeSite(shared())}`, 'site', { [SITE_STORAGE_KEY]: raw });
    await start();
    expect(get(pendingSite)?.name).toBe('Shared');
    expect(store.get(SITE_STORAGE_KEY)).toBe(raw);
    answerSharedSite(false);
    expect(store.get(SITE_STORAGE_KEY)).toBe(raw);
  });

  it('says so when the browser refuses the write', async () => {
    stubBrowser(`#s=${await encodeSite(shared())}`, 'site', {}, true);
    await start();
    expect(get(notices).map((n) => n.text)).toContain(t.saveFailed);
  });
});
