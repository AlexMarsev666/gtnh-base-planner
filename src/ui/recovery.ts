import { get, writable } from 'svelte/store';
import { t } from '../i18n/en';
import type { PlanState } from '../model/plan/types';
import type { SiteState } from '../model/site/types';
import { listBackups } from '../share/backups';
import { STORAGE_KEY, planFromJson, saveStoredPlan } from '../share/persist';
import { SITE_STORAGE_KEY, downloadText, saveStoredSite } from '../share/sitePersist';
import { siteFromJson } from '../share/siteCodec';
import { site } from '../state/site';
import { plan, selectedUnits } from '../state/store';
import { notify, warnOnce } from './notices';
import { replaceSite } from './siteActions';

/**
 * A stored plan or template that could not be read stays untouched in the browser: while its entry here
 * exists the matching autosave writes nothing (the "hold"). The hold ends when the user starts anew or
 * restores the data, or when an explicit replacing action runs and a verified backup copy exists.
 */

export type RecoveryKind = 'plan' | 'site';

export interface Unreadable {
  /** Why it could not be read. */
  error: string;
  /** The stored text, for a download. */
  raw: string;
  /** Backup key the text was copied to; absent if no verified copy could be made. */
  backupKey?: string;
}

export const recovery = writable<Record<RecoveryKind, Unreadable | null>>({ plan: null, site: null });

/** True while autosave must leave the stored data of `kind` alone. */
export function isHeld(kind: RecoveryKind): boolean {
  return get(recovery)[kind] !== null;
}

export function holdUnreadable(kind: RecoveryKind, entry: Unreadable): void {
  recovery.update((r) => ({ ...r, [kind]: entry }));
}

/** Ends the hold and removes the notice. */
export function releaseHold(kind: RecoveryKind): void {
  if (isHeld(kind)) recovery.update((r) => ({ ...r, [kind]: null }));
}

/** For explicit replacing actions: ends the hold only when the original is safely kept in a backup. */
export function releaseIfBackedUp(kind: RecoveryKind): void {
  if (get(recovery)[kind]?.backupKey) releaseHold(kind);
}

const FILE_NAMES: Record<RecoveryKind, string> = {
  plan: 'gtnh-plan-unreadable.json',
  site: 'gtnh-site-unreadable.json',
};

export function downloadUnreadable(kind: RecoveryKind): void {
  const entry = get(recovery)[kind];
  if (!entry) return;
  try {
    downloadText(entry.raw, FILE_NAMES[kind]);
  } catch (err) {
    warnOnce('downloadUnreadable', err);
    notify(t.jsonSaveFailed);
  }
}

/** The stored text again from the newest backup (if it still reads back), else the text seen at load. */
function candidates(kind: RecoveryKind, entry: Unreadable): string[] {
  const texts: string[] = [];
  try {
    const key =
      entry.backupKey ?? listBackups(localStorage, kind === 'plan' ? STORAGE_KEY : SITE_STORAGE_KEY)[0]?.key;
    const saved = key ? localStorage.getItem(key) : null;
    if (saved !== null) texts.push(saved);
  } catch {
    // Fall back to the text seen at load.
  }
  if (!texts.includes(entry.raw)) texts.push(entry.raw);
  return texts;
}

/** Tries to read the unreadable data again; on success it replaces the current value and is saved. */
export function retryUnreadable(kind: RecoveryKind): void {
  const entry = get(recovery)[kind];
  if (!entry) return;
  let lastError = entry.error;
  for (const text of candidates(kind, entry)) {
    let next: PlanState | SiteState;
    try {
      next = kind === 'plan' ? planFromJson(text) : siteFromJson(text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    releaseHold(kind);
    if (kind === 'plan') {
      selectedUnits.set([]);
      plan.set(next as PlanState);
    } else replaceSite(next as SiteState);
    saveNow(kind);
    return;
  }
  warnOnce('retryUnreadable', lastError);
  notify(t.jsonFailed(lastError), 6000);
}

/** Gives up on the unreadable data (a backup stays if one was made) and saves the current value. */
export function startNew(kind: RecoveryKind): void {
  releaseHold(kind);
  saveNow(kind);
}

function saveNow(kind: RecoveryKind): void {
  const ok = kind === 'plan' ? saveStoredPlan(get(plan)) : saveStoredSite(get(site));
  if (!ok) notify(t.saveFailed, 8000);
}
