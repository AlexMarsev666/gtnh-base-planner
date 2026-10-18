import { describe, expect, it } from 'vitest';
import { choosePick } from './pick';

describe('choosePick', () => {
  it('prefers an opaque hit behind a translucent one', () => {
    const hits = [
      { id: 'dim', translucent: true },
      { id: 'faded', translucent: true },
      { id: 'solid', translucent: false },
      { id: 'solid2', translucent: false },
    ];
    expect(choosePick(hits)?.id).toBe('solid');
  });

  it('takes the nearest translucent hit when nothing is opaque', () => {
    const hits = [
      { id: 'a', translucent: true },
      { id: 'b', translucent: true },
    ];
    expect(choosePick(hits)?.id).toBe('a');
  });

  it('returns nothing without hits', () => {
    expect(choosePick([])).toBeUndefined();
  });
});
