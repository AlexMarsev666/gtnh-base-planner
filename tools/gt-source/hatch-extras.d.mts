type Extras = {
  dataAccess: {
    chars: string[];
    max: number | null;
    split: { from: string; to: string; cells: string[] }[];
  } | null;
  allowFaces: Record<string, Record<string, string[]>>;
  glassTierLimits: { chars: string[]; kinds: string[] } | null;
  coils?: { chars: string[] } | null;
};

export function withExtras<T extends object>(def: T, extras: Extras): T;
export function patchDef(text: string, def: object, extras: Extras): string;
