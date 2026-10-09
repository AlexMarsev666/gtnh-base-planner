/** Inactive Uncertainty Resolver and Computer Rack faces, verified against the RC2 jar. */
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
for (const [name, icon] of [
  ['COMPUTATION_UNCERTAINTY_FRONT', 'UC'],
  ['COMPUTATION_RACK_FRONT', 'EM_RACK'],
]) {
  const data = composer.compose([{ icon: `gregtech:iconsets/${icon}`, rgba: [255, 255, 255, 255] }]);
  if (!data || composer.missing.size) throw new Error(`Missing computing sprite: ${[...composer.missing]}`);
  writeFileSync(`tools/texture-sources/${name}.png`, encodePng({ width: TILE, height: TILE, data }));
}
