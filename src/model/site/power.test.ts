import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { singleMachineLook } from '../../data/generic';
import { parseMachineLookId } from '../../data/single-machines';
import { siteFromJson } from '../../share/siteCodec';
import type { Dir, Rotation, Tier } from '../core/types';
import { key, step } from '../geometry';
import { createSiteBuilder } from './build';
import { analysePower, isTransformer, transformerHatchOnFront, transformerTiers } from './power';
import type { SiteGroup, SiteState, TransformerAmps } from './types';

const noLimits = { x: null, y: 1, z: null };

function group(id: string, origin: [number, number], extra: Partial<SiteGroup> = {}): SiteGroup {
  return {
    id,
    multiblockId: 'single-block',
    count: 1,
    limits: noLimits,
    enabledHatches: [],
    origin,
    rotation: 0,
    ...extra,
  };
}

const transformer = (id: string, origin: [number, number], extra: Partial<SiteGroup> = {}) =>
  group(id, origin, { machine: 'transformer', tier: 'HV', ...extra });

function site(groups: SiteGroup[], links: [string, string, string][], resources = ['hv', 'mv']): SiteState {
  return {
    v: 1,
    kind: 'site',
    size: [40, 30],
    corridor: 2,
    groups,
    links: links.map(([from, to, resource], i) => ({
      id: `l${i}`,
      from: { group: from },
      to: { group: to },
      resource: `power:${resource}`,
    })),
    ports: [],
    resources: Object.fromEntries(
      resources.map((r) => [`power:${r}`, { kind: 'power' as const, name: r, color: '#ffee00' }]),
    ),
    colors: {},
  };
}

describe('tiered looks', () => {
  it('picks the block of the machine in its tier, else the old one', () => {
    expect(singleMachineLook('macerator')).toBe('site.machine.macerator');
    expect(singleMachineLook('macerator', 'IV')).toBe('site.machine.macerator@IV');
    expect(singleMachineLook('tank', 'UV')).toBe('site.machine.tank');
    expect(parseMachineLookId('site.machine.macerator@IV')).toMatchObject({ tier: 'IV' });
    expect(parseMachineLookId('site.machine.tank@UV')).toBeUndefined();
    expect(parseMachineLookId('site.machine.macerator')).toBeUndefined();
  });

  it('picks the transformer of its step and amperage', () => {
    expect(singleMachineLook('transformer', 'HV')).toBe('site.machine.transformer@HV:down:4');
    expect(singleMachineLook('transformer', 'EV', 'up', 64)).toBe('site.machine.transformer@EV:up:64');
    // Hi-Amp below UEV does not exist: drawn as 4 amps.
    expect(singleMachineLook('transformer', 'IV', 'down', 16)).toBe('site.machine.transformer@IV:down:4');
    expect(singleMachineLook('transformer', 'UEV', 'down', 16)).toBe('site.machine.transformer@UEV:down:16');
    expect(singleMachineLook('transformer')).toBe('site.machine.transformer');
    expect(parseMachineLookId('site.machine.transformer@UEV:up:16')).toMatchObject({ step: 'up', amps: 16 });
    expect(parseMachineLookId('site.machine.transformer@IV:down:16')).toBeUndefined();
    expect(parseMachineLookId('site.machine.transformer@HV')).toBeUndefined();
  });

  it('draws the group with its tiered block, a transformer facing the way its rotation says', () => {
    const facing = (rotation: Rotation, step?: 'up' | 'down') => {
      const s = site(
        [
          transformer('t', [10, 10], { rotation, step }),
          group('m', [20, 10], { machine: 'macerator', tier: 'EV' }),
        ],
        [],
      );
      const b = createSiteBuilder()(s, { pipes: false, cables: false });
      expect(b.scene.voxels.find((v) => v.blockId.startsWith('site.machine.macerator'))!.blockId).toBe(
        'site.machine.macerator@EV',
      );
      return b.scene.voxels.find((v) => v.blockId.startsWith('site.machine.transformer'))!;
    };
    const seen = new Set<Dir>();
    for (const r of [0, 1, 2, 3] as Rotation[]) {
      const down = facing(r);
      const up = facing(r, 'up');
      expect(down.blockId).toBe('site.machine.transformer@HV:down:4');
      expect(up.blockId).toBe('site.machine.transformer@HV:up:4');
      // The front is the same face for both steps: only the overlays differ.
      expect(up.facing).toBe(down.facing);
      seen.add(down.facing!);
    }
    expect(seen.size).toBe(4);
  });
});

describe('transformer faces', () => {
  it('puts the input of a step-down transformer on the front and the output on the other faces', () => {
    const down = transformer('t', [0, 0]);
    const up = transformer('t', [0, 0], { step: 'up' });
    expect(transformerHatchOnFront(down, 'energy')).toBe(true);
    expect(transformerHatchOnFront(down, 'dynamo')).toBe(false);
    expect(transformerHatchOnFront(up, 'energy')).toBe(false);
    expect(transformerHatchOnFront(up, 'dynamo')).toBe(true);
    expect(transformerHatchOnFront(down, 'itemIn')).toBeUndefined();
    expect(transformerTiers(down)).toEqual({ input: 'HV', output: 'MV' });
    expect(transformerTiers(up)).toEqual({ input: 'MV', output: 'HV' });
    expect(isTransformer(down)).toBe(true);
    expect(isTransformer(group('x', [0, 0], { machine: 'macerator' }))).toBe(false);
  });

  for (const step of ['down', 'up'] as const)
    it(`routes into and out of a step-${step} transformer by its faces`, () => {
      const s = site(
        [
          group('gen', [4, 10], { machine: 'generator', tier: step === 'down' ? 'HV' : 'MV', rotation: 1 }),
          transformer('t', [14, 10], { step, tier: 'HV' }),
          group('use', [24, 10], { machine: 'macerator', tier: step === 'down' ? 'MV' : 'HV', rotation: 3 }),
        ],
        [
          ['gen', 't', 'hv'],
          ['t', 'use', 'mv'],
        ],
      );
      const b = createSiteBuilder()(s, {
        pipes: false,
        cables: true,
        routing: { style: 'classic', depth: 1 },
      });
      expect(b.warnings.filter((w) => w.type === 'unrouted')).toEqual([]);
      expect(analysePower(s)).toEqual([]);
      const t = b.groups[1];
      const front = b.scene.voxels.find((v) => v.blockId.startsWith('site.machine.transformer'))!.facing!;
      const input = t.hatches.find((h) => h.kind === 'energy')!;
      const output = t.hatches.find((h) => h.kind === 'dynamo')!;
      expect(input.net).toBeDefined();
      expect(output.net).toBeDefined();
      if (step === 'down') {
        expect(input.face).toBe(front);
        expect(output.face).not.toBe(front);
      } else {
        expect(output.face).toBe(front);
        expect(input.face).not.toBe(front);
      }
    });
});

describe('transformer rotation', () => {
  for (const rotation of [0, 1, 2, 3] as Rotation[])
    it(`lands the front cable on the front of a transformer turned ${rotation}`, () => {
      const s = site(
        [
          group('gen', [4, 10], { machine: 'generator', tier: 'HV', rotation: 1 }),
          transformer('t', [14, 10], { rotation }),
          group('use', [24, 10], { machine: 'macerator', tier: 'MV', rotation: 3 }),
        ],
        [
          ['gen', 't', 'hv'],
          ['t', 'use', 'mv'],
        ],
      );
      const b = createSiteBuilder()(s, {
        pipes: false,
        cables: true,
        routing: { style: 'classic', depth: 1 },
      });
      expect(b.warnings.filter((w) => w.type === 'unrouted')).toEqual([]);
      const front = b.scene.voxels.find((v) => v.blockId.startsWith('site.machine.transformer'))!.facing!;
      const input = b.groups[1].hatches.find((h) => h.kind === 'energy')!;
      expect(input.face).toBe(front);
      const net = b.nets.find((n) => n.id === input.net)!;
      const cell = step(input.cell, front);
      expect(net.route!.paths.some((p) => p.some((c) => key(c) === key(cell)))).toBe(true);
    });
});

describe('power tiers', () => {
  const chain = (use: Tier | undefined, extra: Partial<SiteGroup> = {}) =>
    site(
      [
        group('gen', [4, 10], { machine: 'generator', tier: 'HV' }),
        transformer('t', [14, 10], extra),
        group('use', [24, 10], { machine: 'macerator', tier: use }),
      ],
      [
        ['gen', 't', 'hv'],
        ['t', 'use', 'mv'],
      ],
    );

  it('is quiet when every tier fits', () => {
    expect(analysePower(chain('MV'))).toEqual([]);
    expect(analysePower(chain('HV'))).toEqual([]);
    expect(analysePower(chain(undefined))).toEqual([]);
  });

  it('reports a consumer below the tier of its net', () => {
    expect(analysePower(chain('LV'))).toEqual([
      { type: 'powerTier', resource: 'power:mv', expected: 'MV', got: 'LV', group: 'use' },
    ]);
  });

  it('reports a transformer whose input is not the tier of its net', () => {
    expect(analysePower(chain('MV', { tier: 'EV' }))).toEqual([
      { type: 'powerTier', resource: 'power:hv', expected: 'HV', got: 'EV', group: 't' },
      // It gives HV, which an MV machine cannot take.
      { type: 'powerTier', resource: 'power:mv', expected: 'HV', got: 'MV', group: 'use' },
    ]);
    // A step-up one takes the low side.
    expect(analysePower(chain('MV', { tier: 'HV', step: 'up' }))).toEqual([
      { type: 'powerTier', resource: 'power:hv', expected: 'HV', got: 'MV', group: 't' },
      { type: 'powerTier', resource: 'power:mv', expected: 'HV', got: 'MV', group: 'use' },
    ]);
  });

  it('reports a transformer GT does not make', () => {
    const none = (tier: Tier, amps: TransformerAmps) =>
      analysePower(site([transformer('t', [4, 4], { tier, amps })], []));
    expect(none('UEV', 16)).toEqual([]);
    expect(none('IV', 64)).toEqual([]);
    expect(none('IV', 16)).toEqual([{ type: 'transformerInvalid', group: 't', tier: 'IV', amps: 16 }]);
  });

  it('only notes the input net of a transformer whose tier is unknown', () => {
    const s = chain('MV');
    s.groups[0] = group('gen', [4, 10], { machine: 'generator' });
    expect(analysePower(s)).toEqual([{ type: 'powerUnknownTier', resource: 'power:hv' }]);
    // Not when the transformer is one of several consumers, nor on its output net.
    const shared = chain('MV');
    shared.groups[0] = group('gen', [4, 10], { machine: 'generator' });
    shared.groups.push(group('other', [24, 20], { machine: 'macerator', tier: 'HV' }));
    shared.links.push({ id: 'x', from: { group: 'gen' }, to: { group: 'other' }, resource: 'power:hv' });
    expect(analysePower(shared)).toEqual([]);
    const output = chain('HV', { step: 'up' });
    output.groups[0] = group('gen', [4, 10], { machine: 'generator' });
    expect(analysePower(output)).toEqual([{ type: 'powerUnknownTier', resource: 'power:hv' }]);
    const plain = site([group('gen', [4, 10]), group('use', [14, 10])], [['gen', 'use', 'hv']]);
    expect(analysePower(plain)).toEqual([]);
  });
});

describe('earlier sites', () => {
  it('have no transformers, so no power warnings, and keep their looks', () => {
    for (const name of ['site.json']) {
      const text = readFileSync(join(__dirname, '../../share/fixtures', name), 'utf8');
      const s = siteFromJson(text);
      expect(
        s.groups.some((g) => isTransformer(g)),
        name,
      ).toBe(false);
      expect(analysePower(s), name).toEqual([]);
      const b = createSiteBuilder()(s, { pipes: true, cables: true });
      for (const v of b.scene.voxels) expect(v.blockId, name).not.toMatch(/^site.machine..*@/);
    }
  });
});
