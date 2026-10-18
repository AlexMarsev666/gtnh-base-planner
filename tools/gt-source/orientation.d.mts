export type Predicate = (d: string, r: string, f: string) => boolean;
export function parseLambda(expr: string): Predicate;
export function parseLimits(expr: string): Predicate;
export function variantsOf(
  pred: Predicate,
  options?: { rotation?: boolean | null; flip?: boolean | null },
): { variants: number[]; up: boolean };
export function chainOf(rules: unknown, sourceClass: string): { name: string; body: string; file: string }[];
export function orientationOf(
  rules: unknown,
  sourceClass: string,
): { variants: number[] | null; from: string | null; notes: string[]; problems: string[] };
export function patchDef(text: string, variants: number[] | null): string;
export function withVariants<T extends object>(def: T, variants: number[] | null): T;
