export type Side = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export type FaceLeaf = {
  char: string | null;
  dot: number | null;
  kinds: string[];
  allowed: Set<Side> | null;
};

export const DIRS: Side[];
export function toLocal(dir: Side, facing: string): Side;
export function memberTexts(expr: string): string[];
export function allowedSides(text: string): Set<Side> | null;
export function faceLeaves(rules: unknown, sourceClass: string): { leaves: FaceLeaf[]; problems: string[] };
export function facesOf(
  def: {
    id: string;
    controller?: { facing?: string };
    legend: Record<string, { hatches?: string[]; region?: string; disallowFaces?: Record<string, Side[]> }>;
  },
  leaves: FaceLeaf[],
): { allowFaces: Record<string, Record<string, Side[]>>; notes: string[] };
