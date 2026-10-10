import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneModel } from '../model/render/types';
import { appMode, sitePipes } from '../state/site';
import { connectBelow } from '../state/store';
import {
  forgetPipes,
  holdRouting,
  peekSiteBuild,
  resubmitLatest,
  ROUTE_IDLE_MS,
  siteBuild,
  siteBuildInView,
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
