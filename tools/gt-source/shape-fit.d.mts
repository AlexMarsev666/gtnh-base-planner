export function shapesOf(chain: { name: string; body: string }[]): { name: string; grid: string[][] }[];
export function plainCells(def: unknown, chars: string[], ctx: unknown): Map<string, Set<string>>;
export function placedBlocks(expr: string, ctx: unknown, blocks: unknown): unknown[];
