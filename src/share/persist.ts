import type { PlanState } from '../model/plan/types';
import { MAX_PLAN_JSON_BYTES } from './binary';
import { PlanFormatError, encodePlan, decodePlan, validatePlanState } from './codec';

/**
 * UNIT 5 — Persistence.
 *
 * - `loadStoredPlan` reads localStorage (key `gtnh-planner:v1`), validates, returns null if missing/invalid,
 *   and never deletes or overwrites a stored plan it failed to read (keep it under a backup key).
 * - `saveStoredPlan` writes the plan (callers debounce).
 * - `readHashPlan` decodes `#p=...` from `location.hash`, returns null if absent.
 * - `clearHash` removes the plan from the address bar with `history.replaceState`.
 * - `planToJson` / `planFromJson` for file download/upload (validated).
 *
 * Every function takes its browser dependency as an optional last argument so it can be tested
 * without a DOM.
 */

export const STORAGE_KEY = 'gtnh-planner:v1';
export const BACKUP_PREFIX = `${STORAGE_KEY}:backup-`;
export const HASH_PARAM = 'p';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>;
export type LocationLike = Pick<Location, 'hash' | 'pathname' | 'search' | 'href'>;
export interface WindowLike {
  location: LocationLike;
  history: Pick<History, 'replaceState' | 'state'>;
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access can throw (blocked site data, sandboxed iframes).
    return null;
  }
}

function browserWindow(): WindowLike | null {
  const g = globalThis as { location?: LocationLike; history?: WindowLike['history'] };
  return g.location && g.history ? { location: g.location, history: g.history } : null;
}

// ---------------------------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------------------------

export interface StoredPlanResult {
  plan: PlanState | null;
  /** Set when a stored plan existed but could not be read. */
  error?: string;
  /** Key the unreadable plan was copied to (absent if the copy failed). */
  backupKey?: string;
}

/**
 * Like `loadStoredPlan`, but also tells the caller why a stored plan was rejected, so the UI can
 * say "your saved plan could not be read; a copy was kept".
 */
export function readStoredPlan(
  storage: StorageLike | null = browserStorage(),
  now: () => number = Date.now,
): StoredPlanResult {
  if (!storage) return { plan: null };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { plan: null };
  }
  if (raw === null) return { plan: null };
  try {
    return { plan: planFromJson(raw) };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unreadable plan.';
    return { plan: null, error, backupKey: backupRaw(storage, raw, now) };
  }
}

/** Copies an unreadable stored plan to a backup key (once per distinct value). */
function backupRaw(storage: StorageLike, raw: string, now: () => number): string | undefined {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(BACKUP_PREFIX) && storage.getItem(key) === raw) return key;
    }
    const key = `${BACKUP_PREFIX}${now()}`;
    storage.setItem(key, raw);
    return key;
  } catch {
    return undefined;
  }
}

export function loadStoredPlan(
  storage: StorageLike | null = browserStorage(),
  now: () => number = Date.now,
): PlanState | null {
  return readStoredPlan(storage, now).plan;
}

/**
 * Writes the plan. Invalid plans are never written (so the stored copy always stays loadable).
 * Returns false when the plan is invalid or storage is unavailable / full.
 */
export function saveStoredPlan(state: PlanState, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const text = JSON.stringify(validatePlanState(state));
    // Never write what `planFromJson` would refuse to read back.
    if (text.length > MAX_PLAN_JSON_BYTES) return false;
    storage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// URL hash
// ---------------------------------------------------------------------------------------------

function hashParts(hash: string): string[] {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  return body === '' ? [] : body.split('&');
}

/** Returns the raw `p=` value from a hash, or null. */
export function hashPlanParam(hash: string): string | null {
  for (const part of hashParts(hash)) {
    if (part.startsWith(`${HASH_PARAM}=`)) return part.slice(HASH_PARAM.length + 1);
  }
  return null;
}

/**
 * Decodes `#p=...` from the address bar. Returns null when there is no plan in the hash;
 * rejects with a `PlanFormatError` (readable message) when the link is damaged or unsupported.
 * Does not touch storage: the caller decides whether to replace the local plan (compare with
 * `plansEqual`, confirm, then `clearHash()`).
 */
export async function readHashPlan(
  loc: Pick<LocationLike, 'hash'> | null = browserWindow()?.location ?? null,
): Promise<PlanState | null> {
  if (!loc) return null;
  const value = hashPlanParam(loc.hash);
  if (value === null) {
    if (hashParts(loc.hash).some((p) => p.startsWith('plan='))) {
      throw new PlanFormatError(
        'This link was made by an older version of the planner and cannot be opened.',
      );
    }
    return null;
  }
  return decodePlan(value);
}

/** Removes the plan (and legacy `plan=`) from the hash without adding a history entry. */
export function clearHash(win: WindowLike | null = browserWindow()): void {
  if (!win) return;
  const { location, history } = win;
  if (location.hash === '') return;
  const rest = hashParts(location.hash).filter(
    (p) => !p.startsWith(`${HASH_PARAM}=`) && !p.startsWith('plan='),
  );
  const url = location.pathname + location.search + (rest.length ? `#${rest.join('&')}` : '');
  history.replaceState(history.state, '', url);
}

/** Full share URL for a plan: the current page (without hash) plus `#p=<encoded>`. */
export async function planHashUrl(
  state: PlanState,
  href: string = browserWindow()?.location.href ?? '',
): Promise<string> {
  const base = href.split('#')[0] ?? '';
  return `${base}#${HASH_PARAM}=${await encodePlan(state)}`;
}

// ---------------------------------------------------------------------------------------------
// JSON files
// ---------------------------------------------------------------------------------------------

export const JSON_FILE_NAME = 'gtnh-plan.json';

export function planToJson(state: PlanState): string {
  return `${JSON.stringify(validatePlanState(state), null, 2)}\n`;
}

export function planFromJson(text: string): PlanState {
  if (typeof text !== 'string') throw new PlanFormatError('Plan file is not text.');
  if (text.length > MAX_PLAN_JSON_BYTES) throw new PlanFormatError('Plan file is too large.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFormatError('Plan file is not valid JSON.');
  }
  return validatePlanState(data);
}

/** Reads an uploaded plan file (size-checked before reading). */
export async function readPlanFile(file: Blob): Promise<PlanState> {
  if (file.size > MAX_PLAN_JSON_BYTES) throw new PlanFormatError('Plan file is too large.');
  return planFromJson(await file.text());
}

/** Starts a browser download of the plan as pretty JSON. */
export function downloadPlanJson(state: PlanState, fileName: string = JSON_FILE_NAME): void {
  const blob = new Blob([planToJson(state)], { type: 'application/json' });
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
