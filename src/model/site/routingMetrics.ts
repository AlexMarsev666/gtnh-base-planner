import type { SiteBuild } from './buildTypes';

/** Per-net physical cells. A hatch approach ends at the first junction, underground cell,
 * or after three horizontal steps; vertical risers are included. Ports are trunks. */
export function routingMetrics(built: SiteBuild) {
  let bends = 0;
  let approaches = 0;
  let surface = 0;
  let trunkSurface = 0;
  let trunkTotal = 0;
  const levels: Record<number, number> = {};
  for (const net of built.nets) {
    for (const path of net.route?.paths ?? [])
      for (let i = 2; i < path.length; i++)
        if (path[i].some((v, axis) => v - path[i - 1][axis] !== path[i - 1][axis] - path[i - 2][axis]))
          bends++;
    const cells = new Map((net.route?.paths ?? []).flat().map((p) => [p.join(','), p]));
    const leads = new Set<string>();
    const neighbours = (p: number[]): number[][] =>
      [
        [p[0] - 1, p[1], p[2]],
        [p[0] + 1, p[1], p[2]],
        [p[0], p[1] - 1, p[2]],
        [p[0], p[1] + 1, p[2]],
        [p[0], p[1], p[2] - 1],
        [p[0], p[1], p[2] + 1],
      ].filter((q) => cells.has(q.join(',')));
    const offsets: Record<string, number[]> = {
      north: [0, 0, -1],
      south: [0, 0, 1],
      east: [1, 0, 0],
      west: [-1, 0, 0],
      up: [0, 1, 0],
      down: [0, -1, 0],
    };
    for (const [ti, terminal] of net.terminals.entries()) {
      if (!terminal.hatch) continue;
      const offset = offsets[net.route?.attach[ti] ?? ''];
      if (!offset) continue;
      const attached = [terminal.cell.map((v, axis) => v + offset[axis])];
      if (!cells.has(attached[0].join(','))) continue;
      let previous: readonly number[] = terminal.cell;
      let current: number[] | undefined = attached[0];
      let horizontal = Number(previous[1] === current[1]);
      const seen = new Set();
      while (current && current[1] >= 0 && horizontal <= 3 && !seen.has(current.join(','))) {
        const key = current.join(',');
        seen.add(key);
        const next: number[][] = neighbours(current).filter((q) => q.join(',') !== previous.join(','));
        if (next.length > 1) break;
        leads.add(key);
        const following = next[0];
        if (following && following[1] === current[1]) horizontal++;
        previous = current;
        current = following;
      }
    }
    for (const [key, p] of cells) {
      levels[p[1]] = (levels[p[1]] ?? 0) + 1;
      if (p[1] >= 0) {
        surface++;
        if (leads.has(key)) approaches++;
        else trunkSurface++;
      }
      if (!leads.has(key)) trunkTotal++;
    }
  }
  return {
    length: built.stats.pipeBlocks + built.stats.cableBlocks,
    bends,
    terminals: built.stats.terminals,
    connected: built.stats.connected,
    warnings: built.warnings,
    surface,
    surfaceApproaches: approaches,
    surfaceTrunks: trunkSurface,
    trunkTotal,
    surfaceTrunkShare: trunkTotal ? trunkSurface / trunkTotal : 0,
    surfaceTrunksShareOfSurface: surface ? trunkSurface / surface : 0,
    levels,
  };
}
