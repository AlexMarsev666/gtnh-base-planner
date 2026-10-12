import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordLegacy, recordLegacyOptions } from './legacyCases';

/**
 * Without `requests`, `placeHatches` must keep returning what it did before zones, requests and the capacity
 * summary were added. The snapshots were recorded from the code at cla 59444a2 by `legacy.generate.test.ts`
 * (`WRITE_LEGACY_SNAPSHOT=1 npx vitest run src/model/hatches/legacy.generate.test.ts` on a clean checkout of
 * that commit with `legacy.generate.test.ts` and `legacyCases.ts` copied in). A missing file fails the test.
 * The assembly-line entries with `below` were re-recorded when `allowFaces` became a face preference (its floor
 * casings allow `down`, which `below` opens); every other entry is unchanged. The Pyrolyse Oven entries with 3 or 6
 * units were re-recorded when the muffler became shared on every `wallshare` def (units in a row now share
 * one muffler in the wall between them); among the recorded cases only those changed. The Pyrolyse Oven entries
 * with 3 or 6 units and the Assembly Line entries with 3 were re-recorded when the packer began overlapping
 * units deeper than one block (the units they place on changed, not `placeHatches`); no other recorded case
 * moved.
 */
const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

/** A capacity summary is the only addition to a plain result, and only when something did not fit. */
function withoutCapacity(recorded: Record<string, unknown>) {
  const now = JSON.parse(JSON.stringify(recorded));
  for (const r of Object.values(now) as { capacity?: unknown }[]) delete r.capacity;
  return now;
}

describe('placeHatches without requests', () => {
  it('matches the recorded results of plain calls', () => {
    expect(withoutCapacity(recordLegacy())).toEqual(read('legacy-snapshot.json'));
  });

  it('matches the recorded results with toward and avoid', () => {
    expect(withoutCapacity(recordLegacyOptions())).toEqual(read('legacy-options-snapshot.json'));
  });
});
