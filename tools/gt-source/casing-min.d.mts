export type Linear = { c: number; vars: Record<string, number> };
export type Candidate = { field?: string; vanilla?: string; name?: string; meta: number | null };
export type Constraints = {
  minCasings: { chars: string[]; min: number; perSlab?: number }[];
  requiredAny: { kinds: string[]; min: number }[];
};

export function evalInt(
  expr: string,
  names: (name: string) => { init?: string; variable?: boolean } | null,
  call?: (name: string) => string | null,
): Linear[];

export class ClassContext {
  constructor(chain: { name: string; body: string }[]);
  chain: { name: string; body: string }[];
  intName(name: string): { init?: string; variable?: boolean } | null;
  methodReturn(name: string): string | null;
  initOf(name: string): string | null;
  eval(expr: string): Linear[];
}

export function tooltipCasings(ctx: ClassContext): { name: string; lo: number; hi: number }[];

export class BlockReader {
  constructor(registry: {
    casingsEnum: Map<string, { field: string; meta: number }>;
    blockClass: Map<string, string>;
    allSources(): Iterable<[string, string]>;
    classSrc(name: string): string | null;
  });
  elementBlocks(expr: string, ctx: ClassContext): { cands: Candidate[]; errors: string[] };
}

export function countedBlocks(
  counter: string,
  ctx: ClassContext,
  blocks: BlockReader,
): { cands: Candidate[]; errors: string[]; counting: Element[] };

export class BlockNames {
  constructor(
    registry: {
      blockInfo(field: string): { unloc: string | null; name(meta: number): string | null } | null;
    },
    fieldOfName: (name: string) => string | undefined,
    plannerNames?: Map<string, string>,
  );
  planner: Map<string, string>;
  matches(c: Candidate, id: string): boolean;
}

export function sourceClassOf(def: { source?: string }): string | null;
export function removeProperty(text: string, key: string): string;
export function patchDef(text: string, constraints: Constraints): string;
export function withConstraints<T extends object>(def: T, constraints: Constraints): T;

export type Element = { char: string | null; hatch: boolean | null; cands: Candidate[] };
export function uncountedElements(counter: string, ctx: ClassContext, blocks: BlockReader): Element[];
export function charsOf(
  def: { legend: Record<string, { blockId: string; hatches?: string[] }> },
  ids: string[],
  counting: Element[],
  uncounted: Element[],
  names: BlockNames,
): string[];
export const UNWRITTEN: Record<string, string>;
