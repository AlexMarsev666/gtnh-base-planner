import { describe, expect, it } from 'vitest';
import { createSiteBuilder } from './build';
import { emptySite, validateSiteState } from '../../share/siteCodec';
import { undergroundScene } from '../render/underground';

describe('underground routing', () => {
  for (const depth of [1, 3, 6])
    it(`routes at the configured depth ${depth} without shortening it silently`, () => {
      const site = validateSiteState({
        ...emptySite(),
        size: [40, 20],
        routing: { mode: 'neat', depth },
        resources: { item: { kind: 'item', name: 'Item', color: '#123456' } },
        groups: [
          {
            id: 'g1',
            multiblockId: 'single-block',
            count: 1,
            limits: { x: 1, y: 1, z: 1 },
            origin: [30, 10],
            rotation: 0,
            enabledHatches: [],
          },
        ],
        ports: [{ id: 'p1', dir: 'in', resource: 'item', pos: [0, 10] }],
        links: [{ id: 'l1', from: { port: 'p1' }, to: { group: 'g1' }, resource: 'item' }],
      });
      const build = createSiteBuilder()(site, { pipes: true, cables: true });
      expect(build.stats.connected).toBe(build.stats.terminals);
      const cells = build.nets.flatMap((n) => n.route!.paths.flat());
      expect(Math.min(...cells.map((p) => p[1]))).toBe(-depth);
      expect(cells.filter((p) => p[1] === -depth).length).toBeGreaterThan(20);
      const cut = undergroundScene(build.scene);
      expect(cut.voxels).toEqual([]);
      expect(cut.site).toBeUndefined();
      expect(cut.pipes!.every((p) => p.paths.flat().every((p) => p[1] < 0))).toBe(true);
      expect(build.scene.voxels.length).toBeGreaterThan(0);
      expect(site.routing?.depth).toBe(depth);
    });
});
