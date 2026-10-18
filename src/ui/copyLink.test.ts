import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { t } from '../i18n/en';
import { LinkTooLargeError } from '../share/binary';
import { notices } from './notices';
import { copyShareLink } from './session';
import { shareApi } from './shareApi';
import { copySiteLink } from './siteSession';

const downloadSiteJson = vi.hoisted(() => vi.fn());
vi.mock('../share/sitePersist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../share/sitePersist')>()),
  siteHashUrl: () => Promise.reject(new LinkTooLargeError()),
  downloadSiteJson,
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('copying a link that is too large', () => {
  beforeEach(() => notices.set([]));
  afterEach(() => vi.useRealTimers());

  it('offers the site JSON in a notice that stays', async () => {
    vi.useFakeTimers();
    await copySiteLink();
    const [n] = get(notices);
    expect(n?.text).toBe(t.site.tooLargeForLink);
    expect(n?.action?.label).toBe(t.downloadJson);
    vi.advanceTimersByTime(60_000);
    expect(get(notices)).toHaveLength(1);
    n!.action!.run();
    expect(downloadSiteJson).toHaveBeenCalledOnce();
  });

  it('offers the plan JSON in a notice that stays', async () => {
    vi.useFakeTimers();
    const download = vi.fn();
    const saved = { ...shareApi };
    shareApi.planHashUrl = () => Promise.reject(new LinkTooLargeError());
    shareApi.downloadPlanJson = download;
    try {
      await copyShareLink();
      const [n] = get(notices);
      expect(n?.text).toBe(t.planTooLargeForLink);
      vi.advanceTimersByTime(60_000);
      expect(get(notices)).toHaveLength(1);
      n!.action!.run();
      expect(download).toHaveBeenCalledOnce();
    } finally {
      Object.assign(shareApi, saved);
    }
  });
});
