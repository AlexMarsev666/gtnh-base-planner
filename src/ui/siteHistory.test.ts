import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySite } from '../share/siteCodec';
import { site, siteGroup } from '../state/site';
import { withGroupAdded, withGroupMoved, withGroupPatched } from './siteActions';
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
  afterEach(() => {
    stop?.();
    site.set(emptySite());
    siteGroup.set(null);
  });

  it('restores manual resource assignments and machine count with undo/redo', () => {
    site.set(withGroupAdded(emptySite(), 'oil-cracking-unit'));
    const id = get(site).groups[0].id;
    site.update((s) => withGroupPatched(s, id, { count: 2 }));
    stop = startSiteHistory();
    site.update((s) =>
      withGroupPatched(s, id, {
        resourceBindings: [{ kind: 'fluidIn', resource: 'hydrogen', role: 'catalyst', unitId: 1 }],
      }),
    );
    site.update((s) => withGroupPatched(s, id, { count: 1 }));
    expect(get(site).groups[0].resourceBindings![0].unitId).toBe(1);
    expect(undo()).toBe(true);
    expect(get(site).groups[0].count).toBe(2);
    expect(get(site).groups[0].resourceBindings![0].unitId).toBe(1);
    expect(undo()).toBe(true);
    expect(get(site).groups[0].resourceBindings).toBeUndefined();
    expect(redo()).toBe(true);
    expect(get(site).groups[0].resourceBindings![0].unitId).toBe(1);
    expect(redo()).toBe(true);
    expect(get(site).groups[0].count).toBe(1);
    expect(get(site).groups[0].resourceBindings![0].unitId).toBe(1);
  });

  it('undoes site changes and clears a selection that no longer exists', () => {
    site.set(emptySite());
    stop = startSiteHistory();
    site.update((s) => withGroupAdded(s, 'coke-oven'));
    const gid = get(site).groups[0].id;
    siteGroup.set(gid);
    coalesceNext(`move:${gid}`);
    site.update((s) => withGroupMoved(s, gid, 1, 0));
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
});
