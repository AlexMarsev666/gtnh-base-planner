import { describe, expect, it } from 'vitest';
import { arrangeSite } from './arrange';
import { arrangeOnFloors } from '../../import/gtnhplanner';
import { arrangeHere } from '../../ui/siteArrange';
import { createSiteBuilder } from './build';
import { optimizeSite, better } from './optimize';
import { annealGroups } from './anneal';
import { emptySite, siteFromJson, siteToJson, encodeSite, decodeSite } from '../../share/siteCodec';
import type { SiteState } from './types';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import { withGroupPatched } from '../../ui/siteActions';

function pair(): SiteState {
  const site = emptySite();
  site.size = [40, 30];
  site.groups = ['a', 'b'].map((id, i) => ({
    id,
    multiblockId: 'electric-blast-furnace',
    count: 1,
    limits: { x: null, y: 1, z: null },
    enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance', 'muffler'],
    origin: [5 + i * 16, 12],
    rotation: 0,
  }));
  site.resources = { ore: { kind: 'item', name: 'Ore', color: '#123456' } };
  site.links = [{ id: 'l', from: { group: 'a' }, to: { group: 'b' }, resource: 'ore' }];
  return site;
}

const fake =
  (time: () => void = () => {}): SiteBuilder =>
  (site, opts) => {
    if (opts.pipes) time();
    return {
      groups: site.groups.map((g) => ({
        group: g,
        build: { size: [3, 4, 3] },
        min: [g.origin[0], 0, g.origin[1]],
        max: [g.origin[0] + 3, 4, g.origin[1] + 3],
      })),
      warnings: [],
      stats: {
        terminals: 2,
        connected: 2,
        pipeBlocks: site.groups.reduce((n, g) => n + g.origin[0] + g.origin[1], 0),
        cableBlocks: 0,
      },
    } as unknown as SiteBuild;
  };

describe('deterministic commands and iteration schedules', () => {
  it('preserves a chosen seed and packing preferences in files and links; legacy plans retain defaults', async () => {
    const site = pair();
    site.optimizationSeed = 73;
    site.groups[0].arrangeLimits = { x: 2, y: 1, z: null };
    for (const decoded of [siteFromJson(siteToJson(site)), await decodeSite(await encodeSite(site))]) {
      expect(decoded.optimizationSeed).toBe(73);
      expect(decoded.groups[0].arrangeLimits).toEqual(site.groups[0].arrangeLimits);
    }
    expect(siteFromJson(siteToJson(pair())).optimizationSeed).toBeUndefined();
    for (const optimizationSeed of [-1, 0.5, 1000001])
      expect(() => siteFromJson(siteToJson({ ...site, optimizationSeed }))).toThrow();
  });
  it('Arrange uses canonical rotations, not the preceding arrangement', () => {
    const site = pair();
    const changed = {
      ...site,
      groups: site.groups.map((g) => ({ ...g, rotation: 1 as const, origin: [30, 2] as [number, number] })),
    };
    expect(arrangeSite(changed, () => [6, 2]).groups).toEqual(arrangeSite(site, () => [6, 2]).groups);
  });

  it('repeated real Optimize → Arrange returns the same canonical layout', () => {
    const site = pair();
    const build = createSiteBuilder();
    const canonical = arrangeHere(site, true, build).site;
    let current = canonical;
    for (let i = 0; i < 3; i++) {
      current = arrangeHere(current, true, build, true, {
        now: () => 0,
        seeds: 1,
        iterations: 80,
        refineSteps: 4,
        refineRuns: 1,
      }).site;
      const next = arrangeHere(current, true, build).site;
      expect(next).toEqual(canonical);
      current = next;
    }
  });

  it('Arrange is idempotent and recovers user packing preferences after a repack and file round trip', () => {
    const site = pair();
    site.groups[0].count = 4;
    const build = createSiteBuilder();
    const a = arrangeOnFloors(site, build, true).site;
    const changed = {
      ...a,
      groups: a.groups.map((g, i) => ({
        ...g,
        rotation: 1 as const,
        origin: [2 + i * 15, 2] as [number, number],
        ...(i === 0 ? { limits: { x: 1, y: 2, z: 2 }, arrangeLimits: { ...site.groups[0].limits } } : {}),
      })),
    };
    expect(arrangeOnFloors(siteFromJson(siteToJson(changed)), build, true).site).toEqual(a);
    expect(arrangeOnFloors(a, build, true).site).toEqual(a);
    const edited = withGroupPatched(changed, 'a', { limits: { x: 2, y: 1, z: 2 } });
    expect(edited.groups[0].arrangeLimits).toBeUndefined();
  });

  it('the same seed and iteration quotas yield identical completed results with different clocks', () => {
    const site = pair();
    const run = (pace: number) => {
      let time = 0;
      return optimizeSite(
        site,
        fake(() => {
          time += pace;
        }),
        {
          now: () => time,
          budgetMs: 10000,
          reshape: false,
          seedOffset: 17,
          seeds: 2,
          iterations: 200,
          refineSteps: 12,
          refineRuns: 1,
        },
      );
    };
    const fast = run(1),
      slow = run(20);
    expect(slow.site).toEqual(fast.site);
    expect(slow.result).toEqual(fast.result);
    expect(slow.tried).toBe(fast.tried);
    const again = optimizeSite(fast.site, fake(), {
      now: () => 0,
      reshape: false,
      seedOffset: 17,
      seeds: 2,
      iterations: 200,
      refineSteps: 12,
      refineRuns: 1,
    });
    expect(better(fast.result, again.result)).toBe(false);
  });

  it('annealing temperature follows iterations, not elapsed time', () => {
    const site = pair();
    const run = (pace: number) => {
      let time = 0;
      return annealGroups(site, () => [3, 3], {
        seed: 73,
        iterations: 200,
        budgetMs: 100000,
        now: () => (time += pace),
      });
    };
    expect(run(20).groups).toEqual(run(1).groups);
  });

  it('does not publish a timing-dependent partial search when its safety deadline interrupts it', () => {
    const site = pair();
    let time = 0;
    const r = optimizeSite(
      site,
      fake(() => {
        time += 400;
      }),
      { now: () => time, budgetMs: 1000, reshape: false, iterations: 200, refineSteps: 20, refineRuns: 1 },
    );
    expect(r.site).toBe(site);
    expect(r.improved).toBe(false);
    expect(r.stopped).toBe('time-limit');
  });

  it('Optimize does not arrange or modify the document when the score cannot improve', () => {
    const site = pair();
    const constant: SiteBuilder = (s, opts) => {
      const built = fake()(s, opts);
      built.stats.pipeBlocks = 5;
      // Make every physical layout tie, including footprint compactness.
      built.groups.forEach((g) => {
        g.min = [0, 0, 0];
        g.max = [3, 4, 3];
      });
      return built;
    };
    const r = arrangeHere(site, true, constant, true, {
      now: () => 0,
      reshape: false,
      iterations: 20,
      refineSteps: 4,
      refineRuns: 1,
    });
    expect(r.site).toBe(site);
    expect(r.optimized?.improved).toBe(false);
  });

  it('does not apply an improvement that would make the next canonical Arrange unsafe', () => {
    const source = arrangeOnFloors(pair(), fake(), true).site;
    const collision = source.groups[0].origin;
    const builder: SiteBuilder = (s, opts) => {
      const built = fake()(s, opts);
      if (s.groups[0].origin[0] === collision[0] && s.groups[0].origin[1] === collision[1])
        built.warnings = [{ type: 'noport', port: 'pinned' }];
      return built;
    };
    const optimized = arrangeHere(source, true, builder, true, {
      now: () => 0,
      reshape: false,
      seeds: 2,
      iterations: 200,
      refineSteps: 12,
      refineRuns: 1,
    });
    expect(arrangeHere(optimized.site, true, builder).site).toEqual(arrangeHere(source, true, builder).site);
  });
});
