import { expect, it } from 'vitest';

const { superclass, classBody, methodBody } = await import(
  /* @vite-ignore */ new URL('../../tools/gt-source/java.mjs', import.meta.url).href
);

it('resolves the actual superclass after generic bounds in RC2 base declarations', () => {
  expect(
    superclass(
      'public abstract class MTEEnhancedMultiBlockBase<T extends MTEEnhancedMultiBlockBase<T>> extends MTETooltipMultiBlockBase {}',
      'MTEEnhancedMultiBlockBase',
    ),
  ).toBe('MTETooltipMultiBlockBase');
  expect(
    superclass(
      'class A<T extends Other<N>, N extends Number> extends packageName.Parent<T> implements I<N> {}',
      'A',
    ),
  ).toBe('Parent');
  expect(superclass('class Plain extends Base {}', 'Plain')).toBe('Base');
  expect(superclass('class Root<T extends Bound> implements I {}', 'Root')).toBeUndefined();
  expect(superclass('// class A extends Wrong {}\nclass A<T extends Bound> extends Actual {}', 'A')).toBe(
    'Actual',
  );
});

it('reads each nested controller method from its own class body', () => {
  const source =
    'class Controllers { class First extends Base { public void checkMachine() { checkOne(); } } class Second extends Other { public void checkMachine() { checkTwo(); } } }';
  expect(superclass(source, 'Second')).toBe('Other');
  expect(methodBody(classBody(source, 'First'), 'checkMachine').trim()).toBe('checkOne();');
  expect(methodBody(classBody(source, 'Second'), 'checkMachine').trim()).toBe('checkTwo();');
});
