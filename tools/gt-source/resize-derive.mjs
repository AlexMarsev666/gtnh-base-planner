/**
 * `MultiblockDef.resize` of a variable-size machine from the forms the game dump holds.
 *
 * The extractor builds every controller at trigger stack sizes 1..16 and keeps one form per distinct set of cells, so
 * a machine GT builds in several sizes comes with all of them. The smallest form is the stored def; the others say
 * which slab repeats. Nothing is listed per machine:
 *
 *   - the forms differ from the smallest only along one axis (a machine that grows on two, or whose forms are tiers
 *     of different shapes, has no `resize`: a rule describes one repeating slab);
 *   - the slab is found by trying every `[from, to)` of the width the first step grew by, and the one that
 *     `sizedDef` (`src/model/resize.ts`, the oracle) expands to every dumped form, cell for cell (blocks and hatch
 *     kinds, `~`, `-` and gaps; regions are numbered per copy by `sizedDef` and not compared), is the rule. When no
 *     slab reproduces every form there is no rule;
 *   - `min` is the smallest form; `max` is what the tooltip's `beginVariableStructureBlock` allows along the axis
 *     (the sweep stops at 16, so a longer machine is only known from the tooltip), snapped down to whole slabs and
 *     never below the largest dumped form; `default` is `min`.
 *
 * `sizedDef` is TypeScript; Node 24 strips the types when it is imported by its file name.
 */
import { sizedDef } from '../../src/model/resize.ts';

const AXES = ['x', 'y', 'z'];

/** A cell for comparing two forms: `{ block, hatches }`, the block being the reserved character for those. */
function cellOf(def, x, y, z) {
  const ch = [...(def.layers[y]?.[z] ?? '')][x] ?? ' ';
  if (ch === ' ' || ch === '-' || ch === '~') return { block: ch, hatches: '' };
  const e = def.legend[ch];
  return { block: e.blockId, hatches: [...(e.hatches ?? [])].sort().join(',') };
}

/** `registry@meta` split at the meta. */
const registryOf = (block) => block.slice(0, block.lastIndexOf('@'));

/**
 * Whether `form` (a dumped form) is `def` (its expansion), cell for cell (regions and sides ignored). The dump builds
 * a tiered block in the tier its trigger stack size names (the glass of the Assembly Lines), so a block that
 * is another meta of the same registry block in `form` everywhere it occurs in `def` counts as the same.
 */
function sameCells(def, form) {
  if (def.size.join() !== form.size.join() || def.controller.pos.join() !== form.controller.pos.join())
    return false;
  const [sx, sy, sz] = def.size;
  const swap = new Map(); // block of def -> block of form
  const kept = new Set(); // blocks of def that stay what they are somewhere
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const a = cellOf(def, x, y, z);
        const b = cellOf(form, x, y, z);
        if (a.hatches !== b.hatches) return false;
        if (a.block === b.block) kept.add(a.block);
        else if (
          a.block.includes('@') &&
          b.block.includes('@') &&
          registryOf(a.block) === registryOf(b.block)
        ) {
          if (swap.get(a.block) !== undefined && swap.get(a.block) !== b.block) return false;
          swap.set(a.block, b.block);
        } else return false;
      }
  return [...swap.keys()].every((k) => !kept.has(k));
}

/**
 * Largest size along axis index `a` the tooltip allows, in the dump's frame, or null. The tooltip does not count
 * everything the box does (the controller's column), so its size is shifted by what the smallest form is above its
 * minimum. Width and depth are in no reliable order: the first of the horizontal pair that varies and starts at or
 * below `min`.
 */
function tooltipMax(size, a, min) {
  if (!size) return null;
  const dims = (a === 1 ? [1] : a === 0 ? [0, 2] : [2, 0]).filter(
    (i) => size.max[i] > size.min[i] && size.min[i] <= min,
  );
  if (!dims.length) return null;
  const d = dims.reduce((best, i) => (min - size.min[i] < min - size.min[best] ? i : best));
  return size.max[d] + (min - size.min[d]);
}

/**
 * The rule that grows `forms[0]` (defs of the dumped forms, smallest first) into the others, as
 * `{ rule, note? }`, or `{ why }` when there is none. `size` is `structureSize` of the tooltip (or null).
 */
export function deriveResize(forms, size = null) {
  if (forms.length < 2) return { why: 'one dumped form' };
  const [base] = forms;
  const grown = [0, 1, 2].filter((i) => base.size[i] !== forms[1].size[i]);
  if (grown.length !== 1) return { why: `the second form differs on ${grown.length} axes` };
  const a = grown[0];
  const t = forms[1].size[a] - base.size[a];
  if (t <= 0) return { why: 'the second form is not larger' };
  const cap = tooltipMax(size, a, base.size[a]);
  // The sweep clamps its last form to the tooltip's maximum: when that is no whole number of slabs, it is left out.
  let notes = [];
  let used = forms;
  const last = forms[forms.length - 1];
  if (forms.length > 2 && (last.size[a] - base.size[a]) % t !== 0 && cap !== null && last.size[a] <= cap) {
    used = forms.slice(0, -1);
    notes = [
      `the form of size ${last.size[a]} is the sweep clamped to the tooltip's maximum and is left out`,
    ];
  }
  for (const f of used) {
    const other = [0, 1, 2].filter((i) => i !== a && f.size[i] !== base.size[i]);
    if (other.length) return { why: `a form also differs along ${AXES[other[0]]}` };
    if (f.size[a] < base.size[a] || (f.size[a] - base.size[a]) % t !== 0)
      return { why: `a form of size ${f.size[a]} is not a whole number of ${t}-wide slabs` };
  }
  const top = Math.max(...used.map((f) => f.size[a]));
  const label = a === 1 ? 'height' : 'length';
  const ctrl = base.controller.pos[a];
  for (let from = 0; from + t <= base.size[a]; from++) {
    if (ctrl >= from && ctrl < from + t) continue;
    const rule = {
      axis: AXES[a],
      from,
      to: from + t,
      min: base.size[a],
      max: top,
      default: base.size[a],
      label,
    };
    const probe = { ...base, resize: rule };
    if (used.every((f) => f === base || sameCells(sizedDef(probe, f.size[a]), f))) {
      const max = cap === null || cap < top ? top : base.size[a] + Math.floor((cap - base.size[a]) / t) * t;
      if (cap === null) notes.push(`no tooltip maximum, largest dumped form (${top}) used`);
      return { rule: { ...rule, max }, ...(notes.length ? { note: notes.join('; ') } : {}) };
    }
  }
  return { why: `no ${t}-wide slab along ${AXES[a]} reproduces all ${used.length} forms` };
}

/**
 * `def` with `rule`, its legend characters made fit for expanding: `sizedDef` gives the cells of a region some
 * `requiredHatches` entry names a numbered region per copy (also the one they keep in the first copy), so such a
 * character that holds cells inside and outside the slab gets a new key for the cells inside. Other regions (the
 * generated entries' `dot<N>` zones) keep their name in every copy and need nothing. `spare` are the characters
 * to take from.
 */
export function withResize(def, rule, spare) {
  const a = AXES.indexOf(rule.axis);
  const counted = new Set(Object.values(def.requiredHatches ?? {}).flatMap((r) => r?.regions ?? []));
  const inside = new Set();
  const outside = new Set();
  def.layers.forEach((layer, y) =>
    layer.forEach((row, z) =>
      [...row].forEach((ch, x) => {
        if (!counted.has(def.legend[ch]?.region ?? '')) return;
        const p = [x, y, z][a];
        (p >= rule.from && p < rule.to ? inside : outside).add(ch);
      }),
    ),
  );
  const legend = { ...def.legend };
  const swap = new Map();
  const free = spare.filter((c) => !(c in legend) && !'~- '.includes(c));
  for (const ch of inside)
    if (outside.has(ch)) {
      const c = free.shift();
      if (c === undefined) throw new Error('no spare legend character');
      legend[c] = { ...legend[ch] };
      swap.set(ch, c);
    }
  const layers = swap.size
    ? def.layers.map((layer, y) =>
        layer.map((row, z) =>
          [...row]
            .map((ch, x) => {
              const p = [x, y, z][a];
              return swap.has(ch) && p >= rule.from && p < rule.to ? swap.get(ch) : ch;
            })
            .join(''),
        ),
      )
    : def.layers;
  const out = { ...def, layers, legend };
  // `resize` sits right after `controller` in the file.
  const keys = Object.keys(out).filter((k) => k !== 'resize');
  const at = keys.indexOf('controller') + 1;
  return Object.fromEntries(
    [...keys.slice(0, at), 'resize', ...keys.slice(at)].map((k) => [k, k === 'resize' ? rule : out[k]]),
  );
}
