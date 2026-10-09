import { describe, expect, it } from 'vitest';
import evidence from '../tools/game-dump/catalog-results.rc2.json';
import support from '../src/data/catalog-support.generated.json';
import { problemEntries, retainedShapes, supportCode, supportStatus } from './catalog-status.mjs';

describe('bounded catalog support decisions', () => {
  it('covers the existing 15 rejects, four exceptions and 37 unresolved entries exactly once', () => {
    const entries = problemEntries(evidence);
    expect(entries).toHaveLength(56);
    expect(new Set(entries.map((e: { machine: string }) => e.machine)).size).toBe(56);
    expect(entries.filter((e: { status: string }) => e.status === 'default-rejected')).toHaveLength(15);
    expect(entries.filter((e: { status: string }) => e.status === 'native-exception')).toHaveLength(4);
    expect(entries.filter((e: { status: string }) => e.status === 'unresolved')).toHaveLength(37);
    expect(support).toEqual(
      Object.fromEntries(
        entries.map((e) => [e.machine, { reason: supportCode(e), status: supportStatus(e) }]),
      ),
    );
  });

  it('retains distinct reasons for deferred liquid zones, old forms and historical checks', () => {
    expect(support.boldarnator).toEqual({ reason: 'liquid-zones', status: 'limited' });
    for (const id of retainedShapes)
      expect(support[id as keyof typeof support].reason).toBe('retained-shape');
    expect(Object.values(support).filter((entry) => entry.reason === 'retained-shape')).toHaveLength(4);
    expect(Object.values(support).filter((entry) => entry.reason === 'rejected-default')).toHaveLength(14);
    expect(Object.values(support).filter((entry) => entry.reason === 'check-exception')).toHaveLength(4);
    expect(Object.values(support).filter((entry) => entry.reason === 'no-game-check')).toHaveLength(33);
  });

  it('uses known problems only for rejected defaults and exceptions, retaining Boldarnator', () => {
    const entries = problemEntries(evidence);
    for (const entry of entries) {
      if (entry.machine === 'boldarnator') expect(supportStatus(entry)).toBe('limited');
      else
        expect(supportStatus(entry)).toBe(
          ['default-rejected', 'native-exception'].includes(entry.status) ? 'known-problem' : 'unverified',
        );
    }
    expect(supportStatus(evidence.entries.find((entry) => entry.machine === 'pyrolyse-oven')!)).toBe(
      'unverified',
    );
    expect(Object.values(support).filter((entry) => entry.status === 'known-problem')).toHaveLength(18);
    expect(Object.values(support).filter((entry) => entry.status === 'unverified')).toHaveLength(37);
  });

  it('does not mark a successful catalog check as a failure', () => {
    const ids = new Set(problemEntries(evidence).map((e: { machine: string }) => e.machine));
    for (const entry of evidence.entries.filter((e) => e.status === 'default-formed'))
      expect(ids.has(entry.machine), entry.machine).toBe(false);
  });

  it('rejects duplicate IDs instead of silently changing the status count', () => {
    const report = structuredClone(evidence);
    report.entries[0] = report.entries[1];
    expect(() => problemEntries(report)).toThrow('Duplicate or unknown catalog entry');
  });

  it('rejects stale evidence counts', () => {
    expect(() => problemEntries({ ...evidence, rejected: 14 })).toThrow('Stale rejected count');
    expect(() => problemEntries({ ...evidence, count: 243 })).toThrow('Catalog count');
  });

  it('rejects an unrecognized status instead of declaring it supported', () => {
    const report = structuredClone(evidence);
    Object.assign(report.entries[0], { status: 'new-status' });
    expect(() => problemEntries(report)).toThrow('Duplicate or unknown catalog entry');
  });

  it('requires an explicit decision for all retained and deferred forms', () => {
    const report = structuredClone(evidence);
    report.entries.find((e) => e.machine === 'space-elevator')!.machine = 'renamed-space-elevator';
    expect(() => problemEntries(report)).toThrow('Missing a retained or deferred catalog entry');
  });
});
