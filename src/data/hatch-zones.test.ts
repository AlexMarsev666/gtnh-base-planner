import { describe, expect, it } from 'vitest';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import { catalog, getMultiblock } from './catalog';
import zonesFile from './hatch-zones.generated.json';

/**
 * Hatch zones (tools/game-dump/build.mjs): generated entries carry `zones` and `region: "dot<N>"` on their hatch
 * cells; hand-made entries are never rewritten, so their zones are listed in hatch-zones.generated.json by the
 * entry's local cell.
 */
const handZones = zonesFile as Record<
  string,
  { zones: Record<string, { kinds: HatchKind[]; text?: string }>; cells: Record<string, string> }
>;

const charAt = (def: MultiblockDef, [x, y, z]: number[]) => [...(def.layers[y]?.[z] ?? '')][x];

describe('hatch zones of hand-made entries', () => {
  it('lists only hand-made entries', () => {
    for (const id of Object.keys(handZones)) {
      const def = getMultiblock(id);
      expect(def, id).toBeDefined();
      expect(def!.generated, `${id} is generated`).toBeFalsy();
    }
  });

  it.each(Object.keys(handZones))('%s: every listed cell is a hatch cell of the entry', (id) => {
    const def = getMultiblock(id)!;
    const { zones, cells } = handZones[id];
    const kindsOf = new Map<string, Set<HatchKind>>();
    for (const [pos, region] of Object.entries(cells)) {
      const ch = charAt(def, pos.split(',').map(Number));
      const hatches = ch === undefined ? undefined : def.legend[ch]?.hatches;
      expect(hatches?.length, `${id} cell ${pos}`).toBeGreaterThan(0);
      expect(zones[region], `${id} cell ${pos} region ${region}`).toBeDefined();
      const set = kindsOf.get(region) ?? new Set<HatchKind>();
      for (const k of hatches!) set.add(k);
      kindsOf.set(region, set);
    }
    for (const [region, zone] of Object.entries(zones)) {
      expect(kindsOf.has(region), `${id} zone ${region} has no cell`).toBe(true);
      for (const k of zone.kinds) expect(kindsOf.get(region)!.has(k), `${id} ${region} ${k}`).toBe(true);
    }
  });
});

describe('hatch zones of generated entries', () => {
  it('name every hatch cell region dot<N> and describe it in zones', () => {
    for (const def of catalog.filter((d) => d.generated && d.zones)) {
      for (const [ch, entry] of Object.entries(def.legend))
        if (entry.region !== undefined) {
          expect(entry.region, `${def.id} "${ch}"`).toMatch(/^dot\d+$/);
          expect(entry.hatches?.length, `${def.id} "${ch}"`).toBeGreaterThan(0);
        }
      for (const region of Object.keys(def.zones!)) expect(region, def.id).toMatch(/^dot\d+$/);
    }
  });
});
