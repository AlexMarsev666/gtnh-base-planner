import type { StorageLike } from './persist';

/**
 * Backup copies of unreadable stored data, kept under `<storage key>:backup-<ms>`. Shared by plan and
 * site persistence; only keys of the given storage key are ever looked at, listed or removed.
 */

/** How many backups of one storage key are kept. */
export const KEEP_BACKUPS = 3;

export interface BackupInfo {
  key: string;
  /** Milliseconds since the epoch; 0 when the key suffix is not a number. */
  savedAt: number;
}

const marker = (prefix: string) => `${prefix}:backup-`;

/** Backups of `prefix`, newest first. Throws if the storage cannot be enumerated. */
export function listBackups(storage: StorageLike, prefix: string): BackupInfo[] {
  const start = marker(prefix);
  const found: BackupInfo[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(start)) continue;
    const savedAt = Number(key.slice(start.length));
    found.push({ key, savedAt: Number.isFinite(savedAt) ? savedAt : 0 });
  }
  return found.sort((a, b) => b.savedAt - a.savedAt || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

function removeAll(storage: StorageLike, keys: string[]): void {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // A key that cannot be removed just stays.
    }
  }
}

/** Removes all but the newest `keep` backups of `prefix`. */
export function pruneBackups(storage: StorageLike, prefix: string, keep = KEEP_BACKUPS): void {
  try {
    removeAll(
      storage,
      listBackups(storage, prefix)
        .slice(keep)
        .map((b) => b.key),
    );
  } catch {
    // Storage cannot be enumerated: nothing to prune.
  }
}

/**
 * Copies `raw` to a new backup key (once per distinct value), checks it reads back, and keeps only the
 * newest few. A failing write (storage full) deletes nothing: older backups may be the only copies of
 * earlier data, and the caller keeps the original in place. Returns the key, or undefined if no verified
 * copy exists.
 */
export function keepBackup(
  storage: StorageLike,
  prefix: string,
  raw: string,
  now: () => number = Date.now,
): string | undefined {
  try {
    const existing = listBackups(storage, prefix);
    for (const b of existing) if (storage.getItem(b.key) === raw) return b.key;
    let at = now();
    while (storage.getItem(`${marker(prefix)}${at}`) !== null) at++;
    const key = `${marker(prefix)}${at}`;
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) {
      removeAll(storage, [key]);
      return undefined;
    }
    // The new copy always survives, even if the clock went backwards.
    removeAll(
      storage,
      listBackups(storage, prefix)
        .filter((b) => b.key !== key)
        .slice(KEEP_BACKUPS - 1)
        .map((b) => b.key),
    );
    return key;
  } catch {
    return undefined;
  }
}
