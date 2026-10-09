/** Export the planner's actual placements for independent RC2 checkMachine tests. */
import { createServer } from 'vite';
import { nativeCases, nativePlacement } from './native-cases.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [out, gtJar, structureLibJar, mode] = process.argv.slice(2);
if (!out || !gtJar || !structureLibJar)
  throw new Error(
    'Expected output JSON, GT5-Unofficial 5.09.54.205 dev jar and StructureLib 1.4.45 dev jar.',
  );
const lock = JSON.parse(readFileSync('tools/game-dump/rc2-source-lock.json', 'utf8'));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const jars = [gtJar, structureLibJar].map((path) => ({ path: resolve(path), sha256: hash(path) }));
if (
  jars[0].sha256 !== lock['GT5-Unofficial'].devJarSha256 ||
  jars[1].sha256 !== lock.StructureLib.devJarSha256
)
  throw new Error('Game jars do not match the pinned RC2 development artifacts.');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const [
    { getMultiblock, catalog },
    { buildGroup },
    { sizedDef },
    { unitCells },
    { withStructureGlass, minimumGlassTier },
  ] = await Promise.all([
    vite.ssrLoadModule('/src/data/catalog.ts'),
    vite.ssrLoadModule('/src/model/site/group.ts'),
    vite.ssrLoadModule('/src/model/resize.ts'),
    vite.ssrLoadModule('/src/model/geometry.ts'),
    vite.ssrLoadModule('/src/model/multiblock/glass.ts'),
  ]);
  const model = { getMultiblock, buildGroup, sizedDef, unitCells, withStructureGlass };
  const cases = [];
  const unresolved = [];
  if (mode === '--catalog') {
    for (const def of catalog) {
      try {
        const test = nativePlacement(
          model,
          def.id,
          { voltageTier: def.minimumVoltageTier ?? 'LV', structureGlassTier: minimumGlassTier(def) },
          def.resize?.default,
          {},
          true,
        );
        const unknown = [...new Set(test.cells.map((c) => c.block).filter((b) => b && !b.includes('@')))];
        if (unknown.length) throw new Error(`Native physical blocks not yet mapped: ${unknown.join(', ')}`);
        cases.push({ ...test, name: `catalog-${def.id}` });
      } catch (error) {
        unresolved.push({ machine: def.id, reason: String(error) });
      }
    }
  } else {
    if (mode !== undefined) throw new Error(`Unknown native fixture mode ${mode}`);
    cases.push(...nativeCases(model));
  }
  writeFileSync(
    out,
    JSON.stringify(
      {
        schema: 1,
        pack: lock.pack,
        sourceCommit: lock['GT5-Unofficial'].commit,
        jars,
        catalogProbe: mode === '--catalog' ? { count: catalog.length, unresolved } : undefined,
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Exported ${cases.length} native RC2 cases to ${out}; unresolved ${unresolved.length}`);
} finally {
  await vite.close();
}
