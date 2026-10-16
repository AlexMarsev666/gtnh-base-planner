import { PLACEHOLDER_DEF } from '../../data/generic';
import { controllerFacing, key, step, unitCells } from '../geometry';

import type { Vec3 } from '../core/types';
import type { PlacedGroup, SiteWarning } from './buildTypes';
import type { SiteState } from './types';

/** Which cells the placed groups take, and where they collide with each other or leave the site. */
export interface SiteOccupancy {
  /** Cell key -> index of the group there (-1 for a port), and whether that group needs the cell as air. */
  occ: Map<string, { gi: number; air: boolean }>;
  /** Cells two groups both need (or a group needs outside the site): drawn as conflicts. */
  conflictCells: Set<string>;
  /**
   * Cells of different groups that are the same block on both sides (a shared wall), no conflict: cell key ->
   * the indices of the groups that have it, ascending (the first is the owner the scene draws it for).
   */
  sharedCells: Map<string, number[]>;
  /** Blocks the shared cells save: every group beyond the first on a shared cell would have built its own. */
  sharedBlocks: number;
  /** Every structure cell, for the router. */
  solids: Vec3[];
  /** Cells no pipe may take, e.g. in front of each controller. */
  keepFree: Vec3[];
  warnings: SiteWarning[];
}

const PLACEHOLDER_BLOCK = PLACEHOLDER_DEF.legend.c.blockId;

/** What one group needs at a cell. A hatch is never the same block as that of another group. */
interface Need {
  gi: number;
  air: boolean;
  controller: boolean;
  hatch: boolean;
  blockId?: string;
}

/** Whether two different groups may both have a cell: both air, or the same casing block on both sides. */
function compatible(a: Need, b: Need): boolean {
  if (a.air && b.air) return true;
  if (a.air || b.air || a.controller || b.controller || a.hatch || b.hatch) return false;
  // The placeholder stands for a machine not transcribed yet: it shares no wall.
  return a.blockId !== undefined && a.blockId !== PLACEHOLDER_BLOCK && a.blockId === b.blockId;
}

export function analyzeOccupancy(site: SiteState, groups: readonly PlacedGroup[]): SiteOccupancy {
  const [w, d] = site.size;
  const occ = new Map<string, { gi: number; air: boolean }>();
  const needs = new Map<string, Need[]>();
  const conflictCells = new Set<string>();
  const overlapPairs = new Set<string>();
  const outside = new Set<number>();
  const solids: Vec3[] = [];
  const keepFree: Vec3[] = [];
  const pair = (a: number, b: number) => {
    const ia = site.groups[Math.min(a, b)].id;
    const ib = site.groups[Math.max(a, b)].id;
    overlapPairs.add(`${ia}\u0000${ib}`);
  };
  for (const pg of groups) {
    if (!pg.def) continue;
    const hatchCells = new Set(pg.hatches.map((h) => key(h.cell)));
    // What the group needs at each cell over all its units (non-air wins), so the result does not depend on
    // which unit comes first.
    const mine = new Map<string, { pos: Vec3; need: Need }>();
    for (const u of pg.units) {
      for (const c of unitCells(pg.def, u)) {
        const k = key(c.pos);
        const air = c.role === 'air';
        if (c.pos[0] < 0 || c.pos[2] < 0 || c.pos[0] >= w || c.pos[2] >= d) {
          outside.add(pg.index);
          if (!air) conflictCells.add(k);
        }
        const cur = mine.get(k)?.need;
        if (!cur) {
          const need: Need = {
            gi: pg.index,
            air,
            controller: c.role === 'controller',
            hatch: hatchCells.has(k),
            blockId: c.blockId,
          };
          mine.set(k, { pos: c.pos, need });
        } else if (!air) {
          cur.controller ||= c.role === 'controller';
          cur.blockId = cur.air || cur.blockId === c.blockId ? c.blockId : undefined;
          cur.air = false;
        }
      }
    }
    for (const [k, { pos, need }] of mine) {
      // A cell another group already has as the same block is one block, not two (see `sharedCells`).
      const list = needs.get(k) ?? [];
      if (!list.some((n) => !n.air && !need.air && compatible(n, need))) solids.push(pos);
      if (!occ.has(k)) occ.set(k, { gi: pg.index, air: need.air });
      for (const other of list)
        if (!compatible(other, need)) {
          conflictCells.add(k);
          pair(other.gi, pg.index);
        }
      list.push(need);
      needs.set(k, list);
    }
    for (const u of pg.units) {
      keepFree.push(
        step(
          unitCells(pg.def, u).find((c) => c.role === 'controller')?.pos ?? u.origin,
          controllerFacing(pg.def, u),
        ),
      );
    }
  }
  const sharedCells = new Map<string, number[]>();
  let sharedBlocks = 0;
  for (const [k, list] of needs) {
    if (conflictCells.has(k)) continue;
    const gis = list
      .filter((n) => !n.air)
      .map((n) => n.gi)
      .sort((a, b) => a - b);
    if (gis.length < 2) continue;
    sharedCells.set(k, gis);
    sharedBlocks += gis.length - 1;
  }
  const warnings: SiteWarning[] = [];
  for (const gi of outside) warnings.push({ type: 'outside', group: site.groups[gi].id });
  for (const p of overlapPairs) {
    const [a, b] = p.split('\u0000');
    warnings.push({ type: 'overlap', groups: [a, b] });
  }
  return { occ, conflictCells, sharedCells, sharedBlocks, solids, keepFree, warnings };
}
