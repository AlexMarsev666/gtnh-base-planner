export type CoilRow = { id: string; blockId: string; level: string; heat: number; name: string };
export const GENERIC_COILS: string[];
export function coilLevels(src: string): { name: string; heat: number }[];
export function coilMetas(body: string): { meta: number; level: string }[];
export function coilTable(rules: unknown): CoilRow[];
export function isCoilElement(expr: string, ctx: { bodyOf(name: string): string | null }): boolean;
export function usesCoils(chain: { name: string; body: string }[]): boolean;
