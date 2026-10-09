import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSiteBuilder } from './build';
import { referencePlans } from './fixtures/referencePlans';
import { siteFromJson } from '../../share/siteCodec';
import { routingMetrics } from './routingMetrics';
import { SURFACE_COST } from './router';
import { arrangeHere } from '../../ui/siteArrange';
import accepted from '../../../docs/fixtures/reference-routing-policy-2026-10-10.json';

const plans = [
  ...referencePlans(),
  {
    id: '(3)-corrected',
    site: siteFromJson(readFileSync(resolve('docs/fixtures/gtnh-site-site (3)-corrected.json'), 'utf8')),
  },
];

describe('accepted routing policy: surface penalty 4, trunks separate from hatch approaches', () => {
  it('uses the accepted default surface penalty', () => {
    expect(SURFACE_COST).toBe(4);
    expect(accepted.surfaceCost).toBe(4);
  });
  for (const { id, site } of plans)
    it(
      id,
      () => {
        const expected = accepted.rows.find((row) => row.id === id)!;
        const builder = createSiteBuilder();
        const options = { pipes: true, cables: true, below: true };
        const original = routingMetrics(builder(site, options));
        expect(original).toEqual(expected.original);
        const neat = arrangeHere(site, true, builder, false, undefined, true);
        expect(!!neat.routingSummary).toBe(expected.neat.accepted);
        expect(!!neat.rejected).toBe(expected.neat.rejected);
        const result = routingMetrics(builder(neat.site, options));
        const { accepted: _accepted, rejected: _rejected, ...metrics } = expected.neat;
        expect(result).toEqual(metrics);
        expect(result.warnings).toEqual([]);
        expect(result.connected).toBe(result.terminals);
        expect(result.surfaceTrunks + result.surfaceApproaches).toBe(result.surface);
        expect(Object.values(result.levels).reduce((sum, count) => sum + count, 0)).toBe(result.length);
        // Keep the compact stage-4 quality gate; the historical fixtures themselves remain unchanged.
        if (site.routing?.mode === 'compact') {
          const historical = JSON.parse(
            readFileSync(resolve('docs/fixtures', `baseline-${id}.json`), 'utf8'),
          );
          expect(original.length).toBeLessThanOrEqual(historical.metrics.length);
          expect(original.bends).toBeLessThanOrEqual(historical.metrics.bends);
          expect(original.surface).toBeLessThanOrEqual(historical.metrics.surfaceBlocks);
        }
      },
      20000,
    );
});
