import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/types';
import type { SiteBuild } from './buildTypes';
import { routingMetrics } from './routingMetrics';

function build(paths: Vec3[][], terminals: { cell: Vec3; hatch?: unknown }[] = [], attach: string[] = []) {
  return {
    nets: [{ terminals, route: { paths, attach } }],
    warnings: [],
    stats: {
      pipeBlocks: new Set(paths.flat().map((p) => p.join(','))).size,
      cableBlocks: 0,
      bends: 0,
      terminals: terminals.length,
      connected: terminals.length,
    },
  } as unknown as SiteBuild;
}

describe('physical routing metrics, separating hatch approaches from surface trunks', () => {
  it('deduplicates shared paths within a net and counts underground levels separately', () => {
    const result = routingMetrics(
      build([
        [
          [0, -1, 0],
          [1, -1, 0],
          [1, -2, 0],
        ],
        [
          [1, -1, 0],
          [1, -2, 0],
          [1, -3, 0],
        ],
      ]),
    );
    expect(result.length).toBe(4);
    expect(result.levels).toEqual({ '-1': 2, '-2': 1, '-3': 1 });
    expect(result.surface).toBe(0);
    expect(result.trunkTotal).toBe(4);
  });

  it('includes a vertical hatch riser and stops the approach at the first junction', () => {
    const result = routingMetrics(
      build(
        [
          [
            [0, 2, 0],
            [0, 1, 0],
            [0, 0, 0],
            [1, 0, 0],
          ],
          [
            [0, 0, 0],
            [0, -1, 0],
            [0, -2, 0],
          ],
        ],
        [{ cell: [0, 3, 0], hatch: {} }],
        ['down'],
      ),
    );
    expect(result.surfaceApproaches).toBe(2);
    expect(result.surfaceTrunks).toBe(2);
    expect(result.surface).toBe(4);
    expect(result.surfaceTrunkShare).toBe(0.5);
  });

  it('limits a horizontal hatch approach to three blocks; ports count as trunks', () => {
    const path: Vec3[] = Array.from({ length: 7 }, (_, x) => [x + 1, 0, 0]);
    const hatch = routingMetrics(build([path], [{ cell: [0, 0, 0], hatch: {} }], ['east']));
    const port = routingMetrics(build([path], [{ cell: [0, 0, 0] }], ['east']));
    expect(hatch.surfaceApproaches).toBe(3);
    expect(hatch.surfaceTrunks).toBe(4);
    expect(port.surfaceApproaches).toBe(0);
    expect(port.surfaceTrunks).toBe(7);
    expect(hatch.surface).toBe(hatch.surfaceApproaches + hatch.surfaceTrunks);
  });
});
