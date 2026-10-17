import { get, type Readable, type Writable } from 'svelte/store';
import { getSiteDef } from '../data/generic';
import { t } from '../i18n/en';
import type { SiteBuild } from '../model/site/buildTypes';
import type { RoutingDepth, SiteRouting, SiteState } from '../model/site/types';
import { effectiveRouting } from '../share/siteCodec';
import { appMode, arrangeOutcome, site, siteGroup } from '../state/site';
import { connectBelow, plan } from '../state/store';
import { clearSlot, notify, warnOnce, type NoticeAction } from './notices';
import { withGroupAdded, withGrownToFit, withPlanAdded } from './siteActions';
import { growAfterBuild } from './siteEditing';
import { undoAction } from './siteHistory';
import type { Arranged } from './siteArrange';
import { arrangeInSize, peekSiteBuild, siteBuild, type SiteResult } from './sitePipeline';
import { JobCancelled } from './siteWorkerController';

/** East edge of each group, estimated from its machine's size when the template was never built. */
function estimatedEast(s: SiteState): number[] {
  return s.groups.flatMap((g) => {
    const def = getSiteDef(g.multiblockId);
    if (!def) return [];
    const across = g.rotation % 2 === 0 ? def.size[0] : def.size[2];
    return [g.origin[0] + across * Math.max(1, Math.min(g.count, g.limits.x ?? g.count))];
  });
}

/**
 * Where a new group goes: east of every built group (of every group's estimated extent while the template was
 * never built), or at the start of the site.
 */
export function freeOrigin(s: SiteState, build: SiteBuild | null): [number, number] {
  const edge = 1 + Math.max(1, s.corridor);
  const xs = build ? build.groups.filter((g) => g.def).map((g) => g.max[0]) : estimatedEast(s);
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
 * Why Arrange, Optimize and Neat cannot run on `s`, or null when they can. They share one condition (`runArrange`
 * returns at once without groups): there is something to arrange.
 */
export function arrangeBlockReason(s: SiteState): string | null {
  return s.groups.length ? null : t.site.arrangeNoGroups;
}

/**
 * Arranges the groups along the flow inside the template's own size: what is too wide for the ground goes on
 * floors above it, and a group bigger than the ground stacks its machines up. The size is never changed. It
 * runs in the build worker, as a big template takes seconds to measure.
 */
export function arrange(optimize = false, deps: ArrangeDeps = {}): Promise<void> {
  return runArrange(optimize ? 'optimize' : 'arrange', deps);
}

/**
 * Neat routing in one step: arranges the template and switches it to the neat router, underground at least one
 * layer deep (a deeper setting stays). The new layout and the new routing are one change of the template, so
 * one undo takes both back.
 */
export function neatArrange(deps: ArrangeDeps = {}): Promise<void> {
  return runArrange('neat', deps);
}

async function runArrange(
  kind: 'arrange' | 'optimize' | 'neat',
  {
    arrangeInSize: run = arrangeInSize,
    sites = site,
    below = connectBelow,
    notify: say = notify,
    clearSlot: clear = clearSlot,
    undo = undoAction,
  }: ArrangeDeps = {},
): Promise<void> {
  const s = get(sites);
  if (!s.groups.length) return;
  const optimize = kind === 'optimize';
  // The arrangement is built with the options the site itself is built with.
  const current = effectiveRouting(s, get(below));
  const startedAgainst = JSON.stringify(current);
  const routing: SiteRouting =
    kind === 'neat' ? { style: 'neat', depth: (current.depth || 1) as RoutingDepth } : current;
  arrangeOutcome.set(null);
  // The progress bar (see Notices) shows that it runs; an older outcome notice goes.
  clear('arrange');
  const cancelled = () => say(t.site.arrangeCancelled(optimize), 4000, 'arrange');
  let r;
  try {
    r = await run(s, routing, optimize, current);
  } catch (err) {
    // Replaced by a newer arrange: that one owns the notice now. An import has notices of its own.
    if (err instanceof JobCancelled && err.reason === 'arrange') return;
    if (err instanceof JobCancelled && err.reason === 'import') {
      clear('arrange');
      return;
    }
    if (err instanceof JobCancelled && err.reason === 'aborted') say(t.site.arrangeStopped, 4000, 'arrange');
    else if (err instanceof JobCancelled) cancelled();
    else {
      warnOnce('arrange', err);
      say(t.site.arrangeFailed(err instanceof Error ? err.message : String(err)), 6000, 'arrange');
    }
    return;
  }
  // The template was edited while it was being arranged: the result no longer fits it.
  if (get(sites) !== s || JSON.stringify(effectiveRouting(get(sites), get(below))) !== startedAgainst) {
    cancelled();
    return;
  }
  // An optimise that found nothing better changes nothing (and leaves no undo step).
  const unchanged = r.fits && r.optimized?.improved === false;
  if (!unchanged) sites.set(kind === 'neat' ? { ...r.site, routing } : r.site);
  arrangeOutcome.set({
    kind,
    fits: r.fits,
    floors: r.floors,
    ...(r.optimized ? { improved: r.optimized.improved, truncated: r.optimized.truncated } : {}),
  });
  say(
    r.fits && r.optimized
      ? optimizedNotice(r.optimized)
      : r.fits
        ? r.floors > 1
          ? t.site.arrangedFloors(r.floors)
          : t.site.arranged
        : t.site.needs(r.needed[0], r.needed[1]),
    r.fits ? 6000 : 8000,
    'arrange',
    unchanged ? undefined : undo(),
  );
}

/** What `arrange` uses, replaceable in tests. */
interface ArrangeDeps {
  arrangeInSize?: (
    site: SiteState,
    routing: SiteRouting,
    optimize: boolean,
    against: SiteRouting,
  ) => Promise<Arranged>;
  sites?: Writable<SiteState>;
  below?: Readable<boolean>;
  notify?: (text: string, ms?: number, slot?: string, action?: NoticeAction) => void;
  clearSlot?: (slot: string) => void;
  undo?: () => NoticeAction;
}

/** What optimising did, in the router's numbers (pipe and cable blocks). */
function optimizedNotice(o: NonNullable<Arranged['optimized']>): string {
  const text = o.improved
    ? t.site.optimized(o.start.blocks, o.result.blocks, o.reshaped)
    : t.site.optimizedSame;
  return o.truncated ? `${text} ${t.site.optimizeTruncated}` : text;
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
