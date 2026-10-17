export class TruncatedDump extends Error {}
export function convertStructure(
  doc: unknown,
  ids: { id: string; name: string },
  tooltip?: unknown,
): {
  def: {
    size: number[];
    layers: string[][];
    legend: Record<string, { blockId: string; hatches?: string[] }>;
  };
  shape: { transposed: boolean; shape: string[][]; el: Record<string, unknown> } | null;
  sizeWarning?: string;
};
