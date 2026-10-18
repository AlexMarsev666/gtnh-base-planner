import type { Dir } from '../core/types';
import type { HatchPlacement } from '../plan/types';
import type { RouteNet } from './routeNet';

/** Which side of each hatch its pipe or cable attaches to. */

/** Hatch sides tried for a pipe after the placed one: sides, then top, then bottom. */
export const ATTACH_ORDER: readonly Dir[] = ['north', 'east', 'south', 'west', 'up', 'down'];

/**
 * The hatches with each routed hatch turned to the side its pipe attaches to (see `RouteNet.attachments`).
 * Hatches without a pipe keep their placed face. Returns `hatches` itself when nothing changes.
 */
export function withPipeFaces(hatches: HatchPlacement[], nets: RouteNet[] | null): HatchPlacement[] {
  const faces = new Map<string, Dir>();
  for (const n of nets ?? [])
    for (const a of n.attachments ?? []) faces.set(`${n.kind}|${a.cell.join()}`, a.face);
  if (faces.size === 0) return hatches;
  let changed = false;
  const out = hatches.map((h) => {
    const face = faces.get(`${h.kind}|${h.cell.join()}`);
    if (!face || face === h.face) return h;
    changed = true;
    const { fromBelow: _, ...turned } = h;
    return { ...turned, face };
  });
  return changed ? out : hatches;
}
