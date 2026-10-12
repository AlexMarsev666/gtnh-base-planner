#!/usr/bin/env node
/**
 * The Data Access Hatch of the Assembly Lines, read from the controller's structure definition:
 *
 *   .addElement('d', buildHatchAdder(MTEAssemblyLine.class).atLeast(DataHatchElement.DataAccess)
 *       .hint(3).casingIndex(42).allowOnly(ForgeDirection.NORTH).buildAndChain(GregTechAPI.sBlockCasings3, 10))
 *
 * is the `dataAccess` hatch kind (`hatch-elements.mjs`, `DataAccess` / `MTEHatchDataAccess`) on the grate casing cells
 * of that element. Every class is read the same way, nothing is listed per machine:
 *
 *   node tools/gt-source/data-access.mjs <GT5-Unofficial checkout> <source class> [...]
 *
 *   - the element's cells: the legend keys that already take `dataAccess`; else the keys of the zone `dot<N>` (the
 *     dump's hint dot of the element); else the keys with the casing block the element places (`buildAndChain(block,
 *     meta)`, `ofBlock(...)`), when that is one key. Hand-made entries have no zones, so they must name the cells
 *     themselves where two keys share the block (a plain grate casing beside the data one).
 *   - `max`: the hatches the element's adder collects (the list a method that tests `instanceof MTEHatchDataAccess`
 *     adds to) may not outnumber `N` in a `<list>.size() > N` check of the class chain (`al_too_many_data_access_hatch`).
 *     No check, no maximum. Nothing requires one, so `min` is 0.
 */
import { pathToFileURL } from 'node:url';
import { HatchRules } from './hatch-rules.mjs';
import { ClassContext } from './casing-min.mjs';
import { elementCalls } from './hatch-elements.mjs';
import { faceLeaves } from './hatch-faces.mjs';
import { placedBlocks, plainCells } from './shape-fit.mjs';
import { methodBody } from './java.mjs';

/** The block of a hatch-less planner entry for the kind (`hatchBlocks`). */
export const DATA_ACCESS_BLOCK = 'gt.hatch.dataAccess';

/** Maximum of the hatches the controller's adder collects, from its `<list>.size() > N` check; null when none. */
export function maxOf(chain) {
  const lists = new Set();
  for (const c of chain)
    for (const m of c.body.matchAll(/\b(\w+)\s*\(\s*IGregTechTileEntity\s+\w+\s*,\s*int\s+\w+\s*\)/g)) {
      const body = methodBody(c.body, m[1]);
      if (!body || !/instanceof\s+MTEHatchDataAccess/.test(body)) continue;
      for (const add of body.matchAll(/\b(\w+)\s*\.\s*add\s*\(/g)) lists.add(add[1]);
    }
  let max = null;
  for (const c of chain)
    for (const list of lists)
      for (const m of c.body.matchAll(
        new RegExp(`\\b${list}\\s*\\.\\s*size\\s*\\(\\)\\s*(>=?)\\s*(\\d+)`, 'g'),
      )) {
        const n = Number(m[2]) - (m[1] === '>=' ? 1 : 0);
        max = max === null ? n : Math.min(max, n);
      }
  return max;
}

/**
 * `{ chars, add, max, split, problems }` for a catalog def, or null when its class has no Data Access Hatch element:
 * `chars` are the legend keys that take the kind (those that already do, or the ones to add it to), `add` the ones to
 * add it to, `max` the most the class allows (null: no check). `split` lists the cells of a key found by its block that
 * GT's plain elements cover (`shape-fit.mjs`): `{ from, cells }`, to be drawn with a key of their own.
 */
export function dataAccessOf(def, sourceClass, rules, blocks, names) {
  const { leaves } = faceLeaves(rules, sourceClass);
  const mine = leaves.filter((l) => l.kinds.includes('dataAccess'));
  if (!mine.length) return null;
  const chain = rules.chain(sourceClass);
  const max = maxOf(chain);
  const have = Object.entries(def.legend)
    .filter(([, e]) => e.hatches?.includes('dataAccess'))
    .map(([ch]) => ch);
  if (have.length) return { chars: have, add: [], max, split: [], problems: [] };
  const { calls } = elementCalls(rules, sourceClass);
  const class_ = new ClassContext(chain);
  const found = new Set();
  const byBlock = new Set();
  const problems = [];
  for (const l of mine) {
    const zone = Object.entries(def.legend).filter(([, e]) => l.dot !== null && e.region === `dot${l.dot}`);
    if (zone.length) {
      zone.forEach(([ch]) => found.add(ch));
      continue;
    }
    const expr = calls.find((c) => c.char === l.char)?.expr ?? '';
    const cands = placedBlocks(expr, class_, blocks);
    const chars = Object.entries(def.legend)
      .filter(([, e]) => cands.some((c) => names.matches(c, e.blockId)))
      .map(([ch]) => ch);
    if (chars.length === 1) [found, byBlock].forEach((s) => s.add(chars[0]));
    else
      problems.push(
        `${sourceClass}: element '${l.char}' takes the Data Access Hatch on the casing of ${chars.length} legend keys` +
          ` (${chars.join(', ') || 'none'}); name the cells with "hatches": ["dataAccess"] in ${def.id}`,
      );
  }
  // A key found by its block may hold plain cells of the same block (the first slice's grate casing).
  const split = [];
  if (byBlock.size) {
    const plain = plainCells(def, [...byBlock], { rules, sourceClass, blocks, names, ctx: class_, leaves });
    for (const [from, cells] of plain) if (cells.size) split.push({ from, cells: [...cells].sort() });
  }
  return { chars: [...found].sort(), add: [...found].sort(), max, split, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, ...classes] = process.argv.slice(2);
  const rules = new HatchRules(root);
  for (const cls of classes) {
    const { leaves } = faceLeaves(rules, cls);
    const hit = leaves.filter((l) => l.kinds.includes('dataAccess'));
    console.log(
      cls,
      hit.length ? `dot ${hit.map((l) => l.dot).join(', ')}` : 'no data access hatch',
      `max ${maxOf(rules.chain(cls))}`,
    );
  }
}
