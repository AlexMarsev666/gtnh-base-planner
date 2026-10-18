import { localCells } from '../geometry';
import type { MultiblockDef } from '../multiblock/types';
import type { Site } from './types';

/** Casing floors (`MultiblockDef.minCasings`): how many casing cells of a unit hatches may still replace. */

/** Per `minCasings` entry, how many cells of its chars the structure has (before hatches replace any). */
export function casingCells(def: MultiblockDef): number[] {
  const mins = def.minCasings ?? [];
  const cells = mins.map(() => 0);
  for (const c of localCells(def)) mins.forEach((m, i) => m.chars.includes(c.char) && cells[i]++);
  return cells;
}

/**
 * Per `minCasings` entry, how many of its cells a unit may give up to hatches: its cells less the minimum,
 * never below 0 (a def whose minimum exceeds its cells has no room at all).
 */
export function casingRooms(def: MultiblockDef): number[] {
  const cells = casingCells(def);
  return (def.minCasings ?? []).map((m, i) => Math.max(0, cells[i] - m.min));
}

/** Indices of the `minCasings` entries a cell with this legend char counts toward. */
export function floorsOf(def: MultiblockDef, char: string | undefined): number[] {
  const out: number[] = [];
  if (char === undefined) return out;
  (def.minCasings ?? []).forEach((m, i) => m.chars.includes(char) && out.push(i));
  return out;
}

/**
 * The casing room left per unit while hatches are placed. A hatch on a cell shared by several units takes one
 * casing from each of them, as each controller counts its own structure.
 */
export interface CasingFloor {
  /** Whether a hatch on the site still leaves every unit on it at or above each minimum. */
  allows: (site: Site) => boolean;
  /** Records a hatch on the site. */
  take: (site: Site) => void;
}

export function casingFloor(def: MultiblockDef, unitIds: readonly number[]): CasingFloor {
  const rooms = casingRooms(def);
  const left = new Map<number, number[]>(unitIds.map((id) => [id, [...rooms]]));
  const each = (site: Site, f: (room: number[], i: number) => boolean): boolean => {
    for (const id of site.unitIds) {
      const room = left.get(id);
      if (room) for (const i of floorsOf(def, site.chars.get(id))) if (!f(room, i)) return false;
    }
    return true;
  };
  return {
    allows: (site) => each(site, (room, i) => room[i] > 0),
    take: (site) => {
      each(site, (room, i) => (room[i]--, true));
    },
  };
}
