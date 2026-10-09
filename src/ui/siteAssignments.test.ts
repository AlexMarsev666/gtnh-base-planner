import { describe, expect, it } from 'vitest';
import { layoutFixture, ROLE_MACHINES } from '../model/site/layoutInvariantFixtures';
import { decodeSite, encodeSite, siteFromJson, siteToJson, validateSiteState } from '../share/siteCodec';
import { loadStoredSite, saveStoredSite } from '../share/sitePersist';
import { withGroupDuplicated, withGroupPatched } from './siteActions';
import { emptyHistory, recorded, undone, redone } from './siteHistory';

function assignments(g: ReturnType<typeof layoutFixture>['groups'][number]) {
  return {
    resourceBindings: g.resourceBindings,
    hatchTiers: g.hatchTiers,
    voltageTier: g.voltageTier,
    structureGlassTier: g.structureGlassTier,
  };
}

describe('roles, machine assignments and tiers through document operations', () => {
  for (const id of ROLE_MACHINES)
    it(`${id}: files, links, localStorage, duplicate and undo/redo retain assignments`, async () => {
      const site = layoutFixture(id, 73);
      const normalized = validateSiteState(site);
      const expected = assignments(normalized.groups[0]);
      expect(assignments(siteFromJson(siteToJson(site)).groups[0])).toEqual(expected);
      expect(assignments((await decodeSite(await encodeSite(site))).groups[0])).toEqual(expected);
      const map = new Map<string, string>();
      const storage = {
        get length() {
          return map.size;
        },
        key: (i: number) => [...map.keys()][i] ?? null,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      };
      expect(saveStoredSite(site, storage)).toBe(true);
      expect(assignments(loadStoredSite(storage)!.groups[0])).toEqual(expected);
      const copied = withGroupDuplicated(site, site.groups[0].id, [60, 60]);
      expect(assignments(copied.groups[1])).toEqual(assignments(site.groups[0]));
      expect(copied.groups[1].resourceBindings).not.toBe(site.groups[0].resourceBindings);
      if (site.groups[0].hatchTiers) expect(copied.groups[1].hatchTiers).not.toBe(site.groups[0].hatchTiers);
      const smaller = withGroupPatched(site, site.groups[0].id, { count: 1 });
      expect(assignments(smaller.groups[0])).toEqual(assignments(site.groups[0]));
      const history = recorded(emptyHistory<typeof site>(), site, null, 1);
      const back = undone(history, smaller)!;
      expect(back.value).toEqual(site);
      const forward = redone(back.history, back.value)!;
      expect(forward.value).toEqual(smaller);
      expect(assignments(forward.value.groups[0])).toEqual(assignments(site.groups[0]));
      const loadedSmaller = siteFromJson(siteToJson(smaller));
      expect(assignments(loadedSmaller.groups[0])).toEqual(expected);
    });
});
