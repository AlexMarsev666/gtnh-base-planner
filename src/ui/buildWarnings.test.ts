import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createBuildWarnings } from './buildWarnings';
import { notices } from './notices';
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
