import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { recordLegacy, recordLegacyOptions } from './legacyCases';

/**
 * Records the legacy snapshots (`legacy.test.ts`). Skipped unless `WRITE_LEGACY_SNAPSHOT=1`. Run it on the
 * code to compare against, e.g. a clean checkout of cla 59444a2 with this file and `legacyCases.ts` copied
 * into `src/model/hatches/`:
 *
 *   WRITE_LEGACY_SNAPSHOT=1 npx vitest run src/model/hatches/legacy.generate.test.ts
 *
 * then `npx prettier --write` the two JSON files it writes next to it.
 */
describe.skipIf(!process.env.WRITE_LEGACY_SNAPSHOT)('legacy snapshots', () => {
  it('are written', () => {
    const write = (name: string, data: unknown) =>
      writeFileSync(new URL(name, import.meta.url), JSON.stringify(data));
    write('legacy-snapshot.json', recordLegacy());
    write('legacy-options-snapshot.json', recordLegacyOptions());
  });
});
