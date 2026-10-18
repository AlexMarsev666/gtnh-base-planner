import { writable } from 'svelte/store';
import { t } from '../i18n/en';

/** Short, quiet messages shown above the stats line. */
export interface Notice {
  id: number;
  text: string;
  /** Notices sharing a slot replace each other (e.g. the latest layout warning only). */
  slot?: string;
  /** A link after the text (e.g. Undo); running it dismisses the notice. */
  action?: NoticeAction;
}

export interface NoticeAction {
  label: string;
  run: () => void;
}

export const notices = writable<Notice[]>([]);

let nextId = 1;

export function dismissNotice(id: number): void {
  notices.update((list) => list.filter((n) => n.id !== id));
}

/**
 * Show `text` for `ms` milliseconds (0 = until dismissed). The same text is never shown twice at once,
 * and a notice with a `slot` replaces the previous notice in that slot.
 */
export function notify(text: string, ms = 4000, slot?: string, action?: NoticeAction): void {
  const id = nextId++;
  notices.update((list) =>
    [...list.filter((n) => n.text !== text && (!slot || n.slot !== slot)), { id, text, slot, action }].slice(
      -3,
    ),
  );
  if (ms > 0) setTimeout(() => dismissNotice(id), ms);
}

/** Remove the notice in `slot`, if any (its warning no longer applies). */
export function clearSlot(slot: string): void {
  notices.update((list) => (list.some((n) => n.slot === slot) ? list.filter((n) => n.slot !== slot) : list));
}

/** Past this many characters a share link may be cut by chat apps, mail clients or QR codes. */
export const LONG_LINK_CHARS = 2000;

/** The notice after a share link was copied: a hint to send the file instead when the link is long. */
export function linkCopiedNotice(url: string): string {
  return url.length > LONG_LINK_CHARS ? t.linkCopiedLong : t.linkCopied;
}

export { warnOnce } from './warn';
