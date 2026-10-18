import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { dirVec } from '../geometry';
import type { Tier } from '../core/types';
import type { HatchKind } from '../multiblock/types';
import { createSiteBuilder } from './build';
import { buildGroup, type Demand, type GroupOptions } from './group';
import { packBuses } from './requests';
import type { SiteGroup, SiteState } from './types';

const ebf = getMultiblock('electric-blast-furnace')!;
const oil = getMultiblock('oil-cracking-unit')!;
const none = { x: null, y: null, z: null };

const names = (kind: string, n: number) => Array.from({ length: n }, (_, i) => `${kind}:r${i}`);

function build(def: typeof ebf, count: number, demand: Demand, opts: GroupOptions, base: HatchKind[]) {
  return buildGroup(def, count, none, base, demand, false, {}, opts);
}

/** The hatches of one unit and kind that carry a resource (not the ones a requirement adds), with the resources each serves. */
function served(b: ReturnType<typeof build>, kind: HatchKind, unitId = 0): string[][] {
  return b.hatches
    .filter((h) => h.kind === kind && h.resource !== undefined && h.unitIds.includes(unitId))
    .map((h) => h.resources ?? [h.resource!]);
}

describe('item buses hold as many items as their slots', () => {
  const plain: HatchKind[] = ['energy', 'maintenance'];
  const six = { itemIn: names('item', 6) };

  it('needs two LV buses (4 slots) for six items and one MV bus (9 slots)', () => {
    for (const unit of [0, 1]) {
      const lv = build(ebf, 2, six, { tier: 'LV' }, plain);
      expect(served(lv, 'itemIn', unit).map((l) => l.length)).toEqual([4, 2]);
      expect(served(lv, 'itemIn', unit).flat()).toEqual(six.itemIn);
      const mv = build(ebf, 2, six, { tier: 'MV' }, plain);
      expect(served(mv, 'itemIn', unit)).toEqual([six.itemIn]);
      expect(mv.missing).toEqual([]);
    }
  });

  it('does the same for output buses', () => {
    const out = { itemOut: names('item', 6) };
    expect(served(build(ebf, 1, out, { tier: 'LV' }, plain), 'itemOut').map((l) => l.length)).toEqual([4, 2]);
    expect(served(build(ebf, 1, out, { tier: 'MV' }, plain), 'itemOut')).toEqual([out.itemOut]);
  });

  it("takes the tier of the first resource's hatch key for a bus", () => {
    const own = { 'itemIn:item:r0:0': 'MV' as Tier };
    const b = build(ebf, 1, six, { tier: 'LV', hatchTiers: own }, plain);
    expect(served(b, 'itemIn')).toEqual([six.itemIn]);
    // A key of another resource than the first leaves the bus alone.
    const other = build(ebf, 1, six, { tier: 'LV', hatchTiers: { 'itemIn:item:r5:0': 'MV' } }, plain);
    expect(served(other, 'itemIn').map((l) => l.length)).toEqual([4, 2]);
  });

  it('is deterministic and names the first resource as the hatch resource', () => {
    const a = build(ebf, 3, six, { tier: 'LV' }, plain);
    expect(a.hatches).toEqual(build(ebf, 3, six, { tier: 'LV' }, plain).hatches);
    for (const h of a.hatches.filter((x) => x.kind === 'itemIn')) expect(h.resource).toBe(h.resources![0]);
  });

  it('keeps ULV buses at one item each', () => {
    const b = build(ebf, 1, { itemIn: names('item', 2) }, { tier: 'ULV' }, plain);
    expect(served(b, 'itemIn')).toEqual([['item:r0'], ['item:r1']]);
  });
});

describe('fluid input hatches', () => {
  const base: HatchKind[] = ['energy'];
  const count = (b: ReturnType<typeof build>, kind: HatchKind) => served(b, kind).length;

  it('hold one fluid below EV and four from EV', () => {
    const three = { fluidIn: names('fluid', 3) };
    expect(count(build(oil, 1, three, { tier: 'HV' }, base), 'fluidIn')).toBe(3);
    const ev = build(oil, 1, three, { tier: 'EV' }, base);
    expect(served(ev, 'fluidIn')).toEqual([three.fluidIn]);
    expect(ev.hatches.find((h) => h.kind === 'fluidIn')!.block).toBe('gt.hatch.quadInput');
    const five = build(oil, 1, { fluidIn: names('fluid', 5) }, { tier: 'EV' }, base);
    expect(served(five, 'fluidIn').map((l) => l.length)).toEqual([4, 1]);
  });

  it('are one regular hatch per fluid when the group turns quadruple hatches off', () => {
    const three = { fluidIn: names('fluid', 3) };
    const b = build(oil, 1, three, { tier: 'EV', quadFluid: false }, base);
    expect(served(b, 'fluidIn')).toEqual(three.fluidIn.map((f) => [f]));
    expect(b.hatches.filter((h) => h.kind === 'fluidIn').every((h) => h.block === undefined)).toBe(true);
  });

  it('keep a regular hatch for a lone fluid and one hatch per output fluid', () => {
    const one = build(oil, 1, { fluidIn: ['fluid:a'] }, { tier: 'EV' }, base);
    expect(one.hatches.find((h) => h.kind === 'fluidIn')!.block).toBeUndefined();
    expect(count(build(oil, 1, { fluidOut: names('fluid', 3) }, { tier: 'EV' }, base), 'fluidOut')).toBe(3);
  });
});

describe('packBuses', () => {
  it('returns requests that merge nothing as they were', () => {
    const requests = [
      { kind: 'itemIn' as const, units: 'each' as const, key: 'a' },
      { kind: 'itemIn' as const, units: [0, 1], key: 'b' },
      { kind: 'fluidOut' as const, units: 'each' as const, key: 'f' },
    ];
    expect(packBuses(requests, [0, 1, 2], () => 1)).toEqual(requests);
  });

  it('merges per unit, and units that fill alike share a request', () => {
    const requests = [
      { kind: 'itemIn' as const, units: 'each' as const, key: 'a' },
      { kind: 'itemIn' as const, units: [1], key: 'b' },
    ];
    expect(packBuses(requests, [0, 1, 2], () => 2)).toEqual([
      { kind: 'itemIn', units: [0, 2], key: 'a' },
      { kind: 'itemIn', units: [1], key: 'a', keys: ['a', 'b'] },
    ]);
  });
});

describe('two nets ending at one bus', () => {
  const group: SiteGroup = {
    id: 'ebf',
    multiblockId: 'electric-blast-furnace',
    count: 1,
    limits: none,
    enabledHatches: [],
    origin: [14, 14],
    rotation: 0,
    tier: 'MV',
  };
  const site: SiteState = {
    v: 1,
    kind: 'site',
    size: [40, 40],
    corridor: 2,
    groups: [group],
    ports: [
      { id: 'pa', dir: 'in', resource: 'item:a' },
      { id: 'pb', dir: 'in', resource: 'item:b' },
    ],
    links: [
      { id: 'la', from: { port: 'pa' }, to: { group: 'ebf' }, resource: 'item:a' },
      { id: 'lb', from: { port: 'pb' }, to: { group: 'ebf' }, resource: 'item:b' },
    ],
    resources: {
      'item:a': { kind: 'item', name: 'A', color: '#ff0000' },
      'item:b': { kind: 'item', name: 'B', color: '#0000ff' },
    },
    colors: {},
  };
  const opts = { pipes: true, cables: false, below: true };

  it('connects both through the front of the one bus and shares only the cell in front of it', () => {
    const b = createSiteBuilder()(site, opts);
    const buses = b.groups[0].hatches.filter((h) => h.kind === 'itemIn');
    expect(buses).toHaveLength(1);
    expect(buses[0].resources).toEqual(['item:a', 'item:b']);
    expect(b.nets).toHaveLength(2);
    for (const n of b.nets) {
      expect(n.terminals.filter((t) => t.hatch)).toHaveLength(1);
      expect(n.route!.connected).toBe(n.route!.total);
    }
    expect(b.stats.connected).toBe(b.stats.terminals);
    expect(b.warnings.filter((w) => w.type === 'unrouted')).toEqual([]);
    const cells = (i: number) => new Set(b.nets[i].route!.paths.flat().map((c) => c.join()));
    const common = [...cells(0)].filter((c) => cells(1).has(c));
    const v = dirVec(buses[0].face);
    expect(common).toEqual([buses[0].cell.map((x, i) => x + v[i]).join()]);
  });

  it('is deterministic', () => {
    const run = () => createSiteBuilder()(site, opts).nets.map((n) => n.route!.paths);
    expect(run()).toEqual(run());
  });
});

describe('every requested resource reaches its units', () => {
  const covered = (b: ReturnType<typeof build>, kind: HatchKind, unitId: number, resource: string) =>
    b.hatches.some(
      (h) =>
        h.kind === kind && h.unitIds.includes(unitId) && (h.resources ?? [h.resource]).includes(resource),
    );

  it('gives units that ask for other bus contents the resources they asked for', () => {
    const def = getMultiblock('implosion-compressor')!;
    const b = build(def, 4, { itemIn: ['a', 'b', 'c', 'z'] }, { tier: 'LV', assign: { z: { unit: 0 } } }, [
      'energy',
      'maintenance',
    ]);
    expect(b.missing).toEqual([]);
    for (const u of b.units)
      for (const r of ['a', 'b', 'c']) expect(covered(b, 'itemIn', u.id, r)).toBe(true);
    expect(covered(b, 'itemIn', 0, 'z')).toBe(true);
  });

  it('does not spread items over units when one bus holds them all', () => {
    const def = getMultiblock('ore-drilling-plant')!;
    const demand = { itemIn: names('i', 6), fluidIn: names('f', 3) };
    const b = build(def, 2, demand, { tier: 'MV' }, ['energy', 'maintenance']);
    for (const u of b.units) for (const r of demand.itemIn) expect(covered(b, 'itemIn', u.id, r)).toBe(true);
  });

  const assigns: GroupOptions['assign'][] = [
    undefined,
    { r3: { unit: 0 } },
    { r1: { unit: 'all' } },
    { r0: { unit: 1 }, r2: { unit: 'all' } },
  ];
  it.each(['implosion-compressor', 'ore-drilling-plant', 'electric-blast-furnace', 'oil-cracking-unit'])(
    '%s: covered by a hatch of the unit or reported as missing',
    (id) => {
      const def = getMultiblock(id)!;
      const demand: Demand = { itemIn: names('r', 5), fluidIn: names('q', 3) };
      for (const tier of ['ULV', 'LV', 'MV', 'EV'] as Tier[])
        for (const assign of assigns)
          for (const count of [1, 3]) {
            const b = build(def, count, demand, { tier, ...(assign ? { assign } : {}) }, ['energy']);
            // Resources the build spread over the units are not wanted on every one.
            const spread = new Set(b.notes.flatMap((n) => (n.type === 'distributed' ? n.resources : [])));
            const lost = new Set(b.missing.map((m) => `${m.kind}|${m.resource}|${m.unitId}`));
            for (const [kind, list] of Object.entries(demand) as [HatchKind, string[]][])
              for (const r of list)
                for (const u of b.units) {
                  const a = assign?.[r]?.unit;
                  if ((typeof a === 'number' && a !== u.id) || spread.has(r)) continue;
                  const ok = covered(b, kind, u.id, r) || lost.has(`${kind}|${r}|${u.id}`);
                  expect(ok, `${id} ${tier} ${JSON.stringify(assign)} x${count} unit ${u.id} ${r}`).toBe(
                    true,
                  );
                }
          }
    },
  );
});
