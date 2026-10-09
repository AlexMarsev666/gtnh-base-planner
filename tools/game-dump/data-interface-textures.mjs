/** The shared inactive recipe-data face of the four registered TecTech connectors. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextureJars } from './jars.mjs';
import { Composer, TILE } from './compose.mjs';
import { encodePng, MACHINE_METAL } from '../../scripts/build-atlas.mjs';
const jar = process.argv[2];
const lock = JSON.parse(readFileSync(new URL('./rc2-source-lock.json', import.meta.url), 'utf8'));
if (
  !jar ||
  createHash('sha256').update(readFileSync(jar)).digest('hex') !== lock['GT5-Unofficial'].devJarSha256
)
  throw new Error('Expected pinned RC2 GT5-Unofficial dev jar');
const composer = new Composer(new TextureJars([jar]));
const pixels = composer.compose([
  { icon: 'gregtech:iconsets/OVERLAY_EM_D_SIDES', rgba: [...MACHINE_METAL, 255] },
  { icon: 'gregtech:iconsets/EM_DATA_CONN', rgba: [255, 255, 255, 255] },
]);
if (!pixels || composer.missing.size)
  throw new Error(`Missing data interface sprite: ${[...composer.missing]}`);
writeFileSync(
  'tools/texture-sources/RECIPE_DATA_FRONT.png',
  encodePng({ width: TILE, height: TILE, data: pixels }),
);
