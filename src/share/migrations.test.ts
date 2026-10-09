import { describe, expect, it, vi } from 'vitest';
import historicalPlan from './fixtures/plan-initial-v1.json';
import historicalSite from './fixtures/site-initial-v1.json';
import featureSite from './fixtures/site-features-v1.json';
import resizablePlan from './fixtures/plan-resizable-v1.json';
import { planFromJson, planToJson, saveStoredPlan, STORAGE_KEY, BACKUP_PREFIX } from './persist';
import { siteFromJson, siteToJson, validateSiteState } from './siteCodec';
import { saveStoredSite, SITE_STORAGE_KEY, SITE_BACKUP_PREFIX } from './sitePersist';
import type { StorageLike } from './persist';

function storage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    key: (i) => [...values.keys()][i] ?? null,
  };
}

describe('historical JSON migrations', () => {
  it('retains distinct migration backups even when saves use the same millisecond', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(12345);
    try {
      const st = storage();
      const first = JSON.stringify(historicalSite);
      const second = JSON.stringify({ ...historicalSite, name: 'Another old template' });
      for (const raw of [first, second]) {
        st.setItem(SITE_STORAGE_KEY, raw);
        expect(saveStoredSite(siteFromJson(raw), st)).toBe(true);
      }
      expect(
        [...st.values].filter(([key]) => key.startsWith(SITE_BACKUP_PREFIX)).map(([, value]) => value),
      ).toEqual([first, second]);
    } finally {
      clock.mockRestore();
    }
  });
  it('preserves later v1 appearance, elevation, icons, locked limits and variable size fields', () => {
    const migrated = siteFromJson(JSON.stringify(featureSite));
    expect(migrated.groups).toEqual(featureSite.groups);
    expect(migrated.resources).toEqual(featureSite.resources);
    expect(siteFromJson(siteToJson(migrated))).toEqual(migrated);
    const plan = planFromJson(JSON.stringify(resizablePlan));
    expect(plan.size).toBe(7);
    expect(plan.manualUnits).toEqual(resizablePlan.manualUnits);
    expect(planFromJson(planToJson(plan))).toEqual(plan);
  });
  it('preserves v1 coordinates, rotations and non-sequential unit IDs through a v2 export', () => {
    const migrated = planFromJson(JSON.stringify(historicalPlan));
    expect(migrated.manualUnits).toEqual(historicalPlan.manualUnits);
    const json = planToJson(migrated);
    expect(JSON.parse(json).v).toBe(2);
    expect(planFromJson(json)).toEqual(migrated);
  });
  it('preserves a site placement and old routing defaults', () => {
    const migrated = siteFromJson(JSON.stringify(historicalSite));
    expect(migrated.groups).toEqual(historicalSite.groups);
    expect(migrated.routing).toBeUndefined();
    expect(migrated.groups[0].voltageTier).toBeUndefined();
    const json = siteToJson(migrated);
    expect(JSON.parse(json).v).toBe(2);
    expect(siteFromJson(json)).toEqual(migrated);
  });
  it('retains unavailable machines and invalid current-rule sizes for explicit replacement', () => {
    const input = structuredClone(historicalSite);
    input.groups[0].multiblockId = 'historical-removed-machine';
    input.groups[0].size = 40;
    const migrated = siteFromJson(JSON.stringify(input));
    expect(migrated.groups).toEqual(input.groups);
    expect(migrated.links).toEqual(input.links);
    expect(siteFromJson(siteToJson(migrated))).toEqual(migrated);
  });
  it('round-trips all new settings without service build identities', () => {
    const input = validateSiteState(historicalSite);
    input.groups[0].voltageTier = 'EV';
    input.groups[0].hatchTiers = { '[0,"fluidOut","fluid:a",0]': 'HV' };
    input.groups[0].resourceBindings = [{ kind: 'fluidOut', resource: 'fluid:a', outputSlot: 2 }];
    input.routing = { mode: 'neat', depth: 6 };
    const json = siteToJson(input);
    expect(siteFromJson(json)).toEqual(input);
    expect(json).not.toMatch(/sourceRevision|requestId/);
  });
  it('backs up the exact old localStorage bytes before replacing them', () => {
    const st = storage();
    const rawPlan = JSON.stringify(historicalPlan);
    const rawSite = JSON.stringify(historicalSite);
    st.setItem(STORAGE_KEY, rawPlan);
    st.setItem(SITE_STORAGE_KEY, rawSite);
    expect(saveStoredPlan(planFromJson(rawPlan), st)).toBe(true);
    expect(saveStoredSite(siteFromJson(rawSite), st)).toBe(true);
    expect([...st.values].some(([k, v]) => k.startsWith(BACKUP_PREFIX) && v === rawPlan)).toBe(true);
    expect([...st.values].some(([k, v]) => k.startsWith(SITE_BACKUP_PREFIX) && v === rawSite)).toBe(true);
    expect(JSON.parse(st.getItem(STORAGE_KEY)!).v).toBe(2);
    expect(JSON.parse(st.getItem(SITE_STORAGE_KEY)!).v).toBe(2);
  });
  it('does not replace storage if the migration backup cannot be saved', () => {
    const st = storage();
    const raw = JSON.stringify(historicalSite);
    st.setItem(SITE_STORAGE_KEY, raw);
    st.setItem = () => {
      throw new Error('full');
    };
    expect(saveStoredSite(siteFromJson(raw), st)).toBe(false);
    expect(st.getItem(SITE_STORAGE_KEY)).toBe(raw);
  });
});
