export type Checks = {
  kinds: Record<string, { min?: number; max?: number }>;
  any: Record<string, boolean>;
  casing: { counter: string; min: string }[];
  noMaintenance: boolean;
};

export class HatchRules {
  constructor(root: string);
  checksOf(sourceClass: string): Checks;
}
