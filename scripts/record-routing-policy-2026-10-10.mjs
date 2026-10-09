import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Record the production policy, without source transformations or budget overrides.
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
try {
  const fixtures = await server.ssrLoadModule('/src/model/site/fixtures/referencePlans.ts');
  const { siteFromJson } = await server.ssrLoadModule('/src/share/siteCodec.ts');
  const { createSiteBuilder } = await server.ssrLoadModule('/src/model/site/build.ts');
  const { routingMetrics } = await server.ssrLoadModule('/src/model/site/routingMetrics.ts');
  const { arrangeHere } = await server.ssrLoadModule('/src/ui/siteArrange.ts');
  const { optimizationBudget } = await server.ssrLoadModule('/src/model/site/optimize.ts');
  const plans = [
    ...fixtures.referencePlans(),
    {
      id: '(3)-corrected',
      site: siteFromJson(await readFile('docs/fixtures/gtnh-site-site (3)-corrected.json', 'utf8')),
    },
  ];
  const rows = [];
  for (const { id, site } of plans) {
    const builder = createSiteBuilder();
    const options = { pipes: true, cables: true, below: true };
    const original = routingMetrics(builder(site, options));
    const neat = arrangeHere(site, true, builder, false, undefined, true);
    const row = {
      id,
      budget: optimizationBudget(site),
      original,
      neat: {
        accepted: !!neat.routingSummary,
        rejected: !!neat.rejected,
        ...routingMetrics(builder(neat.site, options)),
      },
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(
    'docs/fixtures/reference-routing-policy-2026-10-10.json',
    JSON.stringify({ surfaceCost: 4, below: true, rows }, null, 2) + '\n',
  );
} finally {
  await server.close();
}
