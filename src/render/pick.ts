/** A raycast hit reduced to what the selection rule needs. */
export interface PickHit {
  /** Drawn faded (a dim pipe or an X-ray casing): it must not steal clicks from solid things behind it. */
  translucent: boolean;
}

/**
 * The hit a click or drag acts on. `hits` are sorted nearest first. The nearest opaque hit wins; only when
 * there is none does the nearest translucent hit count, so a faded pipe over empty space stays clickable.
 */
export function choosePick<T extends PickHit>(hits: readonly T[]): T | undefined {
  return hits.find((h) => !h.translucent) ?? hits[0];
}
