import type { MultiblockDef, ResizeRule } from '../../src/model/multiblock/types';

type Form = Pick<MultiblockDef, 'size' | 'layers' | 'legend' | 'controller'>;
type Size = { min: [number, number, number]; max: [number, number, number] };

export function deriveResize(
  forms: Form[],
  size?: Size | null,
): { rule?: ResizeRule; note?: string; why?: string };
export function withResize<T extends Form>(def: T, rule: ResizeRule, spare: string[]): T;
