/** Arrow keys and the site grid (x, z) in blocks. */
export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * The grid step an arrow key means as seen from the camera: Up moves away from the viewer, Right to the
 * right of the screen, each snapped to the nearest site axis. `theta` is the camera azimuth of
 * `OrbitControls` (from +Z towards +X). Exactly diagonal views (the default one) snap Up to -Z and Right
 * to +X, the moves of a camera looking north.
 */
export function screenStep(key: ArrowKey, theta: number): [number, number] {
  // The camera looks along -(sin θ, cos θ) on the ground.
  const fx = -Math.sin(theta);
  const fz = -Math.cos(theta);
  const forward: [number, number] =
    Math.abs(fx) > Math.abs(fz) + 1e-9 ? [Math.sign(fx), 0] : [0, fz < 0 ? -1 : 1];
  // Screen right is forward turned a quarter clockwise seen from above.
  const right: [number, number] = [-forward[1], forward[0]];
  const step =
    key === 'ArrowUp'
      ? forward
      : key === 'ArrowDown'
        ? [-forward[0], -forward[1]]
        : key === 'ArrowRight'
          ? right
          : [-right[0], -right[1]];
  // Normalise -0 so callers can compare with toEqual.
  return [step[0] + 0, step[1] + 0];
}

/** Whether a key press goes to a text field rather than to the view. */
export function isTyping(e: Pick<KeyboardEvent, 'target'>): boolean {
  const el = e.target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

/** Whether a key press goes to a tab list (its arrow keys switch tabs), not to the view. */
export function inTablist(e: Pick<KeyboardEvent, 'target'>): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.('[role="tablist"]');
}

/** What a key does in the site view (see `siteKeyAction`). */
export type SiteKeyAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'move'; key: ArrowKey; far: boolean }
  | { type: 'rotate'; turns: 1 | -1 }
  | { type: 'lift'; dy: 1 | -1; far: boolean }
  | { type: 'auto' }
  | { type: 'frame' }
  | { type: 'remove' };

/**
 * The site view's shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo; on the selected group,
 * arrows move it (Shift: further), PageUp / PageDown raise and lower it (Shift: further), R / Shift+R turn
 * it, F frames it, A hands a port back to automatic placement, Delete / Backspace remove it. Other
 * Ctrl, Cmd or Alt combinations are left to the browser.
 */
export function siteKeyAction(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): SiteKeyAction | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'y' || (k === 'z' && e.shiftKey)) return { type: 'redo' };
    return k === 'z' ? { type: 'undo' } : null;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (isArrowKey(e.key)) return { type: 'move', key: e.key, far: e.shiftKey };
  if (e.key === 'PageUp' || e.key === 'PageDown')
    return { type: 'lift', dy: e.key === 'PageUp' ? 1 : -1, far: e.shiftKey };
  if (e.key === 'a' || e.key === 'A') return { type: 'auto' };
  if (e.key === 'r' || e.key === 'R') return { type: 'rotate', turns: e.shiftKey ? -1 : 1 };
  if (e.key === 'f' || e.key === 'F') return { type: 'frame' };
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'remove' };
  return null;
}
