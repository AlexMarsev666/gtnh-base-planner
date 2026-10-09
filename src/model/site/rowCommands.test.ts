import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createSiteBuilder } from './build';
import { better, scoreBuild } from './optimize';
import { addsLayoutViolations } from './layoutViolations';
import { referencePlans } from './fixtures/referencePlans';
import { arrangeHere } from '../../ui/siteArrange';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import type { SiteGroup } from './types';

const identity = ({
  origin: _origin,
  rotation: _rotation,
  limits: _limits,
  arrangeLimits: _arrangeLimits,
  elevation: _elevation,
  ...rest
}: SiteGroup) => rest;

describe('stage 5: command rows, connectivity and reference quality', () => {
  it('rejects a canonical arrangement that disconnects previously connected terminals', () => {
    const source = referencePlans()[1].site;
    const builder = createSiteBuilder();
    const disconnected: SiteBuilder = (site, opts) => {
      const built = builder(site, { ...opts, pipes: false, cables: false });
      built.stats.terminals = 2;
      built.stats.connected = site.groups[0].origin[1] === source.groups[0].origin[1] ? 2 : 1;
      return built;
    };
    for (const optimize of [false, true]) {
      const result = arrangeHere(source, true, disconnected, optimize);
      expect(result.rejected).toBe(true);
      expect(result.site).toBe(source);
    }
  });

  it('judges short surface routes by the same weighted cost as the neat router', () => {
    const score = (blocks: number, surface: number, bends: number, depthPenalty = 0) =>
      scoreBuild({
        groups: [],
        warnings: [],
        stats: {
          terminals: 2,
          connected: 2,
          pipeBlocks: blocks,
          cableBlocks: 0,
          surfaceBlocks: surface,
          bends,
          depthPenalty,
        },
      } as unknown as SiteBuild);
    expect(better(score(3, 3, 0), score(12, 2, 4))).toBe(true);
    expect(better(score(12, 2, 4), score(3, 3, 0))).toBe(false);
    expect(better(score(3, 3, 0, 2), score(3, 3, 0, 0))).toBe(false);
    const disconnected = { ...score(1, 0, 0), unconnected: 1 };
    expect(better(disconnected, score(100, 100, 10))).toBe(false);
  });

  const measurements: unknown[] = [];
  for (const fixture of referencePlans()) {
    // Stage 5 exercises the visible neat mode. The original saved Compact fixture and
    // its historical metric test stay intact; enabling this mode is an explicit choice.
    const source = { ...fixture.site, routing: { mode: 'neat' as const, depth: 3 } };
    const rawBuilder = createSiteBuilder();
    const routed = new Map<string, SiteBuild>();
    // Several command checks revisit the same document. Route each distinct input once;
    // independent router and historical-metric tests still exercise uncached builds.
    const builder: SiteBuilder = (site, opts) => {
      if (!opts.pipes || !opts.cables) return rawBuilder(site, opts);
      const key = JSON.stringify(site);
      if (!routed.has(key)) routed.set(key, rawBuilder(site, opts));
      return routed.get(key)!;
    };
    const opts = { pipes: true, cables: true, below: true };
    let aligned: ReturnType<typeof arrangeHere>;
    let baseline: SiteBuild;
    let arranged: SiteBuild;
    const ensureArranged = () => {
      baseline ??= builder(source, opts);
      aligned ??= arrangeHere(source, true, builder);
      arranged ??= builder(aligned.site, opts);
    };
    const preservesIdentity = (site: typeof source) => {
      expect(site.groups.map(identity)).toEqual(source.groups.map(identity));
      for (const original of source.groups.filter((g) => g.limitsLocked))
        expect(site.groups.find((g) => g.id === original.id)!.limits).toEqual(original.limits);
    };
    it(`${fixture.id}: Arrange`, () => {
      ensureArranged();
      expect(addsLayoutViolations(baseline, arranged)).toBe(false);
      expect(scoreBuild(arranged).unconnected).toBeLessThanOrEqual(scoreBuild(baseline).unconnected);
      preservesIdentity(aligned.site as typeof source);
    }, 20000);
    it(`${fixture.id}: Arrange is idempotent`, () => {
      ensureArranged();
      expect(arrangeHere(aligned.site, true, builder).site).toEqual(aligned.site);
    }, 20000);
    it(`${fixture.id}: Optimize`, () => {
      ensureArranged();
      const optimized = arrangeHere(source, true, builder, true, {
        seeds: 1,
        iterations: 60,
        refineRuns: 1,
        refineSteps: 3,
        reshape: false,
        budgetMs: 1500,
      });
      const result = builder(optimized.site, opts);
      expect(addsLayoutViolations(baseline, result)).toBe(false);
      expect(better(scoreBuild(baseline), scoreBuild(result))).toBe(false);
      preservesIdentity(optimized.site as typeof source);
      if (optimized.optimized?.improved) {
        expect(optimized.site.groups.map((g) => g.origin[1])).toEqual(
          aligned.site.groups.map((g) => g.origin[1]),
        );
      }
      measurements.push({
        id: fixture.id,
        arrangeRejected: !!aligned.rejected,
        optimizeImproved: !!optimized.optimized?.improved,
        original: scoreBuild(baseline),
        arranged: scoreBuild(arranged),
        optimized: scoreBuild(result),
      });
      console.log(JSON.stringify(measurements[measurements.length - 1]));
      if (measurements.length === 5 && process.env.RECORD_STAGE5)
        writeFileSync(
          'docs/fixtures/stage-5-command-metrics.json',
          JSON.stringify(measurements, null, 2) + '\n',
        );
    }, 20000);
  }
});
