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
  readHashSite,
  readSiteFile,
  readStoredSite,
  saveMode,
  saveStoredSite,
  siteHashUrl,
} from '../share/sitePersist';
import { appMode, site } from '../state/site';
import { LONG_LINK_CHARS, linkCopiedNotice, notify, warnOnce } from './notices';
import { holdUnreadable, isHeld, releaseIfBackedUp } from './recovery';
import { replaceSite } from './siteActions';

/** A shared site from the URL waiting for the user's OPEN / KEEP MINE answer. */
export const pendingSite = writable<SiteState | null>(null);
/** How many groups of `pendingSite` became placeholders (told when the user opens it). */
let pendingReplaced = 0;
/** Site link shown in a selectable field when the clipboard is unavailable. */
export const siteShareFallback = writable<string | null>(null);

const SAVE_DEBOUNCE_MS = 300;

let saveWarned = false;

/** Writes the site right away unless an unreadable stored one is held; tells the user once per failure streak. */
function tellReplaced(n: number, kept = false): void {
  if (n > 0) notify(t.recovery.replaced(n, kept), 8000);
}

function saveSiteNow(s: SiteState): void {
  if (isHeld('site')) return;
  if (saveStoredSite(s)) saveWarned = false;
  else if (!saveWarned) {
    saveWarned = true;
    notify(t.saveFailed, 8000);
  }
}

/** Loads the stored site and mode, then a `#s=` link (which switches to the site view). */
export async function initSiteSession(): Promise<void> {
  appMode.set(loadMode());
  let stored: SiteState | null = null;
  try {
    const result = readStoredSite();
    stored = result.site;
    const kept = result.backupKey !== undefined;
    tellReplaced(result.replaced?.length ?? 0, kept);
    // With the original safe in a backup the repaired template is stored now, so the notice appears once.
    if (kept && stored && result.replaced?.length) saveSiteNow(stored);
    // The unreadable text stays where it is until the user decides (see recovery.ts).
    if (result.error !== undefined) {
      holdUnreadable('site', { error: result.error, raw: result.raw ?? '', backupKey: result.backupKey });
    }
  } catch (err) {
    warnOnce('readStoredSite', err);
  }
  if (stored) site.set(stored);
  if (hashSiteParam(location.hash) === null) return;
  let shared: SiteState | null = null;
  let sharedReplaced = 0;
  try {
    const loaded = await readHashSite();
    shared = loaded?.site ?? null;
    sharedReplaced = loaded?.replaced.length ?? 0;
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
    releaseIfBackedUp('site');
    replaceSite(shared);
    // Autosave has not started yet and skips this value, so the shared site is written here.
    saveSiteNow(shared);
    // Still held: the link is the only copy of this template outside memory, so a reload must find it.
    if (!isHeld('site')) clearSiteHash();
    tellReplaced(sharedReplaced);
  } else {
    pendingReplaced = sharedReplaced;
    pendingSite.set(shared);
  }
}

export function answerSharedSite(open: boolean): void {
  const shared = get(pendingSite);
  if (open && shared) {
    releaseIfBackedUp('site');
    replaceSite(shared);
    tellReplaced(pendingReplaced);
  }
  pendingReplaced = 0;
  pendingSite.set(null);
  clearSiteHash();
}

/** Saves the site 300 ms after the last change, and the mode right away. Returns a flushing unsubscribe. */
export function startSiteAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: SiteState | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!latest) return;
    saveSiteNow(latest);
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
    const { site: next, replaced } = await readSiteFile(file);
    releaseIfBackedUp('site');
    replaceSite(next);
    notify(t.site.opened);
    tellReplaced(replaced.length);
  } catch (err) {
    warnOnce('siteFromJson', err);
    notify(t.jsonFailed(err instanceof Error ? err.message : String(err)), 6000);
  }
}
