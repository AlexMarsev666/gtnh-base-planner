import { describe, expect, it } from 'vitest';
import { TRANSFORMER_DEF } from '../../data/generic';
import { buildGroup } from './group';
import { TRANSFORMER_TIERS, VOLTAGE_TIERS } from '../tiers';
import type { Dir } from '../core/types';
import { createSiteBuilder } from './build';
import { emptySite } from '../../share/siteCodec';
import { requiredBlocks } from '../bom';
import type { SiteGroup } from './types';

const dirs: Dir[] = ['north', 'east', 'south', 'west', 'up', 'down'];
const limits = { x: 1, y: 1, z: 1 };

describe('RC2 transformer sides', () => {
  for (const lowTier of TRANSFORMER_TIERS)
    for (const mode of ['up', 'down'] as const)
      for (const facing of dirs) {
        it(`${lowTier}, ${mode}, high side ${facing}`, () => {
          const group = buildGroup(
            TRANSFORMER_DEF,
            1,
            limits,
            [],
            { energy: ['eu'], dynamo: ['eu'] },
            true,
            {},
            { transformer: { lowTier, mode, facing } },
          );
          const input = group.hatches.find((h) => h.kind === 'energy')!;
          const output = group.hatches.find((h) => h.kind === 'dynamo')!;
          const high = mode === 'down' ? input : output;
          const low = mode === 'down' ? output : input;
          expect(high.allowedFaces).toEqual([facing]);
          expect(high.tier).toBe(VOLTAGE_TIERS[VOLTAGE_TIERS.indexOf(lowTier) + 1]);
          expect(low.allowedFaces).toHaveLength(5);
          expect(low.allowedFaces).not.toContain(facing);
          expect(low.tier).toBe(lowTier);
        });
      }
  it('keeps two networks around a transformer, preserves an incompatible link and reports its tiers', () => {
    const make = (id: string, multiblockId: string, x: number): SiteGroup => ({
      id,
      multiblockId,
      count: 1,
      origin: [x, 3],
      rotation: 0,
      limits,
      enabledHatches: [],
    });
    const tr = {
      ...make('tr', 'transformer', 4),
      transformer: { lowTier: 'LV' as const, mode: 'down' as const, facing: 'west' as const },
    };
    const source = { ...make('source', 'single-block', 1), voltageTier: 'HV' as const };
    const sink = { ...make('sink', 'single-block', 8), voltageTier: 'LV' as const };
    const site = {
      ...emptySite(),
      routing: { mode: 'compact' as const, depth: 3 },
      groups: [source, tr, sink],
      resources: { eu: { kind: 'power' as const, name: 'EU', color: '#123456' } },
      links: [
        { id: 'l1', resource: 'eu', from: { group: 'source' }, to: { group: 'tr' } },
        { id: 'l2', resource: 'eu', from: { group: 'tr' }, to: { group: 'sink' } },
      ],
    };
    const before = JSON.stringify(site);
    const build = createSiteBuilder()(site, { pipes: true, cables: true, below: true });
    expect(build.nets).toHaveLength(2);
    expect(build.nets.map((n) => n.links)).toEqual([['l1'], ['l2']]);
    expect(build.warnings.some((w) => w.type === 'error' && w.message.includes('HV, MV'))).toBe(true);
    expect(JSON.stringify(site)).toBe(before);
    expect(build.scene.voxels.find((v) => v.blockId.startsWith('site.transformer.'))?.facing).toBe('west');
    expect(
      requiredBlocks(build.scene).blocks.find((b) => b.blockId.startsWith('site.transformer.'))?.count,
    ).toBe(1);
  });
});
