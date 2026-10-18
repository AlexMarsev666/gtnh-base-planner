// Store-free so the build worker can use it.

const warned = new Set<string>();

/** `console.warn` once per distinct message (stubbed modules would otherwise spam the console). */
export function warnOnce(context: string, err: unknown): void {
  const msg = `${context}: ${err instanceof Error ? err.message : String(err)}`;
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}
