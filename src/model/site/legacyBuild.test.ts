import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteFromJson, siteToJson } from '../../share/siteCodec';
import { createSiteBuilder } from './build';

/** The user's oil-processing template, saved before tiers, routing styles and assignments existed. */
const text = readFileSync(new URL('../../share/fixtures/oil-processing.json', import.meta.url), 'utf8');
const site = siteFromJson(text);
const raw = JSON.parse(text) as { groups: { id: string; origin: [number, number] }[] };
const opts = { pipes: true, cables: true, below: true };

describe('legacy oil-processing template', () => {
  const build = createSiteBuilder()(site, opts);

  it('connects every terminal; only the Oil Cracking Unit g9 draws warnings', () => {
    expect(site.groups).toHaveLength(27);
    expect(build.stats.connected).toBe(96);
    expect(build.stats.terminals).toBe(96);
    // g9 asks for 12 hatches, but 45 cells less its 18 counted casings (`minCasings`) leave room for 7.
    expect(build.warnings.filter((w) => !('group' in w) || w.group !== 'g9')).toEqual([]);
    expect(build.warnings.some((w) => w.type === 'capacity' && w.group === 'g9')).toBe(true);
    expect(build.notes).toEqual([]);
  });

  it('keeps the group origins it was saved with', () => {
    expect(build.groups.map((g) => [g.group.id, g.group.origin])).toEqual(
      raw.groups.map((g) => [g.id, g.origin]),
    );
  });

  it('has stable hatch counts per group', () => {
    expect(Object.fromEntries(build.groups.map((g) => [g.group.id, g.hatches.length]))).toMatchSnapshot();
  });
});

describe('loading the legacy oil-processing template', () => {
  it('keeps every group as saved and adds no new fields', () => {
    const saved = JSON.parse(siteToJson(site)) as typeof raw & Record<string, unknown>;
    const orig = JSON.parse(text) as Record<string, unknown>;
    expect(saved).toEqual(orig);
    for (const key of ['routing', 'tier', 'assign', 'seed']) expect(saved).not.toHaveProperty(key);
    const fields = (g: object) => Object.keys(g).sort();
    const origGroups = orig.groups as object[];
    (saved.groups as object[]).forEach((g, i) => expect(fields(g)).toEqual(fields(origGroups[i])));
  });
});
