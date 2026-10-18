import { get, writable } from 'svelte/store';
import type { Vec3 } from '../model/core/types';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import type { AppMode } from '../share/sitePersist';

/** Which planner is on screen: one multiblock (the classic view) or a site of several groups. */
export const appMode = writable<AppMode>('machine');

export const site = writable<SiteState>(emptySite());
/** Selected group id (highlighted in the scene, edited in the site panel). */
export const siteGroup = writable<string | null>(null);
/**
 * Selected port id (an input or output on the site edge): dragged or nudged like a group, never together
 * with one. Selecting either clears the other.
 */
export const sitePort = writable<string | null>(null);
siteGroup.subscribe((id) => id !== null && sitePort.set(null));
sitePort.subscribe((id) => id !== null && siteGroup.set(null));
/**
 * Selected link id (from the outline): its resource is isolated and the inspector shows the link. Never
 * together with a group or a port.
 */
export const siteLink = writable<string | null>(null);
/** The inspector shows the form for a new link; it ends when anything gets selected. */
export const siteLinkDraft = writable(false);
siteGroup.subscribe((id) => id !== null && siteLink.set(null));
sitePort.subscribe((id) => id !== null && siteLink.set(null));
siteLink.subscribe((id) => {
  if (id === null) return;
  siteGroup.set(null);
  sitePort.set(null);
});
for (const selection of [siteGroup, sitePort, siteLink])
  selection.subscribe((id) => id !== null && siteLinkDraft.set(false));
siteLinkDraft.subscribe((on) => {
  if (!on) return;
  siteGroup.set(null);
  sitePort.set(null);
  siteLink.set(null);
});
/**
 * The hatch picked in the 3D view: its `SiteGroup.hatchTiers` key (see `groupHatchKeys`) in the selected group.
 * Shown in the group editor and highlighted; it never outlives the selection of its group.
 */
export const siteHatch = writable<{ group: string; key: string; cell: Vec3 } | null>(null);
siteGroup.subscribe((id) => siteHatch.update((h) => (h && h.group !== id ? null : h)));
export type GroupTab = 'machine' | 'packing' | 'placement';
/** The tab of the group inspector; kept across selections. */
export const groupTab = writable<GroupTab>('machine');
// A hatch picked in the scene is shown on the Machine tab.
siteHatch.subscribe((h) => h && groupTab.set('machine'));
export type TemplateTab = 'layout' | 'routing';
/** The tab of the template settings, shown while nothing is selected. */
export const templateTab = writable<TemplateTab>('layout');
/** Selected net id (from clicking a pipe): shown in the info line. */
export const siteNet = writable<number | null>(null);
/** Resource key whose nets are highlighted; every other net is drawn faded. */
export const isolate = writable<string | null>(null);
// Selecting a link isolates its resource; deselecting it ends that, unless something else is isolated by now.
let linkIsolated: string | null = null;
siteLink.subscribe((id) => {
  const res = id === null ? null : (get(site).links.find((l) => l.id === id)?.resource ?? null);
  if (res !== null) isolate.set(res);
  else if (linkIsolated !== null && get(isolate) === linkIsolated) isolate.set(null);
  linkIsolated = res;
});
// Nothing stays selected in the link list or its form when the Template view is left.
appMode.subscribe((mode) => {
  if (mode === 'site') return;
  siteLink.set(null);
  siteLinkDraft.set(false);
});
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

/**
 * How far the running ARRANGE / OPTIMIZE has got; `total` 0 while nothing is known yet, null when none runs.
 * Set by the build worker's controller (see `sitePipeline`).
 */
export const arrangeProgress = writable<{
  done: number;
  total: number;
  phase: 'arrange' | 'optimize';
} | null>(null);

/** What the last ARRANGE / OPTIMIZE / NEAT that was applied did; null before the first one, or after an edit. */
export interface ArrangeOutcome {
  kind: 'arrange' | 'optimize' | 'neat';
  fits: boolean;
  floors: number;
  /** Optimise only: an annealed layout replaced the arranged one. */
  improved?: boolean;
  /** Optimise only: the safety limit ended the search early. */
  truncated?: boolean;
}
export const arrangeOutcome = writable<ArrangeOutcome | null>(null);
