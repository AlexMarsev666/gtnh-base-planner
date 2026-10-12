export const GENERIC_GLASS: string[];
export function kindOfList(expr: string): 'energy' | 'dynamo' | null;
export function glassLimits(chain: { name: string; body: string }[]): { kinds: string[]; other: string[] };
