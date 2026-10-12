import { describe, expect, it } from 'vitest';
import type { Unit } from '../model/multiblock/types';
import type { PlanState } from '../model/plan/types';
import { defaultPlan } from '../state/store';
import { deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from './binary';
import { HATCH_KINDS, PlanFormatError, decodePlan, encodePlan, plansEqual, validatePlanState } from './codec';

function manualPlan(n: number): PlanState {
  const units: Unit[] = Array.from({ length: n }, (_, i) => ({
    id: i,
    origin: [(i % 8) * 2 - 7, Math.floor(i / 64) * 2, Math.floor((i % 64) / 8) * 2 - 300],
    rotation: (i % 4) as Unit['rotation'],
  }));
  return {
    ...defaultPlan(),
    count: n,
    limits: { x: 64, y: null, z: 17 },
    enabledHatches: ['fluidOut', 'itemIn'],
    colors: { itemIn: '#ff8800', fluidOut: '#00AAFF' },
    manualUnits: units,
  };
}

/** Encodes arbitrary JSON the same way `encodePlan` does, for crafting hostile links. */
async function rawLink(data: unknown): Promise<string> {
  return toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(data))));
}

describe('encodePlan / decodePlan', () => {
  it('round-trips the default plan in a tiny fragment', async () => {
    const plan = defaultPlan();
    const encoded = await encodePlan(plan);
    expect(`#p=${encoded}`.length).toBeLessThan(200);
    expect(await decodePlan(encoded)).toEqual(plan);
  });

  it('round-trips a size and snaps it to one the multiblock can take', async () => {
    const plan = { ...defaultPlan('distillation-tower'), size: 9 };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    // Old links have no size: the default applies.
    const old = defaultPlan('distillation-tower');
    expect((await decodePlan(await encodePlan(old))).size).toBeUndefined();
    expect(validatePlanState({ ...old, size: 40 }).size).toBe(12);
    // Fixed-size multiblocks drop it.
    expect(validatePlanState({ ...defaultPlan(), size: 5 }).size).toBeUndefined();
    expect(() => validatePlanState({ ...old, size: 1.5 })).toThrow(PlanFormatError);
  });

  it('round-trips a 60-unit manual plan under the Discord limit', async () => {
    const plan = manualPlan(60);
    const encoded = await encodePlan(plan);
    expect(`#p=${encoded}`.length).toBeLessThan(2000);
    const decoded = await decodePlan(encoded);
    expect(plansEqual(decoded, plan)).toBe(true);
    expect(decoded.manualUnits).toEqual(plan.manualUnits);
    expect(decoded.colors).toEqual({ itemIn: '#ff8800', fluidOut: '#00aaff' });
    expect(decoded.limits).toEqual(plan.limits);
    expect(decoded.enabledHatches).toEqual(['itemIn', 'fluidOut']);
  });

  it('keeps non-sequential unit ids, empty hatch lists and all limits', async () => {
    const plan: PlanState = {
      ...defaultPlan(),
      count: 200,
      limits: { x: 1, y: 200, z: 3 },
      enabledHatches: [],
      manualUnits: [
        { id: 7, origin: [-512, 0, 512], rotation: 3 },
        { id: 2, origin: [0, 0, 0], rotation: 0 },
      ],
    };
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
  });

  it('works with the fflate fallback in both directions', async () => {
    const plan = manualPlan(12);
    const viaFallback = await encodePlan(plan, { fallback: true });
    expect(await decodePlan(viaFallback)).toEqual(await decodePlan(await encodePlan(plan)));
    expect(await decodePlan(await encodePlan(plan), { fallback: true })).toEqual(validatePlanState(plan));
  });

  it('produces URL-safe output only', async () => {
    const encoded = await encodePlan(manualPlan(30));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects malformed base64', async () => {
    await expect(decodePlan('abc$def')).rejects.toThrow(PlanFormatError);
    await expect(decodePlan('a')).rejects.toThrow(PlanFormatError);
    await expect(decodePlan('')).rejects.toThrow(PlanFormatError);
    await expect(decodePlan('abc+/=')).rejects.toThrow(PlanFormatError);
  });

  it('rejects data that is not deflate, not UTF-8 or not JSON', async () => {
    await expect(decodePlan(toBase64Url(new Uint8Array([0xff, 0xff, 0xff])))).rejects.toThrow(
      PlanFormatError,
    );
    for (const fallback of [false, true]) {
      await expect(decodePlan('SGVsbG8', { fallback })).rejects.toThrow(PlanFormatError);
    }
    const notUtf8 = toBase64Url(await deflateRaw(new Uint8Array([0xc3, 0x28])));
    await expect(decodePlan(notUtf8)).rejects.toThrow(/not text/);
    const notJson = toBase64Url(await deflateRaw(new TextEncoder().encode('{nope')));
    await expect(decodePlan(notJson)).rejects.toThrow(/not JSON/);
  });

  it('rejects truncated links', async () => {
    const encoded = await encodePlan(manualPlan(40));
    await expect(decodePlan(encoded.slice(0, encoded.length / 2))).rejects.toThrow(PlanFormatError);
  });

  it('rejects oversize input and decompression bombs', async () => {
    await expect(decodePlan('A'.repeat(64 * 1024 + 4))).rejects.toThrow(/too long/);
    const bomb = toBase64Url(await deflateRaw(new Uint8Array(200 * 1024).fill(0x20)));
    expect(bomb.length).toBeLessThan(2000);
    for (const fallback of [false, true]) {
      await expect(decodePlan(bomb, { fallback })).rejects.toThrow(/too large/);
    }
  });

  it('rejects a wrong version', async () => {
    await expect(decodePlan(await rawLink({ v: 2, m: 'coke-oven' }))).rejects.toThrow(/version 2/);
    await expect(decodePlan(await rawLink({ m: 'coke-oven' }))).rejects.toThrow(/version/);
  });

  it('rejects XSS-like and unknown multiblock ids', async () => {
    for (const m of ['<img src=x onerror=alert(1)>', 'Coke-Oven', 'no-such-machine', 5, '']) {
      await expect(decodePlan(await rawLink({ v: 1, m, h: 7 }))).rejects.toThrow(PlanFormatError);
    }
  });

  it('accepts a minimal hand-made link and requires the hatch mask', async () => {
    expect(await decodePlan(await rawLink({ v: 1, m: 'coke-oven', h: 7 }))).toEqual({
      ...defaultPlan(),
      enabledHatches: ['itemIn', 'itemOut', 'fluidIn'],
    });
    await expect(decodePlan(await rawLink({ v: 1, m: 'coke-oven' }))).rejects.toThrow(/Hatch mask/);
  });

  it('rejects bad compact fields', async () => {
    const bad: Record<string, unknown>[] = [
      { n: 0 },
      { n: 2001 },
      { n: 2.5 },
      { n: '4' },
      { l: [2001, 0, 0] },
      { l: [-1, 0, 0] },
      { l: [1, 2] },
      { h: 1024 },
      { s: 0 },
      { s: 2.5 },
      { h: -1 },
      { c: { '0': 'red' } },
      { c: { '0': '"><script>' } },
      { c: { '10': 'ffffff' } },
      { c: { '09': 'ffffff' } },
      { u: [0, 0, 0] },
      { u: [0, 0, 4097, 0] },
      { u: [0, 0, 0, 4] },
      { u: [0, 0, 0.5, 0] },
      { u: [0, 0, 0, 0], i: [1, 2] },
      { u: [0, 0, 0, 0, 1, 1, 1, 1], i: [3, 3] },
      { i: [0] },
      { x: 1 },
    ];
    for (const extra of bad) {
      await expect(
        decodePlan(await rawLink({ v: 1, m: 'coke-oven', h: 7, ...extra })),
        JSON.stringify(extra),
      ).rejects.toThrow(PlanFormatError);
    }
  });

  it('rejects prototype keys', async () => {
    for (const text of [
      '{"v":1,"m":"coke-oven","h":7,"c":{"__proto__":"ffffff"}}',
      '{"v":1,"m":"coke-oven","h":7,"__proto__":{"n":5}}',
    ]) {
      const link = toBase64Url(await deflateRaw(new TextEncoder().encode(text)));
      await expect(decodePlan(link)).rejects.toThrow(PlanFormatError);
    }
    expect(() =>
      validatePlanState(
        JSON.parse(
          `{"v":1,"multiblockId":"coke-oven","count":4,"limits":{},"enabledHatches":[],"colors":{"__proto__":"#ffffff"}}`,
        ),
      ),
    ).toThrow(PlanFormatError);
  });

  it('rejects non-object payloads', async () => {
    for (const data of [null, [1, 'coke-oven'], 'plan', 42]) {
      await expect(decodePlan(await rawLink(data))).rejects.toThrow(PlanFormatError);
    }
  });
});

describe('validatePlanState', () => {
  const base = (): Record<string, unknown> => ({ ...defaultPlan() });

  it('accepts and normalises a valid plan', () => {
    const plan = validatePlanState({
      ...base(),
      enabledHatches: ['fluidOut', 'itemIn'],
      colors: { itemOut: '#ABCDEF' },
      manualUnits: [],
      extra: 'ignored',
    });
    expect(plan).toEqual({
      ...defaultPlan(),
      enabledHatches: ['itemIn', 'fluidOut'],
      colors: { itemOut: '#abcdef' },
    });
    expect('manualUnits' in plan).toBe(false);
  });

  it('rejects wrong types and out-of-range numbers', () => {
    const cases: Record<string, unknown>[] = [
      { v: 2 },
      { multiblockId: '../../etc' },
      { multiblockId: 'javascript:alert(1)' },
      { multiblockId: 'x'.repeat(65) },
      { count: 0 },
      { count: 2001 },
      { count: Number.NaN },
      { count: Infinity },
      { limits: null },
      { limits: { x: 0, y: null, z: null } },
      { limits: { x: 2001, y: null, z: null } },
      { limits: { x: '5', y: null, z: null } },
      { enabledHatches: ['itemIn', 'itemIn'] },
      { enabledHatches: ['<b>'] },
      { enabledHatches: 'itemIn' },
      { colors: { itemIn: 'red' } },
      { colors: { itemIn: '#fff' } },
      { colors: { itemIn: '#ffffff;background:url(x)' } },
      { colors: { toString: '#ffffff' } },
      { manualUnits: [{ id: 0, origin: [0, 0], rotation: 0 }] },
      { manualUnits: [{ id: 0, origin: [0, 0, 5000], rotation: 0 }] },
      { manualUnits: [{ id: 0, origin: [0, 0, 0], rotation: 4 }] },
      { manualUnits: [{ id: -1, origin: [0, 0, 0], rotation: 0 }] },
      { manualUnits: 'none' },
      {
        manualUnits: Array.from({ length: 2001 }, (_, id) => ({ id, origin: [0, 0, 0], rotation: 0 })),
      },
    ];
    for (const patch of cases) {
      expect(() => validatePlanState({ ...base(), ...patch }), JSON.stringify(patch)).toThrow(
        PlanFormatError,
      );
    }
  });

  it('rejects anything that is not plain data', () => {
    class Fake {
      v = 1;
    }
    expect(() => validatePlanState(new Fake())).toThrow(PlanFormatError);
    expect(() => validatePlanState(null)).toThrow(PlanFormatError);
    expect(() => validatePlanState([])).toThrow(PlanFormatError);
    const withGetter = base();
    Object.defineProperty(withGetter, 'count', { get: () => 4, enumerable: true });
    expect(() => validatePlanState(withGetter)).toThrow(/plain data/);
    expect(() => validatePlanState({ ...base(), limits: new Map() })).toThrow(PlanFormatError);
  });

  it('knows every hatch kind exactly once', () => {
    expect(new Set(HATCH_KINDS).size).toBe(HATCH_KINDS.length);
  });

  it('only ever appends hatch kinds, so a link keeps its bits', () => {
    // Links made before the Data Access Hatch have the nine older kinds in bits 0 to 8.
    expect(HATCH_KINDS.slice(0, 9)).toEqual([
      'itemIn',
      'itemOut',
      'fluidIn',
      'fluidOut',
      'energy',
      'dynamo',
      'maintenance',
      'muffler',
      'steamIn',
    ]);
    expect(HATCH_KINDS[9]).toBe('dataAccess');
  });

  it('decodes a link whose hatch mask has no Data Access bit (at most 511)', async () => {
    const all = await decodePlan(await rawLink({ v: 1, m: 'coke-oven', h: 511, c: { '8': 'c9b99a' } }));
    expect(all.enabledHatches).toEqual(HATCH_KINDS.slice(0, 9));
    expect(all.colors).toEqual({ steamIn: '#c9b99a' });
    const some = await decodePlan(await rawLink({ v: 1, m: 'coke-oven', h: 3 }));
    expect(some.enabledHatches).toEqual(['itemIn', 'itemOut']);
  });

  it('round-trips the Data Access Hatch and its colour', async () => {
    const plan: PlanState = {
      ...defaultPlan('assembly-line'),
      enabledHatches: ['itemOut', 'dataAccess'],
      colors: { dataAccess: '#3fc9b0' },
    };
    const link = await encodePlan(plan);
    const decoded = await decodePlan(link);
    expect(decoded.enabledHatches).toEqual(['itemOut', 'dataAccess']);
    expect(decoded.colors).toEqual({ dataAccess: '#3fc9b0' });
    expect(plansEqual(decoded, plan)).toBe(true);
    // The bit and the colour key sit right after the older kinds.
    const raw = JSON.parse(new TextDecoder().decode(await inflateRaw(fromBase64Url(link))));
    expect(raw.h).toBe((1 << 1) | (1 << 9));
    expect(raw.c).toEqual({ '9': '3fc9b0' });
  });
});

describe('plansEqual', () => {
  it('ignores hatch order, colour case and empty manual lists', () => {
    const a = defaultPlan();
    const b: PlanState = {
      ...defaultPlan(),
      enabledHatches: [...a.enabledHatches].reverse(),
      manualUnits: [],
    };
    expect(plansEqual(a, b)).toBe(true);
    expect(plansEqual({ ...a, colors: { itemIn: '#AABBCC' } }, { ...a, colors: { itemIn: '#aabbcc' } })).toBe(
      true,
    );
  });

  it('detects real differences', () => {
    const a = defaultPlan();
    expect(plansEqual(a, { ...a, count: 5 })).toBe(false);
    expect(plansEqual(a, { ...a, limits: { x: 9, y: null, z: null } })).toBe(false);
    expect(plansEqual(a, { ...a, enabledHatches: [] })).toBe(false);
    expect(plansEqual(manualPlan(3), manualPlan(4))).toBe(false);
  });
});

describe('binary helpers', () => {
  it('base64url round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('inflates what it deflates with either implementation', async () => {
    const data = new TextEncoder().encode('hello hello hello hello');
    for (const a of [false, true]) {
      for (const b of [false, true]) {
        const out = await inflateRaw(await deflateRaw(data, { fallback: a }), { fallback: b });
        expect(new TextDecoder().decode(out)).toBe('hello hello hello hello');
      }
    }
  });
});
