import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptySite } from '../share/siteCodec';
import { appMode, isolate, site, siteGroup, siteLink, siteLinkDraft, sitePort } from './site';

describe('link selection', () => {
  beforeEach(() => {
    siteLink.set(null);
    siteGroup.set(null);
    sitePort.set(null);
    siteLinkDraft.set(false);
    isolate.set(null);
    site.set({
      ...emptySite(),
      resources: { 'item:a': { kind: 'item', name: 'A', color: '#ffffff' } },
      links: [{ id: 'l1', from: { port: 'in1' }, to: { group: 'g1' }, resource: 'item:a' }],
    });
  });

  it('isolates the resource of the selected link and lets go of it on deselect', () => {
    siteLink.set('l1');
    expect(get(isolate)).toBe('item:a');
    siteLink.set(null);
    expect(get(isolate)).toBeNull();
  });

  it('keeps an isolation someone else changed meanwhile', () => {
    siteLink.set('l1');
    isolate.set('item:b');
    siteLink.set(null);
    expect(get(isolate)).toBe('item:b');
  });

  it('ends its isolation when the link is removed before it is deselected', () => {
    siteLink.set('l1');
    site.update((s) => ({ ...s, links: [] }));
    siteLink.set(null);
    expect(get(isolate)).toBeNull();
  });

  it('ends its isolation when the new link form takes over', () => {
    siteLink.set('l1');
    siteLinkDraft.set(true);
    expect(get(siteLink)).toBeNull();
    expect(get(isolate)).toBeNull();
  });

  it('is cleared with the draft when the Template view is left', () => {
    appMode.set('site');
    siteLink.set('l1');
    appMode.set('machine');
    expect(get(siteLink)).toBeNull();
    siteLinkDraft.set(true);
    appMode.set('site');
    appMode.set('machine');
    expect(get(siteLinkDraft)).toBe(false);
  });

  it('is never selected together with a group, a port or the new link form', () => {
    siteLink.set('l1');
    siteGroup.set('g1');
    expect(get(siteLink)).toBeNull();
    sitePort.set('in1');
    expect(get(siteGroup)).toBeNull();
    siteLink.set('l1');
    expect(get(sitePort)).toBeNull();
    siteLinkDraft.set(true);
    expect(get(siteLink)).toBeNull();
    siteGroup.set('g1');
    expect(get(siteLinkDraft)).toBe(false);
  });
});
