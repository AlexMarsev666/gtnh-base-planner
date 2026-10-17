import { describe, expect, it } from 'vitest';
import { DEFAULT_THETA } from '../render/controls';
import { inTablist, isTyping, screenStep, siteKeyAction } from './keys';

describe('screenStep', () => {
  it('keeps the classic moves in the default view', () => {
    expect(screenStep('ArrowUp', DEFAULT_THETA)).toEqual([0, -1]);
    expect(screenStep('ArrowDown', DEFAULT_THETA)).toEqual([0, 1]);
    expect(screenStep('ArrowRight', DEFAULT_THETA)).toEqual([1, 0]);
    expect(screenStep('ArrowLeft', DEFAULT_THETA)).toEqual([-1, 0]);
  });

  it('follows the camera around the site', () => {
    // Camera south of the site (on +Z) looking north.
    expect(screenStep('ArrowUp', 0)).toEqual([0, -1]);
    expect(screenStep('ArrowRight', 0)).toEqual([1, 0]);
    // Camera east (+X) looking west: up is -X, right is -Z.
    expect(screenStep('ArrowUp', Math.PI / 2)).toEqual([-1, 0]);
    expect(screenStep('ArrowRight', Math.PI / 2)).toEqual([0, -1]);
    // Camera north looking south: everything is mirrored.
    expect(screenStep('ArrowUp', Math.PI)).toEqual([0, 1]);
    expect(screenStep('ArrowLeft', Math.PI)).toEqual([1, 0]);
    // Camera west looking east, also after several turns.
    expect(screenStep('ArrowUp', -Math.PI / 2 + 4 * Math.PI)).toEqual([1, 0]);
    expect(screenStep('ArrowDown', (3 * Math.PI) / 2 - 0.3)).toEqual([-1, 0]);
  });
});

describe('siteKeyAction', () => {
  const key = (
    k: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
  ) => siteKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('maps undo and redo', () => {
    expect(key('z', { ctrlKey: true })).toEqual({ type: 'undo' });
    expect(key('Z', { metaKey: true })).toEqual({ type: 'undo' });
    expect(key('z', { ctrlKey: true, shiftKey: true })).toEqual({ type: 'redo' });
    expect(key('y', { ctrlKey: true })).toEqual({ type: 'redo' });
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('z', { ctrlKey: true, altKey: true })).toBeNull();
  });

  it('maps the group shortcuts', () => {
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ type: 'move', key: 'ArrowLeft', far: true });
    expect(key('r')).toEqual({ type: 'rotate', turns: 1 });
    expect(key('R', { shiftKey: true })).toEqual({ type: 'rotate', turns: -1 });
    expect(key('f')).toEqual({ type: 'frame' });
    expect(key('Delete')).toEqual({ type: 'remove' });
    expect(key('Backspace')).toEqual({ type: 'remove' });
    expect(key('PageUp')).toEqual({ type: 'lift', dy: 1, far: false });
    expect(key('PageDown', { shiftKey: true })).toEqual({ type: 'lift', dy: -1, far: true });
    expect(key('PageUp', { ctrlKey: true })).toBeNull();
    expect(key('a')).toEqual({ type: 'auto' });
    expect(key('r', { altKey: true })).toBeNull();
    expect(key('x')).toBeNull();
  });

  it('leaves keys in text fields alone', () => {
    const target = (tagName: string, isContentEditable = false) => ({
      target: { tagName, isContentEditable } as never,
    });
    expect(isTyping(target('INPUT'))).toBe(true);
    expect(isTyping(target('DIV', true))).toBe(true);
    expect(isTyping(target('CANVAS'))).toBe(false);
    expect(isTyping({ target: null })).toBe(false);
  });

  it('leaves keys on a tab list alone', () => {
    const within = (role: string) => ({
      closest: (sel: string) => (sel.includes(`[role="${role}"]`) ? {} : null),
    });
    for (const role of ['tablist', 'radiogroup', 'switch'])
      expect(inTablist({ target: within(role) as never })).toBe(true);
    expect(inTablist({ target: within('button') as never })).toBe(false);
    expect(inTablist({ target: { closest: () => null } as never })).toBe(false);
    expect(inTablist({ target: null })).toBe(false);
  });
});
