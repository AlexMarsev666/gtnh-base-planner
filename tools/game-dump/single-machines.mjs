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
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

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
const wanted = new Map(
  machines
    .filter((m) => m.sprite)
    .map((m) => [ASSETS + m.sprite + '.png', `SINGLE_${m.id.toUpperCase().replaceAll('-', '_')}`]),
);
const files = unzipSync(readFileSync(jar), { filter: (f) => wanted.has(f.name) });
mkdirSync(OUT, { recursive: true });
for (const [path, tile] of wanted) {
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
  ...[...wanted.keys()].sort().map((p) => `- \`src/main/resources/${p}\``),
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
