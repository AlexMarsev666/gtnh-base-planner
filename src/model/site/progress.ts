/** Progress and cancellation shared by the layout searches (`arrangeSite`, `optimizeSite`). */

/** Thrown when the `signal` of a search is aborted; the search returns nothing. */
export class AbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortedError();
}

/** The most progress reports per second. */
export const PROGRESS_PER_SECOND = 20;

/**
 * Wraps `report` so it is called at most `PROGRESS_PER_SECOND` times a second by `now`, and always for the
 * last step (`done >= total`). Returns undefined when nobody listens.
 */
export function throttledProgress(
  report: ((done: number, total: number) => void) | undefined,
  now: () => number,
): ((done: number, total: number) => void) | undefined {
  if (!report) return undefined;
  const gap = 1000 / PROGRESS_PER_SECOND;
  let last = -Infinity;
  return (done, total) => {
    const t = now();
    if (done < total && t - last < gap) return;
    last = t;
    report(done, total);
  };
}
