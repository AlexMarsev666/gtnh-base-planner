// Canonical BartWorks glass variants, read from the locked RC2 registry and GlassTier registrations.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPinnedSource } from './pinned-source.mjs';
import { stripComments } from './java.mjs';

const root = process.argv[2];
if (!root) throw new Error('Usage: node tools/gt-source/glass-variants-rc2.mjs <GT5U RC2 checkout>');
const registryPath = 'src/main/java/bartworks/common/loaders/ItemRegistry.java';
const tiersPath = 'src/main/java/gregtech/api/util/GlassTier.java';
const registry = stripComments(readPinnedSource(root, registryPath));
const registration = stripComments(readPinnedSource(root, tiersPath));
const textures =
  /bw_realglas\s*=\s*new BWBlocksGlass\(\s*"BW_TieredGlass",\s*new String\[\]\s*\{([^}]+)\}/s.exec(
    registry,
  )?.[1];
if (!textures) throw new Error('Canonical glass texture registry not found.');
const names = [...textures.matchAll(/MainMod\.MOD_ID\s*\+\s*":([^"]+)"/g)].map((m) => m[1]);
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
const variants = [
  ...registration.matchAll(/addCustomGlass\(ItemRegistry\.bw_realglas,\s*(\d+),\s*(\d+),\s*0\)/g),
].map((match) => {
  const meta = Number(match[1]);
  const tier = tiers[Number(match[2])];
  const name = names[meta];
  if (!tier || !name) throw new Error(`Unresolved glass meta ${meta}.`);
  const path = `src/main/resources/assets/bartworks/textures/blocks/${name}.png`;
  const tile = `DUMP_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
  mkdirSync('tools/texture-sources', { recursive: true });
  copyFileSync(join(root, path), `tools/texture-sources/${tile}.png`);
  return {
    id: `bartworks:BW_TieredGlass@${meta}`,
    tier,
    tile,
    path,
    sha256: createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex'),
  };
});
if (
  variants.length !== 11 ||
  variants.some((v, i) => v.id !== `bartworks:BW_TieredGlass@${i}` || v.tier !== tiers[i + 3])
)
  throw new Error('RC2 canonical glass registration changed.');
writeFileSync(
  'src/data/glass-variants.rc2.generated.json',
  JSON.stringify({ rulesVersion: '2.9.0-RC-2', source: registryPath, variants }, null, 2) + '\n',
);
writeFileSync(
  'src/data/glass-variants.runtime.generated.json',
  JSON.stringify(
    variants.map(({ id, tier }) => ({ id, tier })),
    null,
    2,
  ) + '\n',
);
const attribution = 'ATTRIBUTION.md';
const start = '<!-- tools/gt-source: RC2 glass variants -->';
const end = '<!-- /tools/gt-source: RC2 glass variants -->';
const prior = readFileSync(attribution, 'utf8')
  .replace(new RegExp(`${start}[\\s\\S]*?${end}\\s*`), '')
  .trimEnd();
writeFileSync(
  attribution,
  prior +
    '\n\n' +
    start +
    '\nBorosilicate glass variants: GT5-Unofficial 5.09.54.205, commit a3e1e11241a814c9fa0dd0973d5699548428f689.\nThese textures retain the GT5-Unofficial LGPL-3.0 attribution above and the BartWorks contributor credits. Source files:\n\n' +
    variants.map((v) => `- \`${v.path}\``).join('\n') +
    '\n\n' +
    end +
    '\n',
);
console.log(JSON.stringify({ variants: variants.length, tiers: variants.map((v) => v.tier) }));
