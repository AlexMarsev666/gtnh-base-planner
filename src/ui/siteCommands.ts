import { get, type Readable } from 'svelte/store';
import { getSiteDef } from '../data/generic';
import { t } from '../i18n/en';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteState } from '../model/site/types';
import { appMode, site, siteGroup } from '../state/site';
import { connectBelow, plan } from '../state/store';
import { notify } from './notices';
import { withGroupAdded, withGrownToFit, withPlanAdded } from './siteActions';
import { growAfterBuild } from './siteEditing';
import { undoAction } from './siteHistory';
import type { Arranged } from './siteArrange';
import { arrangeInSize, peekSiteBuild, siteBuild, type SiteResult } from './sitePipeline';

/** Where a new group goes: east of every built group, or at the start of the site. */
export function freeOrigin(s: SiteState, build: SiteBuild | null): [number, number] {
  const edge = 1 + Math.max(1, s.corridor);
  const xs = (build?.groups ?? []).filter((g) => g.def).map((g) => g.max[0]);
  return [xs.length ? Math.max(...xs) + Math.max(1, s.corridor) : edge, edge];
}

/** `s` grown to hold its last group, estimated as one unit of its machine (the build refines it). */
function grownForNew(s: SiteState): SiteState {
  const g = s.groups[s.groups.length - 1];
  const def = g && getSiteDef(g.multiblockId);
  if (!def) return s;
  const max: [number, number] = [g.origin[0] + def.size[0], g.origin[1] + def.size[2]];
  return withGrownToFit(s, g.origin, max, Math.max(1, s.corridor));
}

export function addGroup(multiblockId: string): void {
  const s = get(site);
  const next = withGroupAdded(s, multiblockId, freeOrigin(s, peekSiteBuild()));
  if (next === s) return;
  site.set(grownForNew(next));
  siteGroup.set(next.groups[next.groups.length - 1].id);
}

/** The single-machine plan becomes a new group; the view switches to the site. */
export function addPlanToSite(): void {
  const s = get(site);
  const next = withPlanAdded(s, get(plan), freeOrigin(s, peekSiteBuild()));
  if (next === s) return;
  const id = next.groups[next.groups.length - 1].id;
  const grown = grownForNew(next);
  site.set(grown);
  siteGroup.set(id);
  appMode.set('site');
  // Several units take more room than one: grow again once the group is built.
  growAfterBuild(id, get(site));
  notify(t.site.addedToSite);
}

/**
 * Arranges the groups along the flow inside the template's own size: what is too wide for the ground goes on
 * floors above it, and a group bigger than the ground stacks its machines up. The size is never changed. It
 * runs in the build worker, as a big template takes seconds to measure.
 */
export async function arrange(optimize = false): Promise<void> {
  const s = get(site);
  if (!s.groups.length) return;
  notify(optimize ? t.site.optimizing : t.site.arranging, 120000, 'arrange');
  let r;
  try {
    r = await arrangeInSize(s, get(connectBelow), optimize);
  } catch {
    // Replaced by a newer job (an import, say): that one reports for itself.
    return;
  }
  // The template was edited while it was being arranged: the result no longer fits it.
  if (get(site) !== s) return;
  site.set(r.site);
  notify(
    r.fits && r.optimized
      ? optimizedNotice(r.optimized)
      : r.fits
        ? r.floors > 1
          ? t.site.arrangedFloors(r.floors)
          : t.site.arranged
        : t.site.needs(r.needed[0], r.needed[1]),
    r.fits ? 6000 : 8000,
    'arrange',
    undoAction(),
  );
}

/** What optimising did, in the router's numbers (pipe and cable blocks). */
function optimizedNotice(o: NonNullable<Arranged['optimized']>): string {
  return o.improved ? t.site.optimized(o.start.blocks, o.result.blocks, o.reshaped) : t.site.optimizedSame;
}

/** Whether `result` is the build of `s` itself: built and routed (not the groups alone). */
function isBuildOf(result: SiteResult, s: SiteState): boolean {
  return !!result.build && !result.pending && !result.error && result.of === s;
}

/**
 * Resolves true once `imported` is on screen, built and routed; false when the template was edited or
 * replaced meanwhile, its build failed, or `timeoutMs` passed.
 */
export function whenBuilt(
  imported: SiteState,
  sites: Readable<SiteState> = site,
  builds: Readable<SiteResult> = siteBuild,
  timeoutMs = 120000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // The subscriptions may still be starting up: stop them after this turn.
      queueMicrotask(() => stops.forEach((stop) => stop()));
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    stops.push(
      sites.subscribe((s) => {
        if (s !== imported) finish(false);
      }),
      builds.subscribe((r) => {
        if (isBuildOf(r, imported)) finish(true);
        else if (r.error) finish(false);
      }),
    );
  });
}

/**
 * After an import: shows the imported layout first, then optimises it in the background (what the Optimize
 * button does), unless the template was edited while it was being built.
 */
export async function optimizeAfterImport(
  imported: SiteState,
  run: () => Promise<void> = () => arrange(true),
  built: () => Promise<boolean> = () => whenBuilt(imported),
): Promise<void> {
  if (!(await built()) || get(site) !== imported) return;
  await run();
}
