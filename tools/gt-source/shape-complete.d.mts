type Chain = { name: string; body: string; file?: string }[];
export type Cell = {
  d: [number, number, number];
  blockId: string;
  hatches: string[];
  region?: string;
};
type Size = { min: [number, number, number]; max: [number, number, number] };

export function structureSize(chain: Chain): Size | null;
export function shortAxes(size: Size, dump: number[]): string[];
export function controllerPiece(chain: Chain): string[][] | null;
export function completeFromShape(
  cells: Map<string, Cell>,
  ctrl: number[],
  grid: string[][],
): {
  added: Cell[];
  letters: Map<string, Cell>;
  at: (a: number, layer: number, z: number) => [number, number, number];
};
