import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSiteBuilder } from './build';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import { referencePlans } from './fixtures/referencePlans';
import { siteToJson } from '../../share/siteCodec';

/** Physical pipe/cable blocks, all paths, bends and disconnected physical terminals. */
function metrics(site: ReturnType<typeof referencePlans>[number]['site'], built: SiteBuild) {
  const paths = built.nets.flatMap((n) => n.route?.paths ?? []);
  let bends = 0;
  for (const path of paths)
    for (let i = 2; i < path.length; i++)
      if (path[i].some((v, axis) => v - path[i - 1][axis] !== path[i - 1][axis] - path[i - 2][axis])) bends++;
  const cells = new Set(paths.flat().map((p) => p.join()));
  return {
    bends,
    surfaceBlocks: [...cells].filter((cell) => Number(cell.split(',')[1]) >= 0).length,
    length: built.stats.pipeBlocks + built.stats.cableBlocks,
    width: site.size[0],
    depth: site.size[1],
    unconnectedHatches: built.stats.terminals - built.stats.connected,
  };
}

describe('five reference plans: compare routing with accepted stage 4', () => {
  for (const fixture of referencePlans())
    it(
      fixture.id,
      async () => {
        let builder: SiteBuilder = createSiteBuilder();
        // Recording historical metrics uses an isolated source snapshot, never native/game scenarios.
        if (process.env.REFERENCE_BASELINE_ROOT) {
          const modulePath = resolve(
            process.env.REFERENCE_BASELINE_ROOT,
            'src/model/site/build.ts',
          ).replaceAll('\\', '/');
          const historical = await import(/* @vite-ignore */ modulePath);
          builder = historical.createSiteBuilder();
        }
        const built = builder(fixture.site, { pipes: true, cables: true, below: true });
        expect(built.warnings.filter((w) => w.type !== 'unrouted')).toEqual([]);
        const actual = metrics(fixture.site, built);
        const file = resolve('docs/fixtures', `baseline-${fixture.id}.json`);
        if (process.env.REFERENCE_BASELINE_ROOT) {
          mkdirSync(resolve('docs/fixtures'), { recursive: true });
          writeFileSync(
            file,
            JSON.stringify(
              {
                commit: 'd2de3e27eb5ddc55caf7026e02b9d90376dfcc53',
                title: fixture.title,
                tolerance: 0,
                metrics: actual,
              },
              null,
              2,
            ) + '\n',
          );
          if (!fixture.id.startsWith('01'))
            writeFileSync(resolve('docs/fixtures', `reference-${fixture.id}.json`), siteToJson(fixture.site));
        }
        const baseline = JSON.parse(readFileSync(file, 'utf8'));
        if (fixture.site.routing?.mode !== 'neat') {
          for (const [key, value] of Object.entries(actual))
            expect(value, `${fixture.id}: ${key}`).toBeLessThanOrEqual(
              baseline.metrics[key] + baseline.tolerance,
            );
        } else {
          // The user's revised routing policy permits shorter surface connections. Preserve
          // the historical measurements; compare their combined cost instead of forbidding
          // every increase in surface blocks or bends independently.
          for (const key of ['width', 'depth', 'unconnectedHatches'] as const)
            expect(actual[key], `${fixture.id}: ${key}`).toBeLessThanOrEqual(baseline.metrics[key]);
          const weighted = (m: typeof actual) => m.length + m.surfaceBlocks + m.bends * 8;
          const cells = new Set(
            built.nets.flatMap((n) => n.route?.paths.flat().map((p) => p.join(',')) ?? []),
          );
          const depthPenalty = [...cells].reduce(
            (sum, cell) => sum + Math.max(0, -Number(cell.split(',')[1]) - 1) * 0.25,
            0,
          );
          // Historical reports do not record layer occupancy. Omitting their depth penalty
          // makes this a stricter comparison instead of guessing a larger historical cost.
          expect(
            weighted(actual) + depthPenalty,
            `${fixture.id}: weighted cost; ${JSON.stringify(actual)}`,
          ).toBeLessThanOrEqual(weighted(baseline.metrics));
        }
      },
      20000,
    );
});
