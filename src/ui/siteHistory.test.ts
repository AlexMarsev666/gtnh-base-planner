import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteState } from '../model/site/types';
import { emptySite } from '../share/siteCodec';
import { site, siteGroup } from '../state/site';
import { withGroupAdded, withGroupMoved, withGroupPatched, withRouting } from './siteActions';
import {
  COALESCE_MS,
  MAX_STEPS,
  coalesceNext,
  emptyHistory,
  recorded,
  redo,
  redone,
  startSiteHistory,
  undo,
  undone,
} from './siteHistory';

describe('history steps', () => {
  it('undoes and redoes in order', () => {
    let h = recorded(emptyHistory<number>(), 1, null, 0);
    h = recorded(h, 2, null, 10);
    const u = undone(h, 3)!;
    expect(u.value).toBe(2);
    const u2 = undone(u.history, 2)!;
    expect(u2.value).toBe(1);
    expect(undone(u2.history, 1)).toBeNull();
    const r = redone(u2.history, 1)!;
    expect(r.value).toBe(2);
  });

  it('a new change clears the redo steps', () => {
    let h = recorded(emptyHistory<number>(), 1, null, 0);
    h = undone(h, 2)!.history;
    expect(h.future).toEqual([2]);
    h = recorded(h, 1, null, 5);
    expect(h.future).toEqual([]);
  });

  it('merges quick changes with the same key into one step', () => {
    let h = recorded(emptyHistory<number>(), 1, 'move:g1', 0);
    h = recorded(h, 2, 'move:g1', 100);
    h = recorded(h, 3, 'move:g1', 200);
    expect(h.past).toEqual([1]);
    h = recorded(h, 4, 'move:g1', 200 + COALESCE_MS + 1);
    expect(h.past).toEqual([1, 4]);
    h = recorded(h, 5, 'move:g2', 200 + COALESCE_MS + 2);
    expect(h.past).toEqual([1, 4, 5]);
  });

  it('keeps at most MAX_STEPS steps', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < MAX_STEPS + 10; i++) h = recorded(h, i, null, i);
    expect(h.past.length).toBe(MAX_STEPS);
    expect(h.past[0]).toBe(10);
  });
});

describe('site history', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    stop?.();
    site.set(emptySite());
    siteGroup.set(null);
  });

  it('undoes site changes and clears a selection that no longer exists', () => {
    site.set(emptySite());
    stop = startSiteHistory();
    site.update((s) => withGroupAdded(s, 'coke-oven'));
    const gid = get(site).groups[0].id;
    siteGroup.set(gid);
    coalesceNext(`move:${gid}`);
    site.update((s) => withGroupMoved(s, gid, 1, 0));
    vi.setSystemTime(COALESCE_MS / 2); // inside the window, so the second move joins the first step
    coalesceNext(`move:${gid}`);
    site.update((s) => withGroupMoved(s, gid, 1, 0));
    expect(get(site).groups[0].origin).toEqual([5, 3]);

    expect(undo()).toBe(true);
    expect(get(site).groups[0].origin).toEqual([3, 3]);
    expect(undo()).toBe(true);
    expect(get(site).groups).toEqual([]);
    expect(get(siteGroup)).toBeNull();
    expect(undo()).toBe(false);

    expect(redo()).toBe(true);
    expect(redo()).toBe(true);
    expect(get(site).groups[0].origin).toEqual([5, 3]);
  });

  it('undoes and redoes each optional group and site field', () => {
    site.set(emptySite());
    stop = startSiteHistory();
    site.update((s) => withGroupAdded(s, 'coke-oven'));
    const gid = get(site).groups[0].id;
    const steps: [string, (s: SiteState) => SiteState][] = [
      ['tier', (s) => withGroupPatched(s, gid, { tier: 'HV' })],
      ['hatchTiers', (s) => withGroupPatched(s, gid, { hatchTiers: { 'energy:0': 'EV' } })],
      ['mirror', (s) => withGroupPatched(s, gid, { mirror: true })],
      ['wallshare', (s) => withGroupPatched(s, gid, { wallshare: 'stack' })],
      ['assign', (s) => withGroupPatched(s, gid, { assign: { 'item:dust': { unit: 1 } } })],
      ['step', (s) => withGroupPatched(s, gid, { step: 'up' })],
      ['amps', (s) => withGroupPatched(s, gid, { amps: 16 })],
      ['routing', (s) => withRouting(s, { style: 'neat', depth: 2 })],
      ['seed', (s) => ({ ...s, seed: 42 })],
    ];
    const states: SiteState[] = [get(site)];
    for (const [name, change] of steps) {
      vi.setSystemTime(Date.now() + COALESCE_MS * 2);
      site.update(change);
      expect(get(site), name).not.toEqual(states[states.length - 1]);
      states.push(get(site));
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      expect(undo(), steps[i][0]).toBe(true);
      expect(get(site), steps[i][0]).toEqual(states[i]);
    }
    for (let i = 1; i <= steps.length; i++) {
      expect(redo(), steps[i - 1][0]).toBe(true);
      expect(get(site), steps[i - 1][0]).toEqual(states[i]);
    }
  });
});
