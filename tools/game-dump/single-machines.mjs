#!/usr/bin/env node
/**
 * Front overlays of the GT single-block machines (Macerator, Electrolyzer, ...) for the template view.
 *
 *   node tools/game-dump/single-machines.mjs <GT5-Unofficial-...-dev.jar>
 *
 * `src/data/single-machines.json` lists the machines; each one with a `sprite` has that file of the jar
 * copied to `tools/texture-sources/SINGLE_<ID>.png` (the atlas script crops it to its first frame and puts it
 * over the machine hull) and listed in `ATTRIBUTION.md`. The ones with a `tile` reuse a tile the atlas has
 * already.
 *
 * Tiers: the hull of every tier (`MACHINE_<tier>_SIDE/TOP/BOTTOM`) and, for the machine marked `transformer`,
 * the overlays of every family as GT draws them: `SINGLE_TRANSFORMER_<IN|OUT>_<TIER>` (single-amp) and
 * `SINGLE_TRANSFORMER_<IN|OUT>_<4|16|64>A_<TIER>`. The names are those of `transformerLook` in
 * src/data/single-machines.ts. Basic machines look the same in every tier apart from the hull.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { TIERS } from '../../src/model/core/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'tools/texture-sources');
const ASSETS = 'assets/gregtech/textures/blocks/';
const NL = String.fromCharCode(10);

const jar = process.argv[2];
if (!jar) {
  console.error('usage: node tools/game-dump/single-machines.mjs <GT5-Unofficial jar>');
  process.exit(1);
}
const machines = JSON.parse(readFileSync(join(ROOT, 'src/data/single-machines.json'), 'utf8'));
// Tile name -> path in the jar (two tiles may be the same sprite).
const wanted = new Map(
  machines
    .filter((m) => m.sprite)
    .map((m) => [`SINGLE_${m.id.toUpperCase().replaceAll('-', '_')}`, ASSETS + m.sprite + '.png']),
);
const ICONSETS = 'iconsets/';
// Overlays of the transformers (MTETransformer, MTETransformerHiAmp, MTEWetTransformer): the single-amp
// hatch overlay (plain transformer, high side LV..MAX) and the 4, 16 and 64 amp ones of every tier.
if (machines.some((m) => m.transformer)) {
  TIERS.forEach((tier, i) => {
    const tag = tier.toUpperCase();
    for (const dir of ['IN', 'OUT']) {
      if (i >= 1)
        wanted.set(
          `SINGLE_TRANSFORMER_${dir}_${tag}`,
          `${ASSETS}${ICONSETS}OVERLAY_ENERGY_${dir}_${tier}.png`,
        );
      for (const amps of [4, 16, 64])
        wanted.set(
          `SINGLE_TRANSFORMER_${dir}_${amps}A_${tag}`,
          `${ASSETS}${ICONSETS}OVERLAY_ENERGY_${dir}_MULTI_${amps}A_${tier}.png`,
        );
    }
  });
}
// The hull of every tier.
for (const tier of TIERS)
  for (const part of ['SIDE', 'TOP', 'BOTTOM'])
    wanted.set(`MACHINE_${tier}_${part}`, `${ASSETS}${ICONSETS}MACHINE_${tier}_${part}.png`);
const paths = new Set(wanted.values());
const files = unzipSync(readFileSync(jar), { filter: (f) => paths.has(f.name) });
mkdirSync(OUT, { recursive: true });
for (const [tile, path] of wanted) {
  if (!files[path]) throw new Error(`the jar has no ${path}`);
  writeFileSync(join(OUT, `${tile}.png`), files[path]);
}

// ATTRIBUTION.md lists the sprites in a section of its own.
const START = '<!-- tools/game-dump: single-block machines -->';
const END = '<!-- /tools/game-dump: single-block machines -->';
const section = [
  START,
  '',
  '### Files used by the single-block machines of the template view',
  '',
  'The front overlays of the GT single-block machines (`tools/texture-sources/SINGLE_*.png`, see',
  '[`tools/game-dump/single-machines.mjs`](tools/game-dump/single-machines.mjs)) are these sprites of the',
  'GT5-Unofficial `5.09.54.205` jar, drawn over the machine hull:',
  '',
  ...[...paths].sort().map((p) => `- \`src/main/resources/${p}\``),
  '',
  END,
].join(NL);
const file = join(ROOT, 'ATTRIBUTION.md');
let text = readFileSync(file, 'utf8');
const start = text.indexOf(START);
text =
  start >= 0
    ? text.slice(0, start) + section + text.slice(text.indexOf(END) + END.length)
    : text.trimEnd() + NL + NL + section + NL;
writeFileSync(file, text);
console.log(
  `wrote ${wanted.size} machine overlays to tools/texture-sources/ and listed them in ATTRIBUTION.md`,
);
