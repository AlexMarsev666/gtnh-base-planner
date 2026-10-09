// Stage 3's sole native exception: two real controllers consuming the same physical side input.
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const [out, gtJar, structureJar] = process.argv.slice(2);
if (!out || !gtJar || !structureJar)
  throw new Error('Expected output, pinned GT5U and StructureLib dev jars.');
const lock = JSON.parse(readFileSync('tools/game-dump/rc2-source-lock.json', 'utf8'));
const jars = [gtJar, structureJar].map((path) => ({
  path: resolve(path),
  sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
}));
if (
  jars[0].sha256 !== lock['GT5-Unofficial'].devJarSha256 ||
  jars[1].sha256 !== lock.StructureLib.devJarSha256
)
  throw new Error('Unpinned game jars.');
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { crackerWallsharingCase } = await vite.ssrLoadModule('/src/model/site/fixtures/mirroredCrackers.ts');
  writeFileSync(
    out,
    JSON.stringify(
      {
        schema: 1,
        pack: lock.pack,
        sourceCommit: lock['GT5-Unofficial'].commit,
        jars,
        cases: [crackerWallsharingCase()],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Exported exactly one mirrored Oil Cracking Unit pair.');
} finally {
  await vite.close();
}
