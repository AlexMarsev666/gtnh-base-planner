import { writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { build, loadConfigFromFile } from 'vite';

// Read-only analysis of a normal worker bundle. Temporary build output stays in the ignored cache.
const root = process.cwd();
const config = (await loadConfigFromFile({ command: 'build', mode: 'production' })).config;
const workerPlugins = config.worker?.plugins;
let measurement;
const plugin = () => ({
  name: 'measure-worker-modules',
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk' || !chunk.facadeModuleId?.endsWith('/src/ui/siteWorker.ts')) continue;
      const modules = Object.entries(chunk.modules)
        .map(([id, module]) => ({
          id: id.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''),
          renderedBytes: module.renderedLength,
          originalBytes: module.originalLength,
        }))
        .sort((a, b) => b.renderedBytes - a.renderedBytes);
      const groups = {};
      for (const m of modules) {
        const group = m.id.startsWith('src/data/multiblocks/')
          ? 'Catalog shapes'
          : /src\/data\/.*generated\.json/.test(m.id)
            ? 'Generated constraints and casings'
            : m.id.startsWith('src/data/')
              ? 'Other catalog data'
              : m.id.startsWith('src/model/site/')
                ? 'Site model and routing'
                : m.id.startsWith('src/model/')
                  ? 'Other model'
                  : m.id.startsWith('src/import/')
                    ? 'Import'
                    : m.id.startsWith('src/ui/')
                      ? 'Worker command entry'
                      : 'Other';
        groups[group] = (groups[group] ?? 0) + m.renderedBytes;
      }
      measurement = {
        workerFile: chunk.fileName,
        rawBytes: Buffer.byteLength(chunk.code),
        gzipBytes: gzipSync(chunk.code).length,
        note: 'renderedBytes are tree-shaken module sizes before final minification. They are not additive gzip contributions; the compressed worker is measured as one stream.',
        groups,
        modules,
      };
    }
  },
});
await build({
  ...config,
  configFile: false,
  worker: { ...config.worker, plugins: () => [...(workerPlugins?.() ?? []), plugin()] },
  build: { ...config.build, outDir: '.tool-cache/worker-module-measurement', emptyOutDir: true },
});
if (!measurement) throw new Error('Worker module information was not captured');
measurement.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await mkdir('docs/fixtures', { recursive: true });
await writeFile(
  'docs/fixtures/worker-module-contributions-2026-10-10.json',
  JSON.stringify(measurement, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      workerFile: measurement.workerFile,
      gzipKB: measurement.gzipBytes / 1024,
      groups: measurement.groups,
      largestModules: measurement.modules.slice(0, 16),
    },
    null,
    2,
  ),
);
