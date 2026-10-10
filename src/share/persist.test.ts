import { describe, expect, it } from 'vitest';
import type { PlanState } from '../model/plan/types';
import { defaultPlan } from '../state/store';
import { encodePlan } from './codec';
import {
  BACKUP_PREFIX,
  STORAGE_KEY,
  clearHash,
  hashPlanParam,
  loadStoredPlan,
  planFromJson,
  planHashUrl,
  planToJson,
  readHashPlan,
  readPlanFile,
  readStoredPlan,
  saveStoredPlan,
  type StorageLike,
  type WindowLike,
} from './persist';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

function fakeWindow(href: string): WindowLike & { calls: string[] } {
  const url = new URL(href);
  const calls: string[] = [];
  return {
    calls,
    location: {
      get hash() {
        return url.hash;
      },
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get href() {
        return url.href;
      },
    },
    history: {
      state: { keep: true },
      replaceState(_data: unknown, _unused: string, next?: string | URL | null) {
        calls.push(String(next));
        const u = new URL(String(next), url);
        url.hash = u.hash;
      },
    },
  };
}

const sample = (): PlanState => ({
  ...defaultPlan(),
  count: 6,
  limits: { x: 12, y: null, z: null },
  colors: { itemIn: '#123456' },
  manualUnits: [{ id: 0, origin: [0, 0, 0], rotation: 1 }],
});

describe('localStorage', () => {
  it('returns null when nothing is stored or storage is unavailable', () => {
    expect(loadStoredPlan(new FakeStorage())).toBeNull();
    expect(loadStoredPlan(null)).toBeNull();
    const throwing = new FakeStorage();
    throwing.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(loadStoredPlan(throwing)).toBeNull();
  });

  it('saves and loads a plan', () => {
    const storage = new FakeStorage();
    expect(saveStoredPlan(sample(), storage)).toBe(true);
    expect(loadStoredPlan(storage)).toEqual(sample());
  });

  it('never writes an invalid plan and reports full storage', () => {
    const storage = new FakeStorage();
    saveStoredPlan(sample(), storage);
    expect(saveStoredPlan({ ...sample(), count: 0 }, storage)).toBe(false);
    expect(loadStoredPlan(storage)).toEqual(sample());
    storage.failWrites = true;
    expect(saveStoredPlan(defaultPlan(), storage)).toBe(false);
  });

  it('backs up an unreadable plan without touching the original', () => {
    const storage = new FakeStorage();
    const bad = '{"v":1,"multiblockId":"<script>","count":4}';
    storage.setItem(STORAGE_KEY, bad);
    const result = readStoredPlan(storage, () => 1234);
    expect(result.plan).toBeNull();
    expect(result.error).toMatch(/multiblock/i);
    expect(result.backupKey).toBe(`${BACKUP_PREFIX}1234`);
    expect(storage.getItem(`${BACKUP_PREFIX}1234`)).toBe(bad);
    expect(storage.getItem(STORAGE_KEY)).toBe(bad);

    // A second failed load of the same data does not pile up copies.
    expect(loadStoredPlan(storage, () => 9999)).toBeNull();
    expect(storage.length).toBe(2);
  });

  it('backs up non-JSON and wrong-version data', () => {
    for (const bad of ['not json', '{"v":2}', 'x'.repeat(1024 * 1024 + 1)]) {
      const storage = new FakeStorage();
      storage.setItem(STORAGE_KEY, bad);
      expect(loadStoredPlan(storage, () => 1)).toBeNull();
      expect(storage.getItem(`${BACKUP_PREFIX}1`)).toBe(bad);
      expect(storage.getItem(STORAGE_KEY)).toBe(bad);
    }
  });

  it('still returns null when the backup cannot be written', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, 'garbage');
    storage.failWrites = true;
    const result = readStoredPlan(storage);
    expect(result.plan).toBeNull();
    expect(result.backupKey).toBeUndefined();
    expect(storage.getItem(STORAGE_KEY)).toBe('garbage');
  });
});

describe('URL hash', () => {
  it('reads nothing when there is no plan in the hash', async () => {
    expect(await readHashPlan({ hash: '' })).toBeNull();
    expect(await readHashPlan({ hash: '#' })).toBeNull();
    expect(await readHashPlan({ hash: '#view=detailed' })).toBeNull();
    expect(await readHashPlan(null)).toBeNull();
  });

  it('reads a shared plan', async () => {
    const hash = `#p=${await encodePlan(sample())}`;
    expect(await readHashPlan({ hash })).toEqual(sample());
    expect(await readHashPlan({ hash: `#x=1&${hash.slice(1)}` })).toEqual(sample());
  });

  it('rejects damaged and legacy links with a readable error', async () => {
    await expect(readHashPlan({ hash: '#p=%3Cscript%3E' })).rejects.toThrow(/damaged/);
    await expect(readHashPlan({ hash: '#p=' })).rejects.toThrow(/empty/);
    await expect(readHashPlan({ hash: '#plan=eyJ4IjoxfQ' })).rejects.toThrow(/older version/);
  });

  it('clears the plan from the address bar with replaceState', () => {
    const win = fakeWindow('https://example.test/planner/?a=1#p=abc');
    clearHash(win);
    expect(win.calls).toEqual(['/planner/?a=1']);
    expect(win.location.hash).toBe('');

    const other = fakeWindow('https://example.test/#x=1&p=abc');
    clearHash(other);
    expect(other.calls).toEqual(['/#x=1']);

    const none = fakeWindow('https://example.test/');
    clearHash(none);
    expect(none.calls).toEqual([]);
    clearHash(null);
  });

  it('builds a share URL that reads back', async () => {
    const url = await planHashUrl(sample(), 'https://example.test/app/?q=1#p=old');
    expect(url.startsWith('https://example.test/app/?q=1#p=')).toBe(true);
    const hash = new URL(url).hash;
    expect(hashPlanParam(hash)).not.toBe('old');
    expect(await readHashPlan({ hash })).toEqual(sample());
    expect((await planHashUrl(defaultPlan(), 'https://example.test/')).length).toBeLessThan(
      'https://example.test/'.length + 200,
    );
  });
});

describe('JSON files', () => {
  it('round-trips through pretty JSON with a version', () => {
    const json = planToJson(sample());
    expect(json).toContain('\n  "v": 1');
    expect(planFromJson(json)).toEqual(sample());
  });

  it('rejects invalid files', () => {
    expect(() => planFromJson('{')).toThrow(/not valid JSON/);
    expect(() => planFromJson('null')).toThrow();
    expect(() => planFromJson(' '.repeat(1024 * 1024 + 1))).toThrow(/too large/);
    expect(() =>
      planFromJson(JSON.stringify({ ...sample(), colors: { itemIn: 'javascript:alert(1)' } })),
    ).toThrow(/#rrggbb/);
  });

  it('reads uploaded files and refuses huge ones', async () => {
    expect(await readPlanFile(new Blob([planToJson(sample())]))).toEqual(sample());
    await expect(readPlanFile(new Blob(['x'.repeat(1024 * 1024 + 1)]))).rejects.toThrow(/too large/);
  });
});
