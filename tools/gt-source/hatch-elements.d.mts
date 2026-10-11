export function readElement(
  expr: string,
  ctx?: { ints: Map<string, number>; bodyOf: (name: string) => string | null },
): { dot: number | null; kinds: Set<string> };
export function kindsForCell(sets: Set<string>[] | undefined, dumpKinds: string[]): string[];
