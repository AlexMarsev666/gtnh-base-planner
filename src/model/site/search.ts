/** Drain the same deterministic search synchronously for model callers, or cooperatively for the UI. */
export function finishSearch<T, P>(search: Generator<P, T>): T {
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}

export interface SearchControl<P> {
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
}

export async function runSearch<T, P>(search: Generator<P, T>, control: SearchControl<P> = {}): Promise<T> {
  try {
    for (;;) {
      if (control.signal?.aborted) throw new Error('Optimization cancelled.');
      const step = search.next();
      if (step.done) return step.value;
      control.onProgress?.(step.value);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    search.return(undefined as T);
  }
}
