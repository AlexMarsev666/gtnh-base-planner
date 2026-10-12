import { describe, expect, it } from 'vitest';
import { orientationOf, parseLimits, patchDef, variantsOf } from './orientation.mjs';

const variants = (expr: string, locks?: { rotation?: boolean | null; flip?: boolean | null }) =>
  variantsOf(parseLimits(expr), locks).variants;

// Lambdas copied from GT5-Unofficial 5.09.54.205.
describe('variantsOf', () => {
  it('reaches all four variants with the default limits, also through the roll', () => {
    expect(variants('(d, r, f) -> !f.isVerticallyFliped()')).toEqual([0, 1, 2, 3]);
  });

  it('keeps the shape upright without a roll when the vertical flip is forbidden (towers, drills)', () => {
    expect(variants('(d, r, f) -> d.offsetY == 0 && r.isNotRotated() && !f.isVerticallyFliped()')).toEqual([
      0, 1,
    ]);
    expect(
      variants(`(d, r, f) -> (d.flag & (ForgeDirection.UP.flag | ForgeDirection.DOWN.flag)) == 0 && r.isNotRotated()
            && !f.isVerticallyFliped()`),
    ).toEqual([0, 1]);
  });

  it('forbids the roll of 180 degrees only (heat exchangers)', () => {
    expect(variants('(d, r, f) -> !r.isUpsideDown() && !f.isVerticallyFliped()')).toEqual([0, 1]);
  });

  it('reaches no upside down when the roll is forbidden, the wrench sets no vertical flip (Steam Purifier)', () => {
    expect(variants('(d, r, f) -> d.offsetY == 0 && r.isNotRotated()')).toEqual([0, 1]);
  });

  it('allows nothing but the shape as built without roll and flip (reactors, greenhouse)', () => {
    expect(variants('(d, r, f) -> d.offsetY == 0 && r.isNotRotated() && f.isNotFlipped()')).toEqual([0]);
  });

  it('gives a set that is no product when the flip is fixed but the roll is free (large turbines)', () => {
    expect(variants('(d, r, f) -> f.isNotFlipped()')).toEqual([0, 2]);
  });

  it('keeps the vertical axis of a controller that can only face up (Solar Tower)', () => {
    const r = variantsOf(parseLimits('(d, r, f) -> d == ForgeDirection.UP'));
    expect(r).toEqual({ variants: [0, 1], up: true });
  });

  it('reads the constants of IAlignmentLimits', () => {
    expect(variants('IAlignmentLimits.UPRIGHT')).toEqual([0, 1]);
    expect(variants('IAlignmentLimits.UNLIMITED')).toEqual([0, 1, 2, 3]);
  });

  it('reads a builder chain like GT does (Exo Foundry, Space Elevator)', () => {
    const chain = `IAlignmentLimits.Builder.allowAll()
            .deny(ForgeDirection.DOWN)
            .deny(ForgeDirection.UP)
            .deny(Rotation.UPSIDE_DOWN)
            .deny(Rotation.CLOCKWISE)
            .deny(Rotation.COUNTER_CLOCKWISE)
            .build()`;
    expect(variants(chain)).toEqual([0, 1]);
    expect(variants(chain.replace('.build()', '.deny(Flip.BOTH).deny(Flip.VERTICAL).build()'))).toEqual([
      0, 1,
    ]);
    expect(
      variants('Builder.allowAll().deny(Flip.HORIZONTAL).deny(Flip.VERTICAL).deny(Flip.BOTH).build()'),
    ).toEqual([0, 2]);
  });

  it('follows the change checks of the controller over the default of StructureLib', () => {
    expect(variants('(d, r, f) -> true', { rotation: false })).toEqual([0, 1]);
    expect(variants('(d, r, f) -> true', { flip: false })).toEqual([0, 2]);
    expect(variants('(d, r, f) -> true', { rotation: false, flip: false })).toEqual([0]);
    expect(variants('(d, r, f) -> true', { rotation: true, flip: true })).toEqual([0, 1, 2, 3]);
  });

  it('lets a forced roll tool pass through a flipped state when no other roll is valid (UPRIGHT)', () => {
    // At flip NONE only NORMAL is valid; the next click lands on (UPSIDE_DOWN, VERTICAL), which is variant 1.
    expect(variants('IAlignmentLimits.UPRIGHT', { rotation: true, flip: false })).toEqual([0, 1]);
  });
});

describe('parseLimits', () => {
  it('fails on what it does not know', () => {
    expect(() => parseLimits('(d, r, f) -> d.offsetY == 0 && r.isSomething()')).toThrow(/cannot read/);
    expect(() => parseLimits('(d, r, f) -> d.offsetY == 0 && foo')).toThrow(/cannot read/);
    expect(() => parseLimits('someLimits()')).toThrow(/unknown alignment limits/);
    expect(() => parseLimits('Builder.allowAll().deny(Rotation.SIDEWAYS).build()')).toThrow(/builder/);
  });
});

/** A `HatchRules` stand-in over class bodies by simple name; its chain stops at the first class, like the real one. */
function fakeRules(bodies: Record<string, { body: string; extends?: string }>) {
  const src = (name: string) => {
    const c = bodies[name];
    const sup = c.extends ? `extends ${c.extends}<T> ` : '';
    return `class ${name}<T extends ${c.extends ?? 'Object'}<T>> ${sup}{${c.body}}`;
  };
  return {
    src: (file: string) => src(file),
    chain(cls: string) {
      const name = cls.split('.').pop()!;
      return bodies[name] ? [{ name, body: bodies[name].body, file: name }] : [];
    },
  };
}

describe('orientationOf', () => {
  const base = `private IAlignmentLimits mLimits = getInitialAlignmentLimits();
    public IAlignmentLimits getAlignmentLimits() { return mLimits; }
    protected IAlignmentLimits getInitialAlignmentLimits() { return (d, r, f) -> !f.isVerticallyFliped(); }`;
  const rules = fakeRules({
    MTEEnhancedMultiBlockBase: { body: base },
    Plain: { body: '', extends: 'MTEEnhancedMultiBlockBase' },
    Upright: {
      body: `@Override protected IAlignmentLimits getInitialAlignmentLimits() {
        return (d, r, f) -> d.offsetY == 0 && r.isNotRotated() && !f.isVerticallyFliped(); }`,
      extends: 'MTEEnhancedMultiBlockBase',
    },
    Turbine: {
      body: `protected IAlignmentLimits getInitialAlignmentLimits() { return (d, r, f) -> f.isNotFlipped(); }
        public boolean isFlipChangeAllowed() { return false; }
        public boolean isRotationChangeAllowed() { return true; }`,
      extends: 'MTEEnhancedMultiBlockBase',
    },
    Locked: {
      body: `public boolean isFlipChangeAllowed() { if (mMachine) return false; return super.isFlipChangeAllowed(); }`,
      extends: 'MTEEnhancedMultiBlockBase',
    },
    Odd: {
      body: 'protected IAlignmentLimits getInitialAlignmentLimits() { return limitsFor(this); }',
      extends: 'MTEEnhancedMultiBlockBase',
    },
    Branchy: {
      body: 'protected IAlignmentLimits getInitialAlignmentLimits() { if (x) return A; return B; }',
      extends: 'MTEEnhancedMultiBlockBase',
    },
    Lone: { body: '' },
  });

  it('finds the limits in a superclass the chain of the reader stopped before', () => {
    const r = orientationOf(rules, 'a.Plain');
    expect(r).toMatchObject({ variants: null, problems: [] });
    expect(r.from).toBe('MTEEnhancedMultiBlockBase.getInitialAlignmentLimits');
  });

  it('reads an override, and a locked flip that leaves the roll', () => {
    expect(orientationOf(rules, 'a.Upright')).toMatchObject({ variants: [0, 1], problems: [] });
    expect(orientationOf(rules, 'a.Turbine')).toMatchObject({ variants: [0, 2], problems: [] });
  });

  it('counts a run-time lock as allowed and says so', () => {
    const r = orientationOf(rules, 'a.Locked');
    expect(r.variants).toBeNull();
    expect(r.notes.join()).toMatch(/isFlipChangeAllowed\(\) depends on the run time/);
  });

  it('reports an expression it cannot read and a class without alignment', () => {
    expect(orientationOf(rules, 'a.Odd').problems.join()).toMatch(/unknown alignment limits/);
    expect(orientationOf(rules, 'a.Branchy').problems.join()).toMatch(/unknown alignment limits/);
    expect(orientationOf(rules, 'a.Lone').problems.join()).toMatch(/no alignment limits/);
  });
});

describe('patchDef', () => {
  const text = `{
  "id": "t",
  "defaultHatches": ["itemIn"],
  "wallshare": true,
  "notes": "n"
}
`;

  it('inserts the field before wallshare, replaces it and removes it, changing nothing else', () => {
    const set = patchDef(text, [0, 1]);
    // The tool's text is Prettier-formatted afterwards, so the spacing inside the brackets is not compared.
    expect(Object.keys(JSON.parse(set))).toEqual(['id', 'defaultHatches', 'variants', 'wallshare', 'notes']);
    expect(JSON.parse(set).variants).toEqual([0, 1]);
    expect(set.replace(/ {2}"variants": \[[^\]]*\],\n/, '')).toBe(text);
    expect(JSON.parse(patchDef(set, [0, 2])).variants).toEqual([0, 2]);
    expect(patchDef(set, null)).toBe(text);
    expect(patchDef(text, null)).toBe(text);
  });
});
