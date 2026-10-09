import { writable } from 'svelte/store';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import type { AppMode } from '../share/sitePersist';

/** Which planner is on screen: one multiblock (the classic view) or a site of several groups. */
export const appMode = writable<AppMode>('machine');

export const site = writable<SiteState>(emptySite());
/** Selected group id (highlighted in the scene, edited in the site panel). */
export const siteGroup = writable<string | null>(null);
export const siteHatch = writable<{ group: string; assignments: string[] } | null>(null);
export const undergroundView = writable(false);
/**
 * Selected port id (an input or output on the site edge): dragged or nudged like a group, never together
 * with one. Selecting either clears the other.
 */
export const sitePort = writable<string | null>(null);
siteGroup.subscribe((id) => id !== null && sitePort.set(null));
sitePort.subscribe((id) => id !== null && siteGroup.set(null));
/** Selected net id (from clicking a pipe): shown in the info line. */
export const siteNet = writable<number | null>(null);
/** Resource key whose nets are highlighted; every other net is drawn faded. */
export const isolate = writable<string | null>(null);
export const sitePipes = writable(true);
export const siteCables = writable(true);
export const flowAnimation = writable(true);

const ICONS_KEY = 'gtnh-planner:icons';

function storedIcons(): boolean {
  try {
    return globalThis.localStorage?.getItem(ICONS_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Show item and fluid icons from gtnhplanner.com (resources imported from GTNH Planner carry their icon
 * path). Off = colour swatches only, and the page loads nothing from another site. Remembered per browser.
 */
export const showIcons = writable(storedIcons());
showIcons.subscribe((on) => {
  try {
    globalThis.localStorage?.setItem(ICONS_KEY, on ? '1' : '0');
  } catch {
    // Not important enough to report.
  }
});
