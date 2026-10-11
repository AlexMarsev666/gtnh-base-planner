import { describe, expect, it } from 'vitest';
import type { Rotation } from '../core/types';
import { groupPoint } from './group';
import { coversFootprint, reachOf, turnedReach } from './terminals';

describe('terminals', () => {
  it('boxes cells by their block edges, and has none for no cells', () => {
    expect(
      reachOf([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([1, 4, 2, 5]);
    expect(reachOf([])).toBeNull();
  });

  it('turns a box exactly as groupPoint turns its cells', () => {
    const size: [number, number] = [7, 9];
    for (const r of [0, 1, 2, 3] as Rotation[])
      for (const cells of [
        [[5, 2]],
        [
          [0, 0],
          [3, 6],
        ],
        [[6, 8]],
      ] as [number, number][][]) {
        const turned = cells.map(([x, z]) => {
          const p = groupPoint([x, 0, z], [size[0], 1, size[1]], r, [0, 0]);
          return [p[0], p[2]] as [number, number];
        });
        expect(turnedReach(reachOf(cells)!, size, r)).toEqual(reachOf(turned));
      }
  });

  it('knows a box that spans the whole footprint', () => {
    expect(coversFootprint([0, 5, 0, 3], [5, 3])).toBe(true);
    expect(coversFootprint([0, 1, 0, 3], [5, 3])).toBe(false);
  });
});
