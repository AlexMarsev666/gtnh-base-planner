#!/usr/bin/env node
/**
 * Which hatches a GT multiblock's tiered glass limits, read from the controller's structure check:
 *
 *   for (MTEHatchEnergy mEnergyHatch : this.mEnergyHatches) {
 *       if (this.glassTier < mEnergyHatch.getTierForStructure()) errors.add(StructureErrors.glassTierNotEnough(...));
 *   }
 *
 * is "no energy hatch may be above the glass's tier": the multiblock's `glassTierLimits` (see
 * `MultiblockDef.glassTierLimits`) names those kinds and the legend keys of the glass. `glassTier` is the field
 * `chainAllGlasses(-1, (te, t) -> te.glassTier = t, te -> te.glassTier)` fills with the tier of the glass the
 * structure uses. Every class is read the same way, nothing is listed per machine:
 *
 *   node tools/gt-source/glass-tier.mjs <GT5-Unofficial checkout> <source class> [...]
 *
 *   - a `for (T h : <list>)` loop of the class chain whose body compares the glass tier field (a field of the
 *     chain that `chainAllGlasses` sets, or `getGlassTier()`) with `h.getTierForStructure()` / `h.mTier` limits the
 *     hatch kind of the list, named by the list: `Energy` in it is `energy` (`mEnergyHatches`, `mExoticEnergyHatches`,
 *     `getExoticAndNormalEnergyHatchList()`; the exotic ones are the multi-amp and laser hatches the planner gives the
 *     `energy` kind too), `Dynamo` is `dynamo`;
 *   - `glassTier < inputTier` with `inputTier` from `getInputVoltageTier()` (the voltage of the energy hatch) limits
 *     `energy` too;
 *   - every other comparison with the glass tier is listed (`other`) and not modelled: a fixed minimum
 *     (`glassTier < VoltageIndex.UV`, often for the laser hatches), a recipe's voltage, the laser source's tier.
 *   - the glass is the legend keys with a block of GT's tier registry (`GlassTier.RegisterGlassTiers`,
 *     `addCustomGlass(block, meta, tier, index)`); where another element of the shapes places the same block
 *     without being the tiered glass the keys cannot be told apart and the run fails.
 */
import { pathToFileURL } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import { ClassContext } from './casing-min.mjs';
import { elementCalls } from './hatch-elements.mjs';
import { findCalls, matchClose, splitArgs } from './java.mjs';

/** Kind of the hatches in a list (`mEnergyHatches`, `getExoticAndNormalEnergyHatchList()`), by its name. */
export function kindOfList(expr) {
  if (/dynamo/i.test(expr)) return 'dynamo';
  if (/energy/i.test(expr)) return 'energy';
  return null;
}

/** The statement or block after a `for (...)` header that ends at `end`. */
function loopBody(body, end) {
  let i = end;
  while (/\s/.test(body[i] ?? '')) i++;
  if (body[i] === '{') return body.slice(i + 1, matchClose(body, i));
  const semi = body.indexOf(';', i);
  return body.slice(i, semi < 0 ? body.length : semi);
}

/** Names of the int fields `chainAllGlasses(-1, (te, t) -> te.<field> = t, ...)` fills, in the class chain. */
function glassFields(chain) {
  const out = new Set(['glassTier']);
  for (const c of chain)
    for (const call of findCalls(c.body, 'chainAllGlasses')) {
      const m = /->\s*\w+\.(\w+)\s*=\s*\w+/.exec(call.args);
      if (m) out.add(m[1]);
    }
  return [...out];
}

/**
 * `{ kinds, other }` for a class chain (`HatchRules.chain`): the hatch kinds the glass tier limits, and the other
 * comparisons with the glass tier as source text.
 */
export function glassLimits(chain) {
  const fields = glassFields(chain);
  const word = new RegExp(`\\b(?:${fields.join('|')})\\b`);
  const kinds = new Set();
  const used = [];
  for (const c of chain) {
    for (const call of findCalls(c.body, 'for')) {
      const m = /^\s*(?:final\s+)?[\w<>.?\[\]]+\s+(\w+)\s*:\s*([\s\S]+)$/.exec(call.args);
      if (!m) continue;
      const body = loopBody(c.body, call.end);
      const [, v, list] = m;
      if (
        !word.test(body) ||
        !new RegExp(`\\b${v}\\s*\\.\\s*(?:getTierForStructure\\s*\\(\\)|mTier)`).test(body)
      )
        continue;
      const kind = kindOfList(list);
      if (kind) kinds.add(kind);
      else used.push(`${c.name}: loop over ${list.trim()}`);
      used.push(body);
    }
    // `int inputTier = (int) getInputVoltageTier(); if (glassTier < inputTier)`
    for (const m of c.body.matchAll(
      /\bint\s+(\w+)\s*=\s*(?:\(\s*int\s*\)\s*)?getInputVoltageTier\s*\(\)\s*;/g,
    )) {
      const cmp = new RegExp(`${word.source}\\s*<\\s*${m[1]}\\b|\\b${m[1]}\\s*>\\s*${word.source}`);
      const hit = cmp.exec(c.body);
      if (hit) {
        kinds.add('energy');
        used.push(hit[0]);
      }
    }
  }
  const other = [];
  const cmp = new RegExp(
    `(?:${word.source}\\s*[<>]=?\\s*[^;)&|{]+|[^;(&|{]+[<>]=?\\s*${word.source}\\b)`,
    'g',
  );
  for (const c of chain)
    for (const m of c.body.matchAll(cmp)) {
      const text = m[0].replace(/\s+/g, ' ').trim();
      if (used.some((u) => u.includes(m[0]) || m[0].includes(u))) continue;
      other.push(`${c.name}: ${text}`);
    }
  return { kinds: [...kinds].sort(), other: [...new Set(other)] };
}

/** The planner's own stand-in for the tiered glass of a hand-made entry (an Assembly Line's `g`). */
export const GENERIC_GLASS = ['gt.glass.reinforced'];

/** Candidates (`BlockReader` shape) of every glass GT registers as a tier: `addCustomGlass(block, meta, ...)`. */
export function tieredGlassBlocks(rules, blocks) {
  const chain = rules.chain('gregtech.api.util.GlassTier$RegisterGlassTiers');
  const ctx = new ClassContext(chain);
  const cands = [];
  for (const c of chain)
    for (const call of findCalls(c.body, 'addCustomGlass')) {
      const [b, meta] = splitArgs(call.args);
      const block = blocks.blockOf(b ?? '', ctx);
      // A mod's own glass registered by name (`addCustomGlass(EnderIO.ID, "blockFusedQuartz", ...)`) is no catalog block.
      if (block) cands.push({ ...block, meta: meta === undefined ? null : blocks.metaOf(meta, ctx) });
    }
  return cands;
}

/**
 * The legend keys of a def that hold the tiered glass: those with a block of the registry `cands`. Throws when
 * the class has no `chainAllGlasses` element, or places such a block with another element (the keys cannot be told
 * apart).
 */
export function glassChars(def, sourceClass, rules, blocks, names, cands) {
  const chain = rules.chain(sourceClass);
  if (!chain.some((c) => findCalls(c.body, 'chainAllGlasses').length))
    throw new Error(`${sourceClass} sets the glass tier without chainAllGlasses`);
  const ids = Object.entries(def.legend)
    .filter(([, e]) => GENERIC_GLASS.includes(e.blockId) || cands.some((c) => names.matches(c, e.blockId)))
    .map(([, e]) => e.blockId);
  if (!ids.length) throw new Error(`no legend key of ${def.id} has a block of the glass tiers`);
  const { calls } = elementCalls(rules, sourceClass);
  const ctx = new ClassContext(chain);
  for (const { char, expr } of calls) {
    if (/chainAllGlasses/.test(expr)) continue;
    const clash = blocks.elementBlocks(expr, ctx).cands.some((c) => ids.some((id) => names.matches(c, id)));
    if (clash) throw new Error(`element '${char}' places a glass block without being the tiered glass`);
  }
  return Object.entries(def.legend)
    .filter(([, e]) => ids.includes(e.blockId))
    .map(([ch]) => ch)
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, ...classes] = process.argv.slice(2);
  const rules = new HatchRules(root);
  for (const cls of classes) {
    const r = glassLimits(rules.chain(cls));
    console.log(cls, r.kinds.join(', ') || '-');
    for (const o of r.other) console.log(`  other: ${o}`);
  }
}
