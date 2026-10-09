#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextureJars } from './jars.mjs';
const jar = process.argv[2];
if (!jar) throw new Error('Expected the pinned RC2 GT5-Unofficial dev jar.');
const lock = JSON.parse(readFileSync(new URL('./rc2-source-lock.json', import.meta.url), 'utf8'));
if (createHash('sha256').update(readFileSync(jar)).digest('hex') !== lock['GT5-Unofficial'].devJarSha256)
  throw new Error('GT5-Unofficial jar differs from the RC2 source lock.');
const sprite = new TextureJars([jar]).get('gregtech:iconsets/FLUID_STEAM_IN_SIGN');
if (!sprite) throw new Error('Missing RC2 custom fluid hatch indicator.');
writeFileSync('tools/texture-sources/FLUID_STEAM_IN_SIGN.png', sprite);
