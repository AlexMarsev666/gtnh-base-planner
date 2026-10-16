import type { HatchKind } from '../multiblock/types';
import { inZone } from './zones';
import type { CapacityEntry, Site } from './types';

/** Whether a unit's cells can hold all the hatches it wants (checked before anything is placed). */

/** One hatch a unit wants. */
export interface Wanted {
  kind: HatchKind;
  /** Only cells of this zone. */
  zone?: string;
  /** Its kind's `requiredHatches` min is >= 1. */
  mandatory: boolean;
}

/**
 * Per unit with more hatches wanted than cells with an open face can take: how many are wanted (leaving out
 * those no cell could ever take, which placement reports itself), how many fit (the largest set of them that
 * can each get a cell of its own that allows the kind, zone and a side, mandatory ones first), and so how
 * many to remove. A cell shared with another unit counts for each unit. Units with the same overload form
 * one entry, ordered by first unit id. An upper bound: it ignores what placement adds (one cell per hatch
 * across units, fluids that must not share). Deterministic.
 *
 * `wanted` lists each unit's hatches, mandatory ones first; `shares(kind, units)` says whether a cell of
 * that many units may take that kind. `lacking` says, per unit and kind, how many wanted hatches got no cell.
 * `floor` limits the cells a unit gives to hatches per casing minimum (see `casingRooms`): at most `rooms[i]`
 * of the cells `of(site, id)` names `i` for (a cell counts against each of its entries, as in placement).
 */
export function capacityOf(
  sites: readonly Site[],
  wanted: ReadonlyMap<number, readonly Wanted[]>,
  shares: (kind: HatchKind, units: number) => boolean,
  floor?: { rooms: readonly number[]; of: (site: Site, unitId: number) => number[] },
): { entries: CapacityEntry[]; lacking: Map<number, Map<HatchKind, number>> } {
  const lacking = new Map<number, Map<HatchKind, number>>();
  const byUnit = new Map<number, Site[]>();
  for (const s of sites) for (const id of s.unitIds) (byUnit.get(id) ?? byUnit.set(id, []).get(id)!).push(s);
  const groups = new Map<string, CapacityEntry>();
  for (const [id, all] of [...wanted].sort((a, b) => a[0] - b[0])) {
    const cells = byUnit.get(id) ?? [];
    const takes = (w: Wanted, s: Site): boolean =>
      s.kinds.has(w.kind) &&
      // A fallback site only makes up the required minimum (as in placement).
      (!s.fromBelow || w.mandatory) &&
      (s.unitIds.length === 1 || shares(w.kind, s.unitIds.length)) &&
      (w.zone === undefined || inZone(s, id, w.zone)) &&
      s.faces.some((f) => !s.blocked.get(w.kind)?.has(f.dir));
    // A hatch no cell could ever take (wrong kind or zone) is not about room: placement reports it itself.
    const list = all.filter((w) => cells.some((s) => takes(w, s)));
    if (list.length === 0) continue;
    const owner: number[] = new Array(cells.length).fill(-1);
    const group = cells.map((s) => floor?.of(s, id) ?? []);
    /** Cells given to hatches per casing minimum. */
    const given = (floor?.rooms ?? []).map(() => 0);
    const matched: boolean[] = [];
    // Augmenting paths never unmatch a hatch, so the earlier (mandatory) ones keep their cells.
    const assign = (h: number, seen: boolean[]): boolean => {
      for (let c = 0; c < cells.length; c++) {
        if (seen[c] || !takes(list[h], cells[c])) continue;
        seen[c] = true;
        const g = group[c];
        // A free cell that is counted casing needs room left under each of its minimums.
        if (owner[c] < 0 && g.some((i) => given[i] >= floor!.rooms[i])) continue;
        const free = owner[c] < 0;
        if (free || assign(owner[c], seen)) {
          if (free) for (const i of g) given[i]++;
          owner[c] = h;
          return true;
        }
      }
      return false;
    };
    for (let h = 0; h < list.length; h++) matched.push(assign(h, new Array(cells.length).fill(false)));
    const fits = matched.filter(Boolean).length;
    if (fits === list.length) continue;
    const short = new Map<HatchKind, number>();
    list.forEach((w, h) => {
      if (!matched[h]) short.set(w.kind, (short.get(w.kind) ?? 0) + 1);
    });
    lacking.set(id, short);
    const mandatory = list.some((w, h) => w.mandatory && !matched[h]);
    const gk = `${list.length}|${fits}|${mandatory}`;
    let entry = groups.get(gk);
    if (!entry) {
      entry = { needed: list.length, fits, remove: list.length - fits, unitIds: [] };
      if (mandatory) entry.mandatory = true;
      groups.set(gk, entry);
    }
    entry.unitIds.push(id);
  }
  return { entries: [...groups.values()].sort((a, b) => a.unitIds[0] - b.unitIds[0]), lacking };
}
