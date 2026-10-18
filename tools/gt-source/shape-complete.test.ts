import { describe, expect, it } from 'vitest';
import {
  completeFromShape,
  controllerPiece,
  shortAxes,
  structureSize,
  type Cell,
} from './shape-complete.mjs';

const chainOf = (body: string) => [{ name: 'X', body }];

describe('structureSize', () => {
  it('reads a fixed size and a variable one (with int constants)', () => {
    expect(structureSize(chainOf('.beginStructureBlock(15, 55, 15, true)'))).toEqual({
      min: [15, 55, 15],
      max: [15, 55, 15],
    });
    expect(
      structureSize(
        chainOf('static final int MAX_H = 9; .beginVariableStructureBlock(3, 3, 4, MAX_H, 5, 7, false)'),
      ),
    ).toEqual({ min: [3, 4, 5], max: [3, 9, 7] });
  });

  it('is null without a literal size', () => {
    expect(structureSize(chainOf('.beginStructureBlock(w, 5, 5, true)'))).toBeNull();
    expect(structureSize(chainOf('.addInfo("x")'))).toBeNull();
  });
});

describe('shortAxes', () => {
  const fixed = {
    min: [15, 55, 15] as [number, number, number],
    max: [15, 55, 15] as [number, number, number],
  };
  it('flags a dump too low in a fixed height', () => {
    expect(shortAxes(fixed, [15, 47, 15])).toEqual(['y']);
    expect(shortAxes(fixed, [15, 55, 15])).toEqual([]);
  });

  it('accepts width and depth either way round', () => {
    const size = { min: [3, 3, 7] as [number, number, number], max: [3, 3, 7] as [number, number, number] };
    expect(shortAxes(size, [7, 3, 3])).toEqual([]);
    expect(shortAxes(size, [3, 3, 5])).toEqual(['xz']);
  });

  it('ignores dimensions the tooltip leaves variable', () => {
    const size = { min: [3, 3, 3] as [number, number, number], max: [3, 12, 3] as [number, number, number] };
    expect(shortAxes(size, [3, 3, 3])).toEqual([]);
  });
});

describe('completeFromShape', () => {
  // Controller `~` in layer 1 (of 4 from the top); the dump lacks the top layer.
  const grid = [['AB'], ['A~'], ['AB'], ['AA']];
  const cell = (d: number[], blockId: string): Cell => ({ d: d as Cell['d'], blockId, hatches: [] });
  // First axis runs west: letter `A` (a=0) is at x=+1 from the controller, `B` at x=0.
  const cells = new Map<string, Cell>([
    ['1,-1,0', cell([1, -1, 0], 'a')],
    ['0,-1,0', cell([0, -1, 0], 'b')],
    ['1,0,0', cell([1, 0, 0], 'a')],
    ['0,0,0', cell([0, 0, 0], 'b')],
  ]);

  it("adds the cells above the dump from the letter's own cell, mirrored in x", () => {
    const { added } = completeFromShape(cells, [0, 0, 0], grid);
    expect(added.map((c) => `${c.d.join(',')}:${c.blockId}`).sort()).toEqual([
      '0,-2,0:a',
      '0,1,0:b',
      '1,-2,0:a',
      '1,1,0:a',
    ]);
  });

  it('fails for a letter the dump never placed', () => {
    expect(() => completeFromShape(cells, [0, 0, 0], [['AZ'], ['A~'], ['AB'], ['AA']])).toThrow(/'Z' is not/);
  });

  it('fails where the shape has a cell the dump lacks inside its box', () => {
    const sparse = new Map(cells);
    sparse.delete('1,0,0');
    expect(() => completeFromShape(sparse, [0, 0, 0], grid)).toThrow(/dump lacks/);
  });
});

describe('controllerPiece', () => {
  it('finds the piece with the controller', () => {
    const body = `.addShape("main", transpose(new String[][] { { "A~A" }, { "AAA" } }))`;
    expect(controllerPiece(chainOf(body))).toEqual([['A~A'], ['AAA']]);
  });
});
