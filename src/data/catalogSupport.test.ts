import { expect, it } from 'vitest';
import support from './catalog-support.generated.json';
import { catalogSupportReason, catalogSupportStatus } from './catalogSupport';
import { t } from '../i18n/en';

it('every generated limited-support entry has a user-visible reason', () => {
  for (const [id, entry] of Object.entries(support)) {
    const reason = catalogSupportReason(id);
    expect(reason, id).toBe(entry.reason);
    expect(catalogSupportStatus(id), id).toBe(entry.status);
    expect(t.catalogSupportReasons[reason!].length, id).toBeGreaterThan(20);
  }
});

it('unknown IDs and entries outside the bounded list do not acquire a support notice', () => {
  for (const id of ['oil-cracking-unit', 'unknown-machine', '__proto__', 'constructor', 'toString']) {
    expect(catalogSupportReason(id), id).toBeUndefined();
    expect(catalogSupportStatus(id), id).toBeUndefined();
  }
});
