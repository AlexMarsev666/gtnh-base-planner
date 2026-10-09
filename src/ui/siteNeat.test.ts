import { describe, expect, it } from 'vitest';
import { createSiteBuilder } from '../model/site/build';
import type { SiteBuilder } from '../model/site/buildTypes';
import { referencePlans } from '../model/site/fixtures/referencePlans';
import { addsLayoutViolations, layoutViolations } from '../model/site/layoutViolations';
import { scoreBuild } from '../model/site/optimize';
import type { SiteGroup } from '../model/site/types';
import { arrangeHere } from './siteArrange';

const opts = { pipes: true, cables: true, below: false };
const unchanged = ({ origin: _origin, rotation: _rotation, elevation: _elevation, ...g }: SiteGroup) => g;

describe('Neat command', () => {
  for (const fixture of referencePlans()) {
    const source = structuredClone(fixture.site);
    if (fixture.id.startsWith('04')) {
      source.groups[0].resourceBindings![0].unitId = 0;
      source.groups[0].resourceBindings![1].unitId = 1;
      source.groups[0].resourceBindings![2].unitIds = [0, 1];
      source.groups[0].hatchTiers = { '[0,"fluidIn","feed-a",0]': 'EV' };
    }
    if (fixture.id.startsWith('01')) delete source.routing;
    else source.routing = { mode: 'compact', depth: 4 };
    const snapshot = structuredClone(source);
    const raw = createSiteBuilder();
    const cache = new Map<string, ReturnType<SiteBuilder>>();
    const builder: SiteBuilder = (s, o) => {
      if (!o.pipes || !o.cables) return raw(s, o);
      const key = JSON.stringify(s);
      if (!cache.has(key)) cache.set(key, raw(s, o));
      return cache.get(key)!;
    };
    let baseline: ReturnType<SiteBuilder>;
    let result: ReturnType<typeof arrangeHere>;
    const ensureBaseline = () => (baseline ??= builder(source, opts));
    const ensureResult = () => (result ??= arrangeHere(source, false, builder, false, undefined, true));
    it(`${fixture.id}: original routed baseline`, () => {
      expect(layoutViolations(ensureBaseline())).toEqual([]);
    }, 20000);
    it(`${fixture.id}: aligns and routes without changing group settings`, () => {
      ensureBaseline();
      ensureResult();
      expect(result.rejected).not.toBe(true);
      expect(result.fits).toBe(true);
      expect(result.site.routing).toEqual({ mode: 'neat', depth: source.routing?.depth ?? 3 });
      expect(result.site.size).toEqual(source.size);
      expect(result.site.groups.map(unchanged)).toEqual(source.groups.map(unchanged));
      expect(result.site.ports).toEqual(source.ports);
      expect(result.site.links).toEqual(source.links);
      expect(result.optimized).toBeUndefined();
      const final = builder(result.site, opts);
      expect(layoutViolations(final)).toEqual([]);
      expect(addsLayoutViolations(baseline, final)).toBe(false);
      expect(scoreBuild(final).unconnected).toBe(0);
      if (fixture.id.startsWith('04')) {
        const hatches = final.groups[0].hatches;
        expect(hatches.find((h) => h.resource === 'feed-a')?.tier).toBe('EV');
        expect(hatches.find((h) => h.resource === 'agent')?.unitIds).toHaveLength(2);
      }
      expect(result.routingSummary).toEqual({
        bends: final.stats.bends,
        surface: final.stats.surfaceBlocks,
        length: final.stats.pipeBlocks + final.stats.cableBlocks,
        unconnected: 0,
      });
      expect(source).toEqual(snapshot);
    }, 20000);
    it(`${fixture.id}: is idempotent`, () => {
      ensureResult();
      expect(arrangeHere(result.site, false, builder, false, undefined, true)).toEqual(result);
    }, 20000);
  }

  it.each(['structure', 'connections'] as const)(
    'rejects a %s regression caused by the mode change',
    (kind) => {
      const source = referencePlans()[1].site;
      delete source.routing;
      const raw = createSiteBuilder();
      const builder: SiteBuilder = (s, o) => {
        const built = raw(s, { ...o, pipes: false, cables: false });
        built.stats.terminals = 2;
        built.stats.connected = s.routing?.mode === 'neat' && kind === 'connections' ? 1 : 2;
        if (s.routing?.mode === 'neat' && kind === 'structure')
          built.warnings.push({
            type: 'error',
            group: 'reactor',
            code: 'structure',
            message: 'blocked hatch',
          });
        return built;
      };
      const result = arrangeHere(source, false, builder, false, undefined, true);
      expect(result.rejected).toBe(true);
      expect(result.site).toBe(source);
      expect(result.site.routing).toBeUndefined();
      expect(result.routingSummary).toBeUndefined();
    },
  );

  it('retains even unlocked limits instead of repacking a group that cannot fit', () => {
    const source = referencePlans()[4].site;
    source.size = [8, 8];
    source.groups[0].limitsLocked = false;
    const result = arrangeHere(source, false, createSiteBuilder(), false, undefined, true);
    expect(result.fits).toBe(false);
    expect(result.site).toBe(source);
    expect(result.site.groups[0].limits).toEqual({ x: 4, y: 1, z: 1 });
    expect(result.routingSummary).toBeUndefined();
  });
});
