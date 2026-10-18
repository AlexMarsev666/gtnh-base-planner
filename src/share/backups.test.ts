import { describe, expect, it } from 'vitest';
import { keepBackup, listBackups, pruneBackups } from './backups';
import type { StorageLike } from './persist';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  /** Writes of new keys fail while the store holds this many entries or more. */
  capacity = Infinity;
  /** Writes succeed but nothing is stored. */
  dropWrites = false;
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
    if (this.dropWrites) return;
    if (!this.map.has(k) && this.map.size >= this.capacity) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const P = 'app:v1';
const keys = (s: FakeStorage) => [...s.map.keys()].sort();

describe('keepBackup', () => {
  it('writes a verified copy under <prefix>:backup-<ms>', () => {
    const s = new FakeStorage();
    expect(keepBackup(s, P, 'raw', () => 100)).toBe(`${P}:backup-100`);
    expect(s.getItem(`${P}:backup-100`)).toBe('raw');
  });

  it('does not copy the same value twice', () => {
    const s = new FakeStorage();
    const first = keepBackup(s, P, 'raw', () => 100);
    expect(keepBackup(s, P, 'raw', () => 200)).toBe(first);
    expect(s.length).toBe(1);
  });

  it('keeps distinct values written in the same millisecond', () => {
    const s = new FakeStorage();
    keepBackup(s, P, 'a', () => 7);
    keepBackup(s, P, 'b', () => 7);
    expect(s.length).toBe(2);
  });

  it('keeps the newest 3 and never touches foreign keys', () => {
    const s = new FakeStorage();
    s.map.set('other:backup-1', 'x');
    s.map.set(P, 'main');
    s.map.set(`${P}x:backup-1`, 'y');
    for (let i = 1; i <= 5; i++) keepBackup(s, P, `v${i}`, () => i * 10);
    expect(listBackups(s, P).map((b) => b.savedAt)).toEqual([50, 40, 30]);
    expect(s.getItem('other:backup-1')).toBe('x');
    expect(s.getItem(P)).toBe('main');
    expect(s.getItem(`${P}x:backup-1`)).toBe('y');
  });

  it('keeps the new copy even when the clock went backwards', () => {
    const s = new FakeStorage();
    for (const at of [100, 200, 300]) keepBackup(s, P, `v${at}`, () => at);
    expect(keepBackup(s, P, 'late', () => 1)).toBe(`${P}:backup-1`);
    expect(s.getItem(`${P}:backup-1`)).toBe('late');
    expect(s.length).toBe(3);
  });

  it('tolerates non-numeric suffixes (listed last, still pruned)', () => {
    const s = new FakeStorage();
    s.map.set(`${P}:backup-old`, 'o');
    s.map.set(`${P}:backup-5`, 'a');
    expect(listBackups(s, P).map((b) => b.key)).toEqual([`${P}:backup-5`, `${P}:backup-old`]);
    keepBackup(s, P, 'b', () => 6);
    keepBackup(s, P, 'c', () => 7);
    expect(keys(s)).toEqual([`${P}:backup-5`, `${P}:backup-6`, `${P}:backup-7`]);
  });

  it('on a full store deletes nothing and reports no copy', () => {
    const s = new FakeStorage();
    s.map.set('unrelated', 'u');
    for (const at of [1, 2, 3]) keepBackup(s, P, `v${at}`, () => at);
    s.capacity = 0;
    const before = keys(s);
    expect(keepBackup(s, P, 'new', () => 4)).toBeUndefined();
    expect(keys(s)).toEqual(before);
  });

  it('reports no copy when it does not read back', () => {
    const s = new FakeStorage();
    s.dropWrites = true;
    expect(keepBackup(s, P, 'a', () => 1)).toBeUndefined();
  });
});

describe('pruneBackups', () => {
  it('keeps the newest `keep`', () => {
    const s = new FakeStorage();
    for (const at of [1, 2, 3, 4]) s.map.set(`${P}:backup-${at}`, String(at));
    pruneBackups(s, P, 2);
    expect(keys(s)).toEqual([`${P}:backup-3`, `${P}:backup-4`]);
  });
});
