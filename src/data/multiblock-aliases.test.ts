import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { getSiteDef } from './generic';
import { MULTIBLOCK_ALIASES, REMOVED_MULTIBLOCK_IDS, resolveMultiblockId } from './multiblock-aliases';
import snapshot from './multiblock-ids.snapshot.json';

describe('multiblock id snapshot', () => {
  it('is sorted and unique', () => {
    expect(snapshot).toEqual([...new Set(snapshot)].sort());
  });

  it('has every id resolvable, aliased or listed as removed', () => {
    const live = new Set(catalog.map((d) => d.id));
    const lost = snapshot.filter(
      (id) => !live.has(id) && !Object.hasOwn(MULTIBLOCK_ALIASES, id) && !REMOVED_MULTIBLOCK_IDS.includes(id),
    );
    expect(
      lost,
      `Multiblock ids that saved plans, templates and links may still use are gone from the catalog: ` +
        `${lost.join(', ')}. For each, either add "old-id": "new-id" to MULTIBLOCK_ALIASES (renamed) or ` +
        `list it in REMOVED_MULTIBLOCK_IDS (removed) in src/data/multiblock-aliases.ts. ` +
        `Keep multiblock-ids.snapshot.json: do not delete the id from it.`,
    ).toEqual([]);
  });

  it('lists every catalog id', () => {
    const known = new Set(snapshot);
    const added = catalog.map((d) => d.id).filter((id) => !known.has(id));
    expect(added, 'Add these new ids to src/data/multiblock-ids.snapshot.json (keep it sorted).').toEqual([]);
  });
});

describe('multiblock aliases', () => {
  it('point at live ids, are not live themselves and do not chain', () => {
    for (const [from, to] of Object.entries(MULTIBLOCK_ALIASES)) {
      expect(getSiteDef(to), `${from} -> ${to} targets a missing id`).toBeDefined();
      expect(getSiteDef(from), `${from} is a live id`).toBeUndefined();
      expect(Object.hasOwn(MULTIBLOCK_ALIASES, to), `${from} -> ${to} chains`).toBe(false);
    }
    for (const id of REMOVED_MULTIBLOCK_IDS) expect(getSiteDef(id), `${id} is live`).toBeUndefined();
  });

  it('resolves one hop, lets a live id win and ignores inherited names', () => {
    expect(resolveMultiblockId('old-oven', { 'old-oven': 'coke-oven' })).toBe('coke-oven');
    expect(resolveMultiblockId('coke-oven', { 'coke-oven': 'distillation-tower' })).toBe('coke-oven');
    expect(resolveMultiblockId('a', { a: 'b', b: 'coke-oven' })).toBe('b');
    expect(resolveMultiblockId('unknown')).toBe('unknown');
    expect(resolveMultiblockId('toString')).toBe('toString');
  });
});
