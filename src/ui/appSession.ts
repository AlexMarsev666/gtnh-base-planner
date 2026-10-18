import { get } from 'svelte/store';
import { warnOnce } from './warn';
import { pendingShared } from './session';
import { pendingSite } from './siteSession';
import { defaultPlan, plan } from '../state/store';
import { site } from '../state/site';
import { initSession, openHashPlan, samePlan, startAutosave } from './session';
import { startSiteHistory } from './siteHistory';
import { initSiteSession, openHashSite, startSiteAutosave } from './siteSession';

/**
 * Opens the `#p=` or `#s=` link a changed hash holds (a link followed while the app is open). Only changes
 * made by the user or another page fire `hashchange`: the app clears the hash with `replaceState`, which does not.
 */
export async function openHashLinks(): Promise<void> {
  // A newer link makes the prompt for an older one (of either kind) void.
  if (/(^#|&)(p|plan|s)=/.test(location.hash)) {
    pendingShared.set(null);
    pendingSite.set(null);
  }
  const current = get(plan);
  // A plan nobody edited is as good as none: the link replaces it without asking.
  await Promise.all([
    openHashPlan(samePlan(current, defaultPlan()) ? null : current),
    openHashSite(get(site)),
  ]);
}

/**
 * Loads the stored plan and template (and a shared link), then saves both as they change and records the
 * template's undo history. Returns a function that stops all of it, flushing pending saves; stopping
 * before loading finished just skips starting.
 */
export function startSessions(): () => void {
  let stop: (() => void) | undefined;
  let stopSite: (() => void) | undefined;
  let stopHistory: (() => void) | undefined;
  let cancelled = false;
  // Both sessions read the hash at startup, so until they are done a change is only remembered, and opened
  // once afterwards (the startup hash itself is not opened twice).
  let loaded = 0;
  let changedEarly = false;
  const onHashChange = () => {
    if (loaded < 2) changedEarly = true;
    else void openHashLinks();
  };
  window.addEventListener('hashchange', onHashChange);
  const listen = () => {
    if (++loaded === 2 && changedEarly && !cancelled) void openHashLinks();
  };
  void initSession()
    .then(() => {
      if (!cancelled) stop = startAutosave();
    })
    .catch((err: unknown) => warnOnce('initSession', err))
    .finally(listen);
  void initSiteSession()
    .then(() => {
      if (cancelled) return;
      stopSite = startSiteAutosave();
      // Loading the stored template is not an undo step.
      stopHistory = startSiteHistory();
    })
    .catch((err: unknown) => warnOnce('initSiteSession', err))
    .finally(listen);
  return () => {
    cancelled = true;
    window.removeEventListener('hashchange', onHashChange);
    stop?.();
    stopSite?.();
    stopHistory?.();
  };
}
