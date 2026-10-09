import { dirVec, key } from '../geometry';
import type { Dir, Vec3 } from '../core/types';
import type { PlacedGroup, PlacedPort, SiteWarning } from './buildTypes';
import type { SiteOccupancy } from './occupancy';
import type { Endpoint, SiteState } from './types';

/** Boundary ports: where on the site's edges they go. */

/**
 * Extra distance, in blocks, a port pays to sit on an edge other than its own (west for inputs, east for
 * outputs), so it goes there only when that saves a real stretch of pipe.
 */
const PORT_SIDE_COST = 6;

/**
 * The edges a port without a position tries, best first, as the direction pointing into the site from
 * each ("east" is the west edge): nearest the groups it serves (centre `cx`, `cz`), leaning to its own
 * edge (west for inputs, east for outputs) by `PORT_SIDE_COST`.
 */
export function portEdgeOrder(dir: 'in' | 'out', cx: number, cz: number, w: number, d: number): Dir[] {
  const main: Dir = dir === 'in' ? 'east' : 'west';
  const away: Partial<Record<Dir, number>> = { east: cx, west: w - 1 - cx, south: cz, north: d - 1 - cz };
  return (['east', 'west', 'south', 'north'] as Dir[])
    .map((inward) => ({ inward, cost: away[inward]! + (inward === main ? 0 : PORT_SIDE_COST) }))
    .sort((a, b) => a.cost - b.cost)
    .map((e) => e.inward);
}

/** Whether a link end is the port `port`. */
export function endpointIs(e: Endpoint, port: string): boolean {
  return 'port' in e && e.port === port;
}

/**
 * Puts every port on the site: at its fixed position, or on the free edge cell nearest the groups it
 * serves. Taken cells join `occupancy` (solid for the router). A port that finds no room is left out
 * with a warning.
 */
export function placeSitePorts(
  site: SiteState,
  groups: readonly PlacedGroup[],
  occupancy: SiteOccupancy,
): { ports: PlacedPort[]; warnings: SiteWarning[] } {
  const [w, d] = site.size;
  const { occ, solids } = occupancy;
  const groupIndex = new Map(site.groups.map((g, i) => [g.id, i]));
  const linkedCentres = new Map<string, [number, number][]>();
  for (const l of site.links)
    for (const [end, other] of [
      [l.from, l.to],
      [l.to, l.from],
    ] as const) {
      if (!('port' in end) || !('group' in other)) continue;
      const pg = groups[groupIndex.get(other.group) ?? -1];
      if (!pg) continue;
      const list = linkedCentres.get(end.port) ?? [];
      list.push([(pg.min[0] + pg.max[0] - 1) / 2, (pg.min[2] + pg.max[2] - 1) / 2]);
      linkedCentres.set(end.port, list);
    }
  const taken = new Set<string>();
  const ports: PlacedPort[] = [];
  const warnings: SiteWarning[] = [];
  const blocked = (x: number, z: number) => occ.has(key([x, 0, z])) || taken.has(`${x},${z}`);
  /**
   * A free cell on one edge, nearest `along` (the linked groups' centre along that edge). One block stays
   * free on either side along the edge so neighbouring ports keep their pipes apart, and the cell inside
   * the edge stays free for the pipe.
   */
  const onEdge = (inward: Dir, along: number): Vec3 | null => {
    const [ix, , iz] = dirVec(inward);
    const alongX = ix === 0;
    const n = alongX ? w : d;
    const fixed = ix > 0 || iz > 0 ? 0 : (alongX ? d : w) - 1;
    const at = (t: number): [number, number] => (alongX ? [t, fixed] : [fixed, t]);
    // North and south edges leave the corners to the west and east edges.
    const lo = alongX ? 1 : 0;
    const hi = alongX ? n - 2 : n - 1;
    const t0 = Math.min(hi, Math.max(lo, Math.round(along)));
    for (let k = 0; k < 2 * n; k++) {
      const t = t0 + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
      if (t < lo || t > hi) continue;
      const [x, z] = at(t);
      const [ax, az] = at(t - 1);
      const [bx, bz] = at(t + 1);
      if (blocked(x, z) || blocked(x + ix, z + iz) || taken.has(`${ax},${az}`) || taken.has(`${bx},${bz}`))
        continue;
      return [x, 0, z];
    }
    return null;
  };
  for (const p of site.ports) {
    let cell: Vec3 | null = null;
    let faces: Dir[] = [];
    if (p.pos) {
      cell = [p.pos[0], 0, p.pos[1]];
      if (blocked(p.pos[0], p.pos[1])) {
        warnings.push({ type: 'noport', port: p.id });
        continue;
      }
      faces = ['north', 'east', 'south', 'west', 'up'];
    } else {
      const cs = linkedCentres.get(p.id);
      const cx = cs?.length ? cs.reduce((s, c) => s + c[0], 0) / cs.length : (w - 1) / 2;
      const cz = cs?.length ? cs.reduce((s, c) => s + c[1], 0) / cs.length : (d - 1) / 2;
      // The edge nearest the groups the port serves, so its pipe stays short. Inputs lean to the west
      // edge and outputs to the east (the chain flows that way); a full edge passes to the next nearest.
      for (const inward of portEdgeOrder(p.dir, cx, cz, w, d)) {
        cell = onEdge(inward, inward === 'east' || inward === 'west' ? cz : cx);
        if (cell) {
          const across: Dir[] =
            inward === 'east' || inward === 'west' ? ['north', 'south'] : ['east', 'west'];
          faces = [inward, 'up', ...across];
          break;
        }
      }
    }
    if (!cell) {
      warnings.push({ type: 'noport', port: p.id });
      continue;
    }
    taken.add(`${cell[0]},${cell[2]}`);
    solids.push(cell);
    occ.set(key(cell), { gi: -1, air: false });
    ports.push({ port: p, cell, faces });
  }
  return { ports, warnings };
}
