#!/usr/bin/env node
/** RC2 beam input/output getTexturesInactive, over the shielded accelerator casing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextureJars } from './jars.mjs';
import { Composer, TILE } from './compose.mjs';
import { encodePng } from '../../scripts/build-atlas.mjs';

const jar = process.argv[2];
if (!jar) throw new Error('Expected the pinned RC2 GT5-Unofficial dev jar.');
const lock = JSON.parse(readFileSync(new URL('./rc2-source-lock.json', import.meta.url), 'utf8'));
if (createHash('sha256').update(readFileSync(jar)).digest('hex') !== lock['GT5-Unofficial'].devJarSha256)
  throw new Error('GT5-Unofficial jar differs from the RC2 source lock.');
const composer = new Composer(new TextureJars([jar]));
for (const [kind, prefix] of [
  ['INPUT', 'BI'],
  ['OUTPUT', 'BO'],
]) {
  const pixels = composer.compose([
    { icon: `gregtech:iconsets/OVERLAY_${prefix}_SIDES`, rgba: [210, 220, 255, 255] },
    { icon: `gregtech:iconsets/${prefix}_CONN`, rgba: [255, 255, 255, 255] },
  ]);
  if (!pixels || composer.missing.size) throw new Error(`Missing beam sprites: ${[...composer.missing]}`);
  writeFileSync(
    `tools/texture-sources/BEAM_${kind}_FRONT.png`,
    encodePng({ width: TILE, height: TILE, data: pixels }),
  );
}
