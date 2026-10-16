/**
 * Which share link in the address bar is the newest. Opening one is asynchronous (decoding), so a link
 * followed meanwhile must win: each open takes a number and drops its result if a later one was taken.
 */
let latest = 0;

/** Starts opening a link: any open that began earlier is now stale. */
export function beginHashLink(): number {
  return ++latest;
}

export function isLatestHashLink(id: number): boolean {
  return id === latest;
}
