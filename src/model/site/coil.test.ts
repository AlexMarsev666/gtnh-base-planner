import { describe, expect, it } from 'vitest';
import { coilById } from '../../data/coils';
import { deriveSiteDemand } from './demand';
import { placeGroups, type GroupCache } from './groups';
import { groupToward } from './toward';
import type { SiteGroup, SiteState } from './types';

function placed(group: Partial<SiteGroup>, cache: GroupCache = new Map()) {
  const s: SiteState = {
    v: 1,
    kind: 'site',
    size: [30, 30],
    corridor: 2,
    groups: [
      {
        id: 'a',
        multiblockId: 'electric-blast-furnace',
        count: 2,
        limits: { x: null, y: 1, z: null },
        enabledHatches: [],
        origin: [3, 3],
        rotation: 0,
        ...group,
      },
    ],
    links: [],
    ports: [],
    resources: {},
    colors: {},
  };
  const d = deriveSiteDemand(s);
  return placeGroups(s, d.demands, groupToward(s, d.endsOf), false, cache, false).groups[0];
}

describe('group coil', () => {
  it('builds the group with the chosen coil', () => {
    const plain = placed({});
    const hot = placed({ coil: 'hypogen' });
    const ch = hot.def!.coils!.chars[0];
    expect(plain.def!.legend[ch].blockId).toBe('gt.coil.cupronickel');
    expect(hot.def!.legend[ch].blockId).toBe(coilById('hypogen')!.blockId);
  });

  it('keys the group cache on the coil, only where it changes the def', () => {
    const cache: GroupCache = new Map();
    placed({}, cache);
    placed({ coil: 'kanthal' }, cache);
    expect(cache.size).toBe(2);
    placed({ coil: 'kanthal' }, cache);
    expect(cache.size).toBe(2);
    // A stale coil on a machine without a heating coil rebuilds nothing.
    const other: GroupCache = new Map();
    placed({ multiblockId: 'vacuum-freezer' }, other);
    placed({ multiblockId: 'vacuum-freezer', coil: 'kanthal' }, other);
    expect(other.size).toBe(1);
  });
});
