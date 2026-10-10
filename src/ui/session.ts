import { get, writable } from 'svelte/store';
import { t } from '../i18n/en';
import type { PlanState } from '../model/plan/types';
import { LinkTooLargeError } from '../share/binary';
import { encodePlan } from '../share/codec';
import {
  clearHash,
  planFromJson,
  planToJson,
  readHashPlan,
  readStoredPlan,
  saveStoredPlan,
} from '../share/persist';
import { appMode } from '../state/site';
import { plan, selectedUnits } from '../state/store';
import { LONG_LINK_CHARS, linkCopiedNotice, notify, warnOnce } from './notices';
import { holdUnreadable, isHeld, releaseIfBackedUp } from './recovery';
import { shareApi } from './shareApi';

/** A shared plan from the URL waiting for the user's OPEN / KEEP MINE answer. */
export const pendingShared = writable<PlanState | null>(null);
/** Share link shown in a selectable field when the clipboard is unavailable. */
export const shareFallback = writable<string | null>(null);

export const SAVE_DEBOUNCE_MS = 300;

/** Stable comparison of two plans (key order independent). Prefers the share unit's `plansEqual`. */
export function samePlan(a: PlanState, b: PlanState): boolean {
  if (shareApi.plansEqual) {
    try {
      return shareApi.plansEqual(a, b);
    } catch (err) {
      warnOnce('plansEqual', err);
    }
  }
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}

function safeClearHash(): void {
  try {
    clearHash();
  } catch (err) {
    warnOnce('clearHash', err);
  }
}

function applyPlan(next: PlanState): void {
  selectedUnits.set([]);
  plan.set(next);
}

/** Load the stored plan and the `#p=` link; returns once the initial plan is in the store. */
export async function initSession(): Promise<void> {
  let stored: PlanState | null = null;
  try {
    const result = readStoredPlan();
    stored = result.plan;
    // The unreadable text stays where it is until the user decides (see recovery.ts).
    if (result.error !== undefined) {
      holdUnreadable('plan', { error: result.error, raw: result.raw ?? '', backupKey: result.backupKey });
    }
  } catch (err) {
    warnOnce('readStoredPlan', err);
  }
  if (stored) applyPlan(stored);

  // Any `p=` / legacy `plan=` parameter counts as a link attempt worth reporting and clearing.
  const hasHash = /(^#|&)(p|plan)=/.test(location.hash);
  let shared: PlanState | null = null;
  try {
    shared = await readHashPlan();
  } catch (err) {
    warnOnce('readHashPlan', err);
    // The share unit's PlanFormatError carries a readable message; anything else gets the generic one.
    const readable = err instanceof Error && err.name === 'PlanFormatError' ? err.message : null;
    if (hasHash) notify(readable ?? t.sharedInvalid, 8000);
  }
  if (!shared) {
    if (hasHash) safeClearHash();
    return;
  }
  // A plan link opens the machine view whatever view was open last. `initSiteSession` restores the stored
  // view before its first await, so this (after an await) always comes later.
  appMode.set('machine');
  if (!stored || samePlan(shared, stored)) {
    releaseIfBackedUp('plan');
    applyPlan(shared);
    // Still held: the link is the only copy of this plan outside memory, so a reload must find it.
    if (!isHeld('plan')) safeClearHash();
  } else {
    pendingShared.set(shared);
  }
}

export function answerShared(open: boolean): void {
  const shared = get(pendingShared);
  if (open && shared) {
    releaseIfBackedUp('plan');
    applyPlan(shared);
  }
  pendingShared.set(null);
  safeClearHash();
}

/** Save the plan 300 ms after the last change. Returns an unsubscribe function that flushes. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: PlanState | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!latest) return;
    // An unreadable stored plan is left alone until the user decides.
    if (isHeld('plan')) {
      latest = undefined;
      return;
    }
    try {
      // The share unit returns false when storage is full or blocked.
      if ((saveStoredPlan(latest) as unknown) === false) saveFailed();
      else saveWarned = false;
    } catch (err) {
      warnOnce('saveStoredPlan', err);
    }
    latest = undefined;
  };
  const unsubscribe = plan.subscribe((p) => {
    latest = p;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });
  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  return () => {
    window.removeEventListener('pagehide', onHide);
    unsubscribe();
    flush();
  };
}

let saveWarned = false;
function saveFailed(): void {
  warnOnce('saveStoredPlan', 'not saved');
  if (saveWarned) return;
  saveWarned = true;
  notify(t.saveFailed, 8000);
}

/** Fallback share URL: the current page without its hash, plus `#p=<code>`. */
export function shareUrl(code: string): string {
  return location.href.split('#')[0] + '#p=' + code;
}

// A fallback link shown for an older plan would share the wrong thing.
plan.subscribe(() => shareFallback.set(null));

export async function copyShareLink(): Promise<void> {
  shareFallback.set(null);
  let url: string;
  try {
    const p = get(plan);
    url = shareApi.planHashUrl ? await shareApi.planHashUrl(p) : shareUrl(await encodePlan(p));
  } catch (err) {
    warnOnce('encodePlan', err);
    if (err instanceof LinkTooLargeError) {
      notify(t.planTooLargeForLink, 0, 'link-too-large', { label: t.downloadJson, run: downloadJson });
      return;
    }
    notify(t.linkFailed);
    return;
  }
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(url);
    notify(linkCopiedNotice(url), url.length > LONG_LINK_CHARS ? 8000 : undefined);
  } catch (err) {
    warnOnce('clipboard', err);
    shareFallback.set(url);
  }
}

export function downloadJson(): void {
  try {
    const p = get(plan);
    if (shareApi.downloadPlanJson) {
      shareApi.downloadPlanJson(p, `gtnh-plan-${p.multiblockId}.json`);
      return;
    }
    const blob = new Blob([planToJson(p)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `gtnh-plan-${p.multiblockId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (err) {
    warnOnce('planToJson', err);
    notify(t.jsonSaveFailed);
  }
}

export async function openJsonFile(file: File): Promise<void> {
  try {
    const next = shareApi.readPlanFile ? await shareApi.readPlanFile(file) : planFromJson(await file.text());
    releaseIfBackedUp('plan');
    applyPlan(next);
    notify(t.jsonLoaded);
  } catch (err) {
    warnOnce('planFromJson', err);
    notify(t.jsonFailed(err instanceof Error ? err.message : String(err)), 6000);
  }
}
