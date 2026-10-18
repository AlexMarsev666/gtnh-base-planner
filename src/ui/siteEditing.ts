import { get, writable, type Readable } from 'svelte/store';
import { getSiteDef } from '../data/generic';
import { t } from '../i18n/en';
import type { SiteBuild } from '../model/site/buildTypes';
import type { SiteGroup, SiteState } from '../model/site/types';
import type { Vec3 } from '../model/core/types';
import { SITE_MAX_ELEVATION } from '../share/siteCodec';
import { site, siteGroup, sitePort } from '../state/site';
import { type ArrowKey, screenStep } from './keys';
import { notify } from './notices';
import { freeOrigin } from './siteCommands';
import {
  type GroupPatch,
  updateSite,
  withGroupDuplicated,
  withGroupMoved,
  withGroupPatched,
  withGroupRemoved,
  withGroupRotated,
  withGrownToFit,
  withPortPlaced,
} from './siteActions';
import { coalesceNext, mergeIntoLast, undoAction } from './siteHistory';
import { holdRouting, peekSiteBuild, siteBuild, type SiteResult } from './sitePipeline';

/* Editing the selected template group: shared by the keyboard, the nudge pad and dragging in the view. */

/** Camera azimuth (`OrbitControls.theta`): arrows move the selected group as seen on screen. */
export const viewTheta = writable(Math.PI / 4);
/** Shift is held: moves step 5 blocks. */
export const shiftHeld = writable(false);
export const FAST_STEP = 5;

/** A request to aim the camera at a box (inclusive min, exclusive max); `seq` makes repeats distinct. */
export const frameRequest = writable<{ min: Vec3; max: Vec3; seq: number } | null>(null);
let frameSeq = 0;

/**
 * A group's ground footprint [x, z] in blocks, from the last build, for its current turn (the build may
 * still show an older one). Null before the group has been built.
 */
function footprintOf(
  s: SiteState,
  id: string,
  build: SiteBuild | null = peekSiteBuild(),
): [number, number] | null {
  const g = s.groups.find((x) => x.id === id);
  const pg = build?.groups.find((x) => x.group.id === id);
  if (!g || !pg?.def || pg.group.multiblockId !== g.multiblockId) return null;
  const w = pg.max[0] - pg.min[0];
  const d = pg.max[2] - pg.min[2];
  return (g.rotation - pg.group.rotation) % 2 === 0 ? [w, d] : [d, w];
}

/** The site grown so group `id` (with footprint `fp`) is inside it, with a corridor around it. */
export function grownFor(s: SiteState, id: string, fp: [number, number] | null): SiteState {
  const g = s.groups.find((x) => x.id === id);
  if (!g || !fp) return s;
  const max: [number, number] = [g.origin[0] + fp[0], g.origin[1] + fp[1]];
  return withGrownToFit(s, g.origin, max, Math.max(1, s.corridor));
}

/** Apply `fn` to the site and grow it when group `id` ends up past an edge (one undo step). */
function editGroup(id: string, fn: (s: SiteState) => SiteState): void {
  updateSite((s) => {
    const next = fn(s);
    return next === s ? s : grownFor(next, id, footprintOf(next, id));
  });
}

/**
 * Resolves with the first build made from a site in which group `id` is the object `group` (a patched group
 * is a new object; unrelated edits keep it): the groups are placed before routing, so a pending build is
 * enough. Null when the group is removed or replaced by another object, a build fails, `timeoutMs` passes
 * or `signal` aborts. Its subscriptions end as soon as it settles.
 */
export function whenBuiltGroup(
  id: string,
  group: SiteGroup,
  builds: Readable<SiteResult> = siteBuild,
  timeoutMs = 120000,
  sites: Readable<SiteState> = site,
  signal?: AbortSignal,
): Promise<SiteBuild | null> {
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    let done = false;
    let subscribed = false;
    const finish = (build: SiteBuild | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // While subscribing, the stop functions do not exist yet: they are called below.
      if (subscribed) stops.forEach((stop) => stop());
      resolve(build);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (signal?.aborted) return finish(null);
    signal?.addEventListener('abort', onAbort);
    stops.push(
      sites.subscribe((s) => {
        if (s.groups.find((g) => g.id === id) !== group) finish(null);
      }),
    );
    // A watch that ended on the first site does not start a build by subscribing.
    if (!done)
      stops.push(
        builds.subscribe((r) => {
          // A retained result of an earlier site says nothing about this group.
          if (r.of?.groups.find((g) => g.id === id) !== group) return;
          finish(r.error ? null : r.build);
        }),
      );
    subscribed = true;
    if (done) stops.forEach((stop) => stop());
  });
}

let growWatch: AbortController | null = null;
/**
 * Group `id` has just been changed (count, limits, height) and the site is `patched`: once a build of that
 * state arrives, grow the site if the group no longer fits. The growth is part of the same undo step unless
 * the user edited something else meanwhile. A newer call replaces this watch.
 */
export function growAfterBuild(
  id: string,
  patched: SiteState,
  builds: Readable<SiteResult> = siteBuild,
): void {
  growWatch?.abort();
  const group = patched.groups.find((g) => g.id === id);
  if (!group) return;
  const watch = (growWatch = new AbortController());
  void whenBuiltGroup(id, group, builds, undefined, site, watch.signal).then((build) => {
    if (growWatch === watch) growWatch = null;
    if (!build || watch.signal.aborted) return;
    const s = get(site);
    const next = grownFor(s, id, footprintOf(s, id, build));
    if (next === s) return;
    if (s === patched) mergeIntoLast();
    site.set(next);
  });
}

/** Patch group `id` and, if that can make it bigger, grow the site once the group is rebuilt. */
export function patchGroup(id: string, patch: GroupPatch): void {
  const before = get(site);
  updateSite((s) => withGroupPatched(s, id, patch));
  const patched = get(site);
  // Another machine or machine type can end a transformer's direction and amperage: say so.
  if ((patch.machine !== undefined || patch.multiblockId !== undefined) && patched !== before) {
    const was = before.groups.find((g) => g.id === id);
    const now = patched.groups.find((g) => g.id === id);
    if (was && now && (was.step || was.amps) && !now.step && !now.amps) notify(t.site.transformerReset);
  }
  if (patched !== before) growAfterBuild(id, patched);
}

/** Set the selected group's X (`axis` 0) or Z (1) corner, growing the site if it leaves it. */
export function setSelectedOrigin(axis: 0 | 1, n: number): void {
  const gid = selectedId();
  const g = gid ? get(site).groups.find((x) => x.id === gid) : undefined;
  if (!gid || !g) return;
  const o: [number, number] = [...g.origin];
  o[axis] = n;
  holdRouting();
  editGroup(gid, (s) => withGroupPatched(s, gid, { origin: o }));
}

function selectedId(): string | null {
  const gid = get(siteGroup);
  return gid && get(site).groups.some((g) => g.id === gid) ? gid : null;
}

export function groupName(id: string): string {
  const g = get(site).groups.find((x) => x.id === id);
  return g?.label ?? (g && getSiteDef(g.multiblockId)?.name) ?? id;
}

function selectedPortId(): string | null {
  const pid = get(sitePort);
  return pid && get(site).ports.some((p) => p.id === pid) ? pid : null;
}

/** A port's cell [x, z] from the last build, or null before it has been placed. */
function portCell(id: string): [number, number] | null {
  const pp = peekSiteBuild()?.ports.find((p) => p.port.id === id);
  return pp ? [pp.cell[0], pp.cell[2]] : null;
}

/** Pin port `pid` `dx`, `dz` blocks from where it stands now (it stays inside the site). */
function movePortBy(pid: string, dx: number, dz: number, coalesce: boolean): void {
  const cell = portCell(pid);
  if (!cell) return;
  if (coalesce) coalesceNext(`move:port:${pid}`);
  holdRouting();
  updateSite((s) => withPortPlaced(s, pid, [cell[0] + dx, cell[1] + dz]));
}

/** Give the selected port back to automatic placement on the edge. */
export function autoPlaceSelectedPort(): void {
  const pid = selectedPortId();
  if (!pid) return;
  holdRouting();
  updateSite((s) => withPortPlaced(s, pid, null));
}

/**
 * Move the selected group or port by whole blocks along the site axes. With `coalesce` (key presses),
 * quick repeats are one undo step; a drag is always its own step.
 */
export function moveSelectedBy(dx: number, dz: number, coalesce = true): void {
  if (dx === 0 && dz === 0) return;
  const pid = selectedPortId();
  if (pid) return movePortBy(pid, dx, dz, coalesce);
  const gid = selectedId();
  if (!gid) return;
  if (coalesce) coalesceNext(`move:${gid}`);
  holdRouting();
  editGroup(gid, (s) => withGroupMoved(s, gid, dx, dz));
}

/** Move the selected group one step (or `FAST_STEP`) in the screen direction of an arrow key. */
export function moveSelected(key: ArrowKey, fast: boolean): void {
  const [dx, dz] = screenStep(key, get(viewTheta));
  const n = fast ? FAST_STEP : 1;
  moveSelectedBy(dx * n, dz * n);
}

/** Raise (positive `dy`) or lower the selected group by whole blocks, between the ground and the top. */
export function liftSelected(dy: number, coalesce = true): void {
  const gid = selectedId();
  const g = gid ? get(site).groups.find((x) => x.id === gid) : undefined;
  if (!gid || !g || dy === 0) return;
  const to = Math.min(SITE_MAX_ELEVATION, Math.max(0, (g.elevation ?? 0) + dy));
  if (coalesce) coalesceNext(`lift:${gid}`);
  holdRouting();
  updateSite((s) => withGroupPatched(s, gid, { elevation: to }));
}

/** PageUp / PageDown: one block, or `FAST_STEP` with Shift. */
export function liftSelectedStep(dir: 1 | -1, fast: boolean): void {
  liftSelected(dir * (fast ? FAST_STEP : 1));
}

export function rotateSelected(dir: 1 | -1): void {
  const gid = selectedId();
  if (!gid) return;
  coalesceNext(`turn:${gid}`);
  holdRouting();
  editGroup(gid, (s) => withGroupRotated(s, gid, dir));
}

export function duplicateSelected(): void {
  const gid = selectedId();
  if (!gid) return;
  const s = get(site);
  const dup = withGroupDuplicated(s, gid, freeOrigin(s, peekSiteBuild()));
  if (dup === s) return;
  const id = dup.groups[dup.groups.length - 1].id;
  site.set(grownFor(dup, id, footprintOf(s, gid)));
  siteGroup.set(id);
  notify(t.site.duplicated, 3000, 'edit', undoAction());
}

/** Remove the selected group at once; the notice offers Undo. */
export function removeSelected(): void {
  const gid = selectedId();
  if (!gid) return;
  const name = groupName(gid);
  siteGroup.set(null);
  updateSite((s) => withGroupRemoved(s, gid));
  notify(t.site.removed(name), 6000, 'edit', undoAction());
}

/** Aim the camera at the selected group or port (or do nothing when it is not built yet). */
export function frameSelected(): void {
  const pid = selectedPortId();
  const cell = pid ? portCell(pid) : null;
  if (cell) {
    frameRequest.set({ min: [cell[0], 0, cell[1]], max: [cell[0] + 1, 1, cell[1] + 1], seq: ++frameSeq });
    return;
  }
  const gid = selectedId();
  const g = peekSiteBuild()?.groups.find((x) => x.group.id === gid);
  if (!g) return;
  frameRequest.set({ min: g.min, max: g.max, seq: ++frameSeq });
}
