import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createBuildWarnings, hatchMessages } from './buildWarnings';
import { notices } from './notices';
import type { CapacityEntry } from '../model/hatches/types';
import type { BuildResult } from './pipeline';

const result = (placed: number, pending = false): BuildResult => ({
  def: undefined,
  pack: { units: [], requested: 5, placed },
  loosened: false,
  hatches: { hatches: [], unplaced: [] },
  stats: null,
  pipes: null,
  scene: null,
  error: null,
  ...(pending ? { pending } : {}),
});

describe('build warnings', () => {
  beforeEach(() => notices.set([]));

  it('does not tell again for an equal result in new objects', () => {
    const warn = createBuildWarnings();
    warn(result(3));
    expect(get(notices)).toHaveLength(1);
    notices.set([]);
    warn(result(3));
    expect(get(notices)).toHaveLength(0);
    warn(result(2));
    expect(get(notices)).toHaveLength(1);
  });

  it('ignores a result still waiting for its pipes', () => {
    const warn = createBuildWarnings();
    warn(result(3, true));
    expect(get(notices)).toHaveLength(0);
    warn(result(3));
    expect(get(notices)).toHaveLength(1);
  });
});

describe('hatch warnings', () => {
  beforeEach(() => notices.set([]));

  const entry = (over: Partial<CapacityEntry> = {}): CapacityEntry => ({
    needed: 8,
    fits: 6,
    remove: 2,
    unitIds: [0],
    ...over,
  });
  const unplaced = (n: number, reason?: 'capacity' | 'noCell') =>
    Array.from({ length: n }, (_, i) => ({
      unitId: i,
      kind: 'itemIn' as const,
      ...(reason ? { reason } : {}),
    }));

  it('says nothing without capacity or unplaced hatches', () => {
    expect(hatchMessages(undefined, [])).toEqual([]);
  });

  it('gives one message with the numbers, and none for the hatches capacity explains', () => {
    const msgs = hatchMessages([entry()], unplaced(2, 'capacity'));
    expect(msgs).toEqual(["Hatches don't fit: 8 needed, 6 fit. Remove 2."]);
  });

  it('names the worst overload, the units and mandatory hatches', () => {
    const [msg] = hatchMessages(
      [entry(), entry({ needed: 9, fits: 5, remove: 4, unitIds: [1, 2], mandatory: true })],
      [],
    );
    expect(msg).toContain('9 needed, 5 fit. Remove 4.');
    expect(msg).toContain('required hatches');
    expect(msg).toContain('(3 units)');
  });

  it('keeps the old text for unplaced hatches capacity does not cover', () => {
    expect(hatchMessages(undefined, unplaced(2))).toEqual(['2 hatches could not be placed.']);
    const msgs = hatchMessages([entry()], [...unplaced(2, 'capacity'), ...unplaced(1, 'noCell')]);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toBe('1 hatch could not be placed.');
  });

  it('shows one notice for a build result', () => {
    const warn = createBuildWarnings();
    warn({ ...result(5), capacity: [entry()], hatches: { hatches: [], unplaced: unplaced(2, 'capacity') } });
    const texts = get(notices).map((n) => n.text);
    expect(texts).toEqual(["Hatches don't fit: 8 needed, 6 fit. Remove 2."]);
  });
});
