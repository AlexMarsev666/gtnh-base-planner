#!/usr/bin/env node
/** Copy only the RC2 hull/energy sprites used by tiered machines and transformers, with attribution. */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Expected RC2 GT5-Unofficial checkout.');
const tiers = [
  'ULV',
  'LV',
  'MV',
  'HV',
  'EV',
  'IV',
  'LuV',
  'ZPM',
  'UV',
  'UHV',
  'UEV',
  'UIV',
  'UMV',
  'UXV',
  'MAX',
];
const paths = [];
for (const tier of tiers) {
  const names = ['SIDE', 'TOP', 'BOTTOM'].map((face) => `MACHINE_${tier}_${face}`);
  for (const prefix of [
    'OVERLAY_ENERGY_IN',
    'OVERLAY_ENERGY_OUT',
    'OVERLAY_ENERGY_IN_MULTI_4A',
    'OVERLAY_ENERGY_OUT_MULTI_4A',
  ])
    names.push(`${prefix}_${tier}`);
  for (const name of names) {
    const path = `src/main/resources/assets/gregtech/textures/blocks/iconsets/${name}.png`;
    copyFileSync(join(root, path), join('tools/texture-sources', `${name}.png`));
    paths.push(path);
  }
}
const start = '<!-- tools/game-dump: RC2 tier textures -->';
const end = '<!-- /tools/game-dump: RC2 tier textures -->';
const section = `${start}\n\n### RC2 tiered hulls and transformers\n\nGT5-Unofficial 5.09.54.205 (a3e1e11241a814c9fa0dd0973d5699548428f689), LGPL-3.0.\nCopied by tools/game-dump/tier-textures.mjs; transformer sides follow MTETransformer.getTextureSet.\n\n${paths
  .sort()
  .map((p) => '- `' + p + '`')
  .join('\n')}\n\n${end}`;
const file = 'ATTRIBUTION.md';
let text = readFileSync(file, 'utf8');
const i = text.indexOf(start);
text =
  i < 0
    ? text.trimEnd() + '\n\n' + section + '\n'
    : text.slice(0, i) + section + text.slice(text.indexOf(end) + end.length);
writeFileSync(file, text);
