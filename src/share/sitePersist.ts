import type { SiteState } from '../model/site/types';
import { MAX_SITE_JSON_BYTES, PlanFormatError } from './binary';
import type { LocationLike, StorageLike, WindowLike } from './persist';
import { decodeSite, encodeSite, siteFromJson, siteToJson, validateSiteState } from './siteCodec';

/** Site persistence, the same rules as plans (`persist.ts`) under its own storage key and `#s=` parameter. */

export const SITE_STORAGE_KEY = 'gtnh-planner:site:v1';
export const SITE_BACKUP_PREFIX = `${SITE_STORAGE_KEY}:backup-`;
export const MODE_STORAGE_KEY = 'gtnh-planner:mode';
export const SITE_HASH_PARAM = 's';

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function browserWindow(): WindowLike | null {
  const g = globalThis as { location?: LocationLike; history?: WindowLike['history'] };
  return g.location && g.history ? { location: g.location, history: g.history } : null;
}

/** The stored site, or null. An unreadable copy is kept under a backup key, never overwritten. */
export function loadStoredSite(
  storage: StorageLike | null = browserStorage(),
  now: () => number = Date.now,
): SiteState | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SITE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return siteFromJson(raw);
  } catch {
    try {
      let kept = false;
      for (let i = 0; i < storage.length && !kept; i++) {
        const k = storage.key(i);
        kept = !!k?.startsWith(SITE_BACKUP_PREFIX) && storage.getItem(k) === raw;
      }
      if (!kept) storage.setItem(`${SITE_BACKUP_PREFIX}${now()}`, raw);
    } catch {
      // Storage full or blocked: nothing more to do.
    }
    return null;
  }
}

export function saveStoredSite(site: SiteState, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const text = JSON.stringify(validateSiteState(site));
    // Never write what `siteFromJson` would refuse to read back.
    if (text.length > MAX_SITE_JSON_BYTES) return false;
    storage.setItem(SITE_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export type AppMode = 'machine' | 'site';

export function loadMode(storage: StorageLike | null = browserStorage()): AppMode {
  try {
    return storage?.getItem(MODE_STORAGE_KEY) === 'site' ? 'site' : 'machine';
  } catch {
    return 'machine';
  }
}

export function saveMode(mode: AppMode, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Not important enough to report.
  }
}

function hashParts(hash: string): string[] {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  return body === '' ? [] : body.split('&');
}

export function hashSiteParam(hash: string): string | null {
  for (const part of hashParts(hash)) if (part.startsWith(`${SITE_HASH_PARAM}=`)) return part.slice(2);
  return null;
}

export async function readHashSite(
  loc: Pick<LocationLike, 'hash'> | null = browserWindow()?.location ?? null,
): Promise<SiteState | null> {
  const value = loc ? hashSiteParam(loc.hash) : null;
  return value === null ? null : decodeSite(value);
}

export function clearSiteHash(win: WindowLike | null = browserWindow()): void {
  if (!win || win.location.hash === '') return;
  const rest = hashParts(win.location.hash).filter((p) => !p.startsWith(`${SITE_HASH_PARAM}=`));
  const url = win.location.pathname + win.location.search + (rest.length ? `#${rest.join('&')}` : '');
  win.history.replaceState(win.history.state, '', url);
}

export async function siteHashUrl(
  site: SiteState,
  href: string = browserWindow()?.location.href ?? '',
): Promise<string> {
  return `${href.split('#')[0] ?? ''}#${SITE_HASH_PARAM}=${await encodeSite(site)}`;
}

export async function readSiteFile(file: Blob): Promise<SiteState> {
  if (file.size > MAX_SITE_JSON_BYTES) throw new PlanFormatError('Site file is too large.');
  return siteFromJson(await file.text());
}

export function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSiteJson(site: SiteState, fileName = 'gtnh-site.json'): void {
  downloadText(siteToJson(site), fileName);
}
