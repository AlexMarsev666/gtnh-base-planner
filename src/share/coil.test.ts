import { describe, expect, it } from 'vitest';
import { COILS } from '../data/coils';
import type { SiteState } from '../model/site/types';
import { defaultPlan } from '../state/store';
import { deflateRaw, toBase64Url } from './binary';
import { PlanFormatError, decodePlan, encodePlan, validatePlanState } from './codec';
import { planFromJson, planToJson } from './persist';
import { decodeSite, emptySite, encodeSite, siteFromJson, siteToJson, validateSiteState } from './siteCodec';

/** The heating coil of a plan (`coil`, link key `o`) and of a template group (`coil`). */

async function rawLink(data: unknown): Promise<string> {
  return toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(data))));
}

const plan = () => ({ ...defaultPlan('electric-blast-furnace'), coil: 'hypogen' });

function site(group: Record<string, unknown> = {}): SiteState {
  return {
    ...emptySite(),
    groups: [
      {
        id: 'g',
        multiblockId: 'electric-blast-furnace',
        count: 2,
        limits: { x: null, y: null, z: null },
        enabledHatches: [],
        origin: [2, 2],
        rotation: 0,
        ...group,
      },
    ],
  } as SiteState;
}

describe('plan coil', () => {
  it('round-trips through JSON and a link, the link carrying the index under `o`', async () => {
    expect(planFromJson(planToJson(plan()))).toEqual(plan());
    expect(await decodePlan(await encodePlan(plan()))).toEqual(plan());
    const index = COILS.findIndex((c) => c.id === 'hypogen');
    const link = await rawLink({ v: 1, m: 'electric-blast-furnace', h: 0, o: index });
    expect(await decodePlan(link)).toMatchObject({ coil: 'hypogen' });
  });

  it('writes nothing when unset, so old links stay byte-identical', async () => {
    const plain = defaultPlan('electric-blast-furnace');
    expect(await encodePlan({ ...plain })).toBe(await encodePlan(plain));
    expect(Object.keys(validatePlanState(plain))).not.toContain('coil');
    expect(await encodePlan(plan())).not.toBe(await encodePlan(plain));
  });

  it('pins the link index of every coil', () => {
    expect(COILS.map((c) => c.id)).toEqual([
      'cupronickel',
      'kanthal',
      'nichrome',
      'tpv',
      'hss-g',
      'naquadah',
      'naquadah-alloy',
      'fluxed-electrum',
      'awakened-draconium',
      'hss-s',
      'trinium',
      'infinity',
      'hypogen',
      'eternal',
    ]);
  });

  it('decodes o:0 as cupronickel and o:13 as eternal', async () => {
    for (const [o, coil] of [
      [0, 'cupronickel'],
      [13, 'eternal'],
    ] as const)
      expect(await decodePlan(await rawLink({ v: 1, m: 'electric-blast-furnace', h: 0, o }))).toMatchObject({
        coil,
      });
  });

  it('rejects an unknown coil', async () => {
    for (const coil of ['bedrock', 3, '', {}])
      expect(() => validatePlanState({ ...defaultPlan(), coil })).toThrow(PlanFormatError);
    for (const o of [-1, COILS.length, 1.5, 'x']) {
      const link = await rawLink({ v: 1, m: 'electric-blast-furnace', h: 0, o });
      await expect(decodePlan(link), String(o)).rejects.toThrow(PlanFormatError);
    }
  });
});

describe('site group coil', () => {
  it('round-trips through JSON and a link', async () => {
    const s = site({ coil: 'eternal' });
    expect(validateSiteState(s).groups[0].coil).toBe('eternal');
    expect(siteFromJson(siteToJson(s))).toEqual(s);
    expect(await decodeSite(await encodeSite(s))).toEqual(s);
  });

  it('is left out when unset, and dropped (not refused) when unknown', () => {
    expect('coil' in validateSiteState(site()).groups[0]).toBe(false);
    const g = validateSiteState(site({ coil: 'bedrock', count: 3 })).groups[0];
    expect('coil' in g).toBe(false);
    expect(g.count).toBe(3);
  });
});
