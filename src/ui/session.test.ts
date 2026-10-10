import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { encodePlan } from '../share/codec';
import { STORAGE_KEY, planToJson } from '../share/persist';
import { encodeSite, emptySite, siteToJson } from '../share/siteCodec';
import { MODE_STORAGE_KEY, SITE_STORAGE_KEY } from '../share/sitePersist';
import { t } from '../i18n/en';
import type { SiteState } from '../model/site/types';
import { appMode, site } from '../state/site';
import { defaultPlan, plan } from '../state/store';
import { initSession, openJsonFile, startAutosave } from './session';
import { downloadUnreadable, recovery, retryUnreadable, startNew } from './recovery';
import { notices } from './notices';
import {
  answerSharedSite,
  initSiteSession,
  openSiteFile,
  pendingSite,
  startSiteAutosave,
} from './siteSession';

vi.spyOn(console, 'warn').mockImplementation(() => {});

/** What writes do: all fail, only backup copies fail, or none. Tests may change it mid-run. */
let writesFail: boolean | 'backups' = false;

function stubBrowser(
  hash: string,
  mode: 'machine' | 'site',
  seed: Record<string, string> = {},
  failWrites: boolean | 'backups' = false,
) {
  writesFail = failWrites;
  const store = new Map<string, string>([[MODE_STORAGE_KEY, mode], ...Object.entries(seed)]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (writesFail === true || (writesFail === 'backups' && k.includes(':backup-'))) {
        throw new Error('QuotaExceededError');
      }
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

describe('an unreadable stored plan or template is never overwritten unasked', () => {
  const BAD_PLAN = '{"v":2}';
  const BAD_SITE = '{"broken":';
  const SITE_BACKUP = `${SITE_STORAGE_KEY}:backup-`;
  const PLAN_BACKUP = `${STORAGE_KEY}:backup-`;
  const backups = (store: Map<string, string>, prefix: string) =>
    [...store.keys()].filter((k) => k.startsWith(prefix));
  const editedSite = (): SiteState => ({ ...emptySite(), name: 'Edited' });
  const sharedPlan = () => ({ ...defaultPlan(), count: 7 });
  let hide: (() => void)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    hide = [];
    vi.stubGlobal('window', {
      addEventListener: (_: string, fn: () => void) => hide.push(fn),
      removeEventListener: () => {},
    });
    appMode.set('machine');
    recovery.set({ plan: null, site: null });
    notices.set([]);
    pendingSite.set(null);
    site.set(emptySite());
    plan.set(defaultPlan());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Runs the autosave for a second, then fires pagehide and stops it. */
  async function settle(stop: () => void): Promise<void> {
    await vi.advanceTimersByTimeAsync(1000);
    for (const fn of hide) fn();
    stop();
  }

  it('holds the stored plan: nothing is written, a backup exists, the notice is set', async () => {
    const store = stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    const stop = startAutosave();
    await settle(stop);
    expect(store.get(STORAGE_KEY)).toBe(BAD_PLAN);
    const held = get(recovery).plan;
    expect(held?.raw).toBe(BAD_PLAN);
    expect(held?.error).toBeTruthy();
    expect(backups(store, PLAN_BACKUP)).toEqual([held?.backupKey]);
  });

  it('Start new saves the current plan and keeps the backup', async () => {
    const store = stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    const stop = startAutosave();
    startNew('plan');
    await settle(stop);
    expect(get(recovery).plan).toBeNull();
    expect(JSON.parse(store.get(STORAGE_KEY)!).v).toBe(1);
    expect(backups(store, PLAN_BACKUP)).toHaveLength(1);
  });

  it('Try again restores the plan once the copy reads', async () => {
    const store = stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    retryUnreadable('plan');
    expect(get(recovery).plan).not.toBeNull();
    expect(get(notices)).toHaveLength(1);
    const key = get(recovery).plan!.backupKey!;
    store.set(key, planToJson(sharedPlan()));
    retryUnreadable('plan');
    expect(get(recovery).plan).toBeNull();
    expect(get(plan).count).toBe(7);
    expect(JSON.parse(store.get(STORAGE_KEY)!).count).toBe(7);
  });

  it('Download copy hands out the stored text', async () => {
    stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    const click = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    vi.stubGlobal('document', {
      createElement: () => ({ click, remove: () => {} }),
      body: { append: () => {} },
    });
    downloadUnreadable('plan');
    expect(click).toHaveBeenCalledOnce();
  });

  it('a #p= link releases the hold when a backup exists', async () => {
    const hash = `#p=${await encodePlan(sharedPlan())}`;
    const store = stubBrowser(hash, 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    expect(get(recovery).plan).toBeNull();
    expect(location.hash).toBe('');
    await settle(startAutosave());
    expect(JSON.parse(store.get(STORAGE_KEY)!).count).toBe(7);
    expect(backups(store, PLAN_BACKUP)).toHaveLength(1);
  });

  it('a #p= link keeps the hold when no backup could be made', async () => {
    const hash = `#p=${await encodePlan(sharedPlan())}`;
    const store = stubBrowser(hash, 'machine', { [STORAGE_KEY]: BAD_PLAN }, 'backups');
    await start();
    expect(get(recovery).plan?.backupKey).toBeUndefined();
    await settle(startAutosave());
    expect(get(plan).count).toBe(7);
    expect(store.get(STORAGE_KEY)).toBe(BAD_PLAN);
    // A reload must still find the shared plan.
    expect(location.hash).toBe(hash);
  });

  it('opening a JSON file releases the hold only with a backup', async () => {
    const file = new File([planToJson(sharedPlan())], 'p.json');
    const store = stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN });
    await start();
    await openJsonFile(file);
    expect(get(recovery).plan).toBeNull();
    await settle(startAutosave());
    expect(JSON.parse(store.get(STORAGE_KEY)!).count).toBe(7);

    recovery.set({ plan: null, site: null });
    const strict = stubBrowser('', 'machine', { [STORAGE_KEY]: BAD_PLAN }, 'backups');
    await start();
    await openJsonFile(file);
    expect(get(recovery).plan).not.toBeNull();
    await settle(startAutosave());
    expect(strict.get(STORAGE_KEY)).toBe(BAD_PLAN);
  });

  it('holds the stored template through edits and pagehide', async () => {
    const store = stubBrowser('', 'site', { [SITE_STORAGE_KEY]: BAD_SITE });
    await start();
    const stop = startSiteAutosave();
    site.set(editedSite());
    await settle(stop);
    expect(store.get(SITE_STORAGE_KEY)).toBe(BAD_SITE);
    const held = get(recovery).site;
    expect(held?.raw).toBe(BAD_SITE);
    expect(backups(store, SITE_BACKUP)).toEqual([held?.backupKey]);
  });

  it('Start new saves the template; Try again restores it', async () => {
    const store = stubBrowser('', 'site', { [SITE_STORAGE_KEY]: BAD_SITE });
    await start();
    site.set(editedSite());
    startNew('site');
    expect(JSON.parse(store.get(SITE_STORAGE_KEY)!).name).toBe('Edited');
    expect(backups(store, SITE_BACKUP)).toHaveLength(1);

    recovery.set({ plan: null, site: null });
    const second = stubBrowser('', 'site', { [SITE_STORAGE_KEY]: BAD_SITE });
    await start();
    second.set(get(recovery).site!.backupKey!, siteToJson({ ...emptySite(), name: 'Back' }));
    retryUnreadable('site');
    expect(get(recovery).site).toBeNull();
    expect(get(site).name).toBe('Back');
    expect(JSON.parse(second.get(SITE_STORAGE_KEY)!).name).toBe('Back');
  });

  it('a #s= link under the hold: saved with a backup, not without', async () => {
    const link = `#s=${await encodeSite({ ...emptySite(), name: 'Shared' })}`;
    const store = stubBrowser(link, 'site', { [SITE_STORAGE_KEY]: BAD_SITE });
    await start();
    expect(get(recovery).site).toBeNull();
    expect(JSON.parse(store.get(SITE_STORAGE_KEY)!).name).toBe('Shared');

    recovery.set({ plan: null, site: null });
    const strict = stubBrowser(link, 'site', { [SITE_STORAGE_KEY]: BAD_SITE }, 'backups');
    await start();
    expect(get(recovery).site).not.toBeNull();
    expect(strict.get(SITE_STORAGE_KEY)).toBe(BAD_SITE);
    expect(location.hash).toBe(link);
  });

  it('opening a template file releases the hold only with a backup', async () => {
    const file = new File([siteToJson({ ...emptySite(), name: 'File' })], 's.json');
    const store = stubBrowser('', 'site', { [SITE_STORAGE_KEY]: BAD_SITE });
    await start();
    const stop = startSiteAutosave();
    await openSiteFile(file);
    expect(get(recovery).site).toBeNull();
    await settle(stop);
    expect(JSON.parse(store.get(SITE_STORAGE_KEY)!).name).toBe('File');
  });

  it('warns again about a failing save after a successful one', async () => {
    stubBrowser('', 'machine', {}, true);
    await start();
    const stop = startAutosave();
    await vi.advanceTimersByTimeAsync(400);
    expect(get(notices).map((n) => n.text)).toContain(t.saveFailed);
    notices.set([]);
    writesFail = false;
    plan.set({ ...defaultPlan(), count: 3 });
    await vi.advanceTimersByTimeAsync(400);
    writesFail = true;
    plan.set({ ...defaultPlan(), count: 4 });
    await vi.advanceTimersByTimeAsync(400);
    expect(get(notices).map((n) => n.text)).toContain(t.saveFailed);
    stop();
  });
});
