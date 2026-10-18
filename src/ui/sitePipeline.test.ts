import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneModel } from '../model/render/types';
import { createSiteBuilder } from '../model/site/build';
import { effectiveRouting, siteFromJson } from '../share/siteCodec';
import { appMode, site, sitePipes } from '../state/site';
import { connectBelow } from '../state/store';
import {
  forgetPipes,
  holdRouting,
  peekSiteBuild,
  resubmitLatest,
  ROUTE_IDLE_MS,
  siteBuild,
  siteBuildInView,
  siteRouteInfo,
  siteScene,
  type SiteResult,
} from './sitePipeline';

afterEach(() => {
  vi.useRealTimers();
  sitePipes.set(true);
});

describe('siteBuild subscription', () => {
  it('stops the idle timer and forgets its request when the last subscriber leaves', () => {
    vi.useFakeTimers();
    sitePipes.set(true);
    holdRouting();
    const stop = siteBuild.subscribe(() => {});
    const shown = peekSiteBuild();
    expect(shown).not.toBeNull();
    stop();
    vi.advanceTimersByTime(ROUTE_IDLE_MS + 400);
    expect(peekSiteBuild()).toBe(shown);
    // Nothing shows the site: asking again builds nothing.
    resubmitLatest();
    expect(peekSiteBuild()).toBe(shown);
  });

  it('submits the routed build once input has paused, while subscribed', () => {
    vi.useFakeTimers();
    sitePipes.set(true);
    holdRouting();
    const stop = siteBuild.subscribe(() => {});
    const quick = peekSiteBuild();
    vi.advanceTimersByTime(ROUTE_IDLE_MS + 400);
    expect(peekSiteBuild()).not.toBe(quick);
    stop();
  });
});

const sceneWith = (pipes: SceneModel['pipes']) => ({ pipes }) as SceneModel;
const result = (pipes: SceneModel['pipes'], pending?: boolean): SiteResult => ({
  build: { scene: sceneWith(pipes), nets: [] } as never,
  error: null,
  pending,
});
const pipe = { id: 1 } as NonNullable<SceneModel['pipes']>[number];

describe('siteScene faded pipes', () => {
  it('shows the last routed pipes faded while routing is pending', () => {
    const stop = siteScene.subscribe(() => {});
    siteBuild.set(result([pipe]));
    siteBuild.set(result(null, true));
    expect(get(siteScene)?.pipes).toEqual([{ ...pipe, dim: true }]);
    stop();
  });

  it('forgetPipes() leaves a pending scene without pipes', () => {
    const stop = siteScene.subscribe(() => {});
    siteBuild.set(result([pipe]));
    forgetPipes();
    siteBuild.set(result(null, true));
    expect(get(siteScene)?.pipes).toBeNull();
    stop();
  });

  it('starts a new subscription without the pipes of the old one', () => {
    const first = siteScene.subscribe(() => {});
    siteBuild.set(result([pipe]));
    first();
    const second = siteScene.subscribe(() => {});
    siteBuild.set(result(null, true));
    expect(get(siteScene)?.pipes).toBeNull();
    second();
  });
});

describe('site view subscriptions', () => {
  it('builds only while the site view is shown', () => {
    sitePipes.set(false);
    appMode.set('machine');
    const stop = siteBuildInView.subscribe(() => {});
    const none = peekSiteBuild();
    connectBelow.update((b) => !b);
    expect(peekSiteBuild()).toBe(none);

    appMode.set('site');
    const built = peekSiteBuild();
    expect(built).not.toBe(none);
    connectBelow.update((b) => !b);
    expect(peekSiteBuild()).not.toBe(built);

    appMode.set('machine');
    const left = peekSiteBuild();
    connectBelow.update((b) => !b);
    expect(peekSiteBuild()).toBe(left);
    expect(get(siteBuildInView).build).toBeNull();
    stop();
    sitePipes.set(true);
  });
});

describe('routing of the site build', () => {
  const fixture = (name: string) =>
    siteFromJson(readFileSync(new URL(`../share/fixtures/${name}`, import.meta.url), 'utf8'));

  it('builds a site without routing as before: effective routing equals the old below flag', () => {
    for (const name of ['import.json', 'site.json']) {
      const s = fixture(name);
      for (const below of [false, true]) {
        const old = createSiteBuilder()(s, { pipes: true, cables: true, below });
        const routing = effectiveRouting(s, below);
        const now = createSiteBuilder()(s, { pipes: true, cables: true, below: routing.depth > 0, routing });
        expect(JSON.stringify(now)).toBe(JSON.stringify(old));
      }
    }
  });

  it('uses the browser switch for a site without routing, and the site routing once set', () => {
    appMode.set('site');
    sitePipes.set(false);
    const base = { ...fixture('import.json') };
    delete base.routing;
    connectBelow.set(false);
    site.set(base);
    const stop = siteBuildInView.subscribe(() => {});
    expect(peekSiteBuild()?.routing).toMatchObject({ style: 'classic', depth: 0 });
    connectBelow.set(true);
    expect(peekSiteBuild()?.routing).toMatchObject({ style: 'classic', depth: 1 });

    site.set({ ...base, routing: { style: 'neat', depth: 2 } });
    const set = peekSiteBuild();
    expect(set?.routing).toMatchObject({ style: 'neat' });
    // The switch no longer matters, and does not even rebuild.
    connectBelow.set(false);
    expect(peekSiteBuild()).toBe(set);
    stop();
    sitePipes.set(true);
    site.set(fixture('import.json'));
  });

  it('exposes the route statistics and the depth used of a routed build', () => {
    appMode.set('site');
    sitePipes.set(true);
    site.set(fixture('import.json'));
    vi.useFakeTimers();
    const stop = siteRouteInfo.subscribe(() => {});
    // Routing waits while an earlier test's edit is recent.
    vi.advanceTimersByTime(ROUTE_IDLE_MS + 400);
    const info = get(siteRouteInfo);
    expect(info).not.toBeNull();
    expect(info?.routeStats).toBeDefined();
    expect(typeof info?.depthUsed).toBe('number');
    stop();
    appMode.set('machine');
  });
});
