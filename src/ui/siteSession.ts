import { get, writable } from 'svelte/store';
import { t } from '../i18n/en';
import type { SiteState } from '../model/site/types';
import { LinkTooLargeError } from '../share/binary';
import { sitesEqual } from '../share/siteCodec';
import {
  clearSiteHash,
  downloadSiteJson,
  hashSiteParam,
  loadMode,
  loadStoredSite,
  readHashSite,
  readSiteFile,
  saveMode,
  saveStoredSite,
  siteHashUrl,
} from '../share/sitePersist';
import { appMode, site } from '../state/site';
import { LONG_LINK_CHARS, linkCopiedNotice, notify, warnOnce } from './notices';
import { replaceSite } from './siteActions';

/** A shared site from the URL waiting for the user's OPEN / KEEP MINE answer. */
export const pendingSite = writable<SiteState | null>(null);
/** Site link shown in a selectable field when the clipboard is unavailable. */
export const siteShareFallback = writable<string | null>(null);

const SAVE_DEBOUNCE_MS = 300;

/** Writes the site right away; tells the user once if the browser refuses. */
function saveSiteNow(s: SiteState): void {
  if (!saveStoredSite(s)) notify(t.saveFailed, 8000);
}

/** Loads the stored site and mode, then a `#s=` link (which switches to the site view). */
export async function initSiteSession(): Promise<void> {
  appMode.set(loadMode());
  let stored: SiteState | null = null;
  try {
    stored = loadStoredSite();
  } catch (err) {
    warnOnce('loadStoredSite', err);
  }
  if (stored) site.set(stored);
  if (hashSiteParam(location.hash) === null) return;
  let shared: SiteState | null = null;
  try {
    shared = await readHashSite();
  } catch (err) {
    warnOnce('readHashSite', err);
    notify(err instanceof Error && err.name === 'PlanFormatError' ? err.message : t.sharedInvalid, 8000);
  }
  if (!shared) {
    clearSiteHash();
    return;
  }
  appMode.set('site');
  const empty = !stored || stored.groups.length === 0;
  if (empty || sitesEqual(shared, stored!)) {
    replaceSite(shared);
    // Autosave has not started yet and skips this value, so the shared site is written here.
    saveSiteNow(shared);
    clearSiteHash();
  } else pendingSite.set(shared);
}

export function answerSharedSite(open: boolean): void {
  const shared = get(pendingSite);
  if (open && shared) replaceSite(shared);
  pendingSite.set(null);
  clearSiteHash();
}

/** Saves the site 300 ms after the last change, and the mode right away. Returns a flushing unsubscribe. */
export function startSiteAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: SiteState | undefined;
  let warned = false;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!latest) return;
    if (!saveStoredSite(latest) && !warned) {
      warned = true;
      notify(t.saveFailed, 8000);
    }
    latest = undefined;
  };
  let first = true;
  const unSite = site.subscribe((s) => {
    // The value at subscription time is what was just loaded.
    if (first) {
      first = false;
      return;
    }
    latest = s;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });
  const unMode = appMode.subscribe((m) => saveMode(m));
  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  return () => {
    window.removeEventListener('pagehide', onHide);
    unSite();
    unMode();
    flush();
  };
}

site.subscribe(() => siteShareFallback.set(null));

export async function copySiteLink(): Promise<void> {
  siteShareFallback.set(null);
  let url: string;
  try {
    url = await siteHashUrl(get(site));
  } catch (err) {
    warnOnce('encodeSite', err);
    if (err instanceof LinkTooLargeError) {
      notify(t.site.tooLargeForLink, 0, 'link-too-large', { label: t.downloadJson, run: downloadSite });
      return;
    }
    notify(err instanceof Error && err.name === 'PlanFormatError' ? err.message : t.linkFailed, 6000);
    return;
  }
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(url);
    notify(linkCopiedNotice(url), url.length > LONG_LINK_CHARS ? 8000 : undefined);
  } catch (err) {
    warnOnce('clipboard', err);
    siteShareFallback.set(url);
  }
}

export function downloadSite(): void {
  try {
    const s = get(site);
    const name =
      (s.name ?? 'site')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'site';
    downloadSiteJson(s, `gtnh-site-${name}.json`);
  } catch (err) {
    warnOnce('siteToJson', err);
    notify(t.jsonSaveFailed);
  }
}

export async function openSiteFile(file: File): Promise<void> {
  try {
    replaceSite(await readSiteFile(file));
    notify(t.site.opened);
  } catch (err) {
    warnOnce('siteFromJson', err);
    notify(t.jsonFailed(err instanceof Error ? err.message : String(err)), 6000);
  }
}
