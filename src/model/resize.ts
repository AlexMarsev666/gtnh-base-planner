import type { HatchRequirement, LegendEntry, MultiblockDef, ResizeRule } from './multiblock/types';

const AXIS = { x: 0, y: 1, z: 2 } as const;
const RESERVED = new Set(['~', '-', ' ']);

/** Sizes a resizable multiblock can take (every whole number of slabs from `min` to `max`). */
export function resizeSteps(rule: ResizeRule): number[] {
  const t = rule.to - rule.from;
  const out: number[] = [];
  for (let n = rule.min; n <= rule.max; n += t) out.push(n);
  return out;
}

/** The size a plan's multiblock is built at: `size` snapped to a valid step, or the default. */
export function effectiveSize(def: MultiblockDef, size: number | undefined): number | undefined {
  const rule = def.resize;
  if (!rule) return undefined;
  const steps = resizeSteps(rule);
  const want = typeof size === 'number' && Number.isFinite(size) ? size : rule.default;
  // Nearest step; ties go to the smaller one.
  return steps.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), steps[0]);
}

const memo = new WeakMap<MultiblockDef, Map<number, MultiblockDef>>();

/**
 * `def` at total size `n` along its resize axis (snapped to a valid step). Memoised per `(def, n)`, so the
 * per-def caches in geometry, layout and walls keep working. Returns `def` itself when it has no `resize`
 * or `n` is its stored (smallest) size.
 */
export function sizedDef(def: MultiblockDef, size: number | undefined): MultiblockDef {
  const rule = def.resize;
  const n = effectiveSize(def, size);
  if (!rule || n === undefined || n === rule.min) return def;
  let byN = memo.get(def);
  if (!byN) memo.set(def, (byN = new Map()));
  let out = byN.get(n);
  if (!out)
    byN.set(
      n,
      (out = def.structureVariants?.[n] ? { ...def, ...def.structureVariants[n] } : expand(def, rule, n)),
    );
  return out;
}

/** Smallest height providing the requested output slots. Oversize requests remain invalid instead
 * of silently dropping recipe slots; the document validator reports that size against RC2 limits.
 */
export function sizeForFluidOutputs(def: MultiblockDef, count: number): number | undefined {
  const rule = def.resize;
  if (!rule || rule.axis !== 'y') return undefined;
  const slots = (d: MultiblockDef) =>
    (d.fluidOutputRegions ?? d.requiredHatches?.fluidOut?.regions)?.length ?? 0;
  const initial = slots(def);
  const stride = rule.to - rule.from;
  const added = slots(sizedDef(def, rule.min + stride)) - initial;
  return added > 0 ? rule.min + Math.max(0, Math.ceil((count - initial) / added)) * stride : rule.default;
}

function expand(def: MultiblockDef, rule: ResizeRule, n: number): MultiblockDef {
  const a = AXIS[rule.axis];
  const t = rule.to - rule.from;
  const copies = (rule.section ? 0 : 1) + (n - rule.min) / t;
  const extra = (copies - (rule.section ? 0 : 1)) * t;

  // Slab chars with a region get one fresh legend char per copy.
  const legend: Record<string, LegendEntry> = { ...def.legend };
  const used = new Set([...Object.keys(legend), ...RESERVED]);
  let next = 0x21;
  const fresh = (): string => {
    while (used.has(String.fromCodePoint(next)) || (next >= 0x7f && next <= 0xa0)) next++;
    const ch = String.fromCodePoint(next);
    used.add(ch);
    return ch;
  };
  const slabChars = new Set<string>();
  if (rule.section)
    rule.section.layers.forEach((layer) =>
      layer.forEach((row) =>
        [...row].forEach((ch) => {
          if (legend[ch]?.region !== undefined) slabChars.add(ch);
        }),
      ),
    );
  else
    forEachCell(def, (ch, p) => {
      if (p[a] >= rule.from && p[a] < rule.to && legend[ch]?.region !== undefined) slabChars.add(ch);
    });
  /** Per region-carrying slab char: its char in each copy. */
  const perCopy = new Map<string, string[]>();
  const expanded = new Map<string, string[]>();
  for (const ch of slabChars) {
    const base = legend[ch];
    const chars = Array.from({ length: copies }, (_, i) => {
      const c = i === 0 ? ch : fresh();
      legend[c] = { ...base, region: `${base.region}${i + 1}` };
      return c;
    });
    perCopy.set(ch, chars);
    const names = expanded.get(base.region!) ?? [];
    names.push(...chars.map((c) => legend[c].region!));
    expanded.set(base.region!, [...new Set(names)]);
  }

  // Source index along the axis for each target index, plus which slab copy it belongs to.
  const src = (i: number): { s: number; copy: number } => {
    if (i < rule.from) return { s: i, copy: -1 };
    if (rule.section) {
      if (i < rule.from + extra) return { s: (i - rule.from) % t, copy: Math.floor((i - rule.from) / t) };
      return { s: i - extra, copy: -1 };
    }
    if (i < rule.to + extra)
      return { s: rule.from + ((i - rule.from) % t), copy: Math.floor((i - rule.from) / t) };
    return { s: i - extra, copy: -1 };
  };
  const size: [number, number, number] = [def.size[0], def.size[1], def.size[2]];
  size[a] += extra;
  const layers: string[][] = [];
  for (let y = 0; y < size[1]; y++) {
    const layer: string[] = [];
    for (let z = 0; z < size[2]; z++) {
      let row = '';
      for (let x = 0; x < size[0]; x++) {
        const p = [x, y, z];
        const { s, copy } = src(p[a]);
        p[a] = s;
        const layers = copy >= 0 && rule.section ? rule.section.layers : def.layers;
        const ch = [...layers[p[1]][p[2]]][p[0]];
        row += copy >= 0 && perCopy.has(ch) ? perCopy.get(ch)![copy] : ch;
      }
      layer.push(row);
    }
    layers.push(layer);
  }

  const pos: [number, number, number] = [...def.controller.pos];
  if (pos[a] >= (rule.section ? rule.from : rule.to)) pos[a] += extra;

  let requiredHatches = def.requiredHatches;
  if (requiredHatches && expanded.size > 0) {
    const req: Partial<Record<string, HatchRequirement>> = {};
    for (const [k, r] of Object.entries(requiredHatches)) {
      if (!r?.regions?.some((name) => expanded.has(name))) {
        req[k] = r;
        continue;
      }
      const regions = r.regions.flatMap((name) => expanded.get(name) ?? [name]);
      const grown = regions.length - r.regions.length;
      req[k] = {
        ...r,
        regions,
        min: r.min + grown,
        ...(r.max !== undefined ? { max: r.max + grown } : {}),
      };
    }
    requiredHatches = req as MultiblockDef['requiredHatches'];
  }

  const outputRegions = def.fluidOutputRegions
    ? def.interleaveFluidOutputRegions
      ? [
          ...Array.from({ length: copies }, (_, i) =>
            def
              .fluidOutputRegions!.filter((region) => expanded.has(region))
              .map((region) => expanded.get(region)![i]),
          ).flat(),
          ...def.fluidOutputRegions.filter((region) => !expanded.has(region)),
        ]
      : def.fluidOutputRegions.flatMap((region) => expanded.get(region) ?? [region])
    : undefined;
  return {
    ...def,
    size,
    layers,
    legend,
    controller: { ...def.controller, pos },
    ...(outputRegions ? { fluidOutputRegions: outputRegions } : {}),
    ...(requiredHatches ? { requiredHatches } : {}),
  };
}

function forEachCell(def: MultiblockDef, fn: (ch: string, p: [number, number, number]) => void): void {
  def.layers.forEach((layer, y) => layer.forEach((row, z) => [...row].forEach((ch, x) => fn(ch, [x, y, z]))));
}
