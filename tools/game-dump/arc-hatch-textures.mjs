/** Source MTEHatchElectrodeDetector.getTexturesInactive: hull plus heat sensor, without active glow. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextureJars } from './jars.mjs';
import { Composer, TILE } from './compose.mjs';
import { encodePng } from '../../scripts/build-atlas.mjs';
const jar = process.argv[2];
const lock = JSON.parse(readFileSync(new URL('./rc2-source-lock.json', import.meta.url), 'utf8'));
if (
  !jar ||
  createHash('sha256').update(readFileSync(jar)).digest('hex') !== lock['GT5-Unofficial'].devJarSha256
)
  throw new Error('Expected pinned RC2 GT5-Unofficial dev jar');
const composer = new Composer(new TextureJars([jar]));
const data = composer.compose([
  { icon: 'gregtech:iconsets/OVERLAY_HATCH_HEAT_SENSOR', rgba: [255, 255, 255, 255] },
]);
if (!data || composer.missing.size) throw new Error(`Missing detector sprite: ${[...composer.missing]}`);
writeFileSync(
  'tools/texture-sources/ELECTRODE_DETECTOR_FRONT.png',
  encodePng({ width: TILE, height: TILE, data }),
);
