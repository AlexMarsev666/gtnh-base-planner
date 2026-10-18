<script lang="ts">
  import { t } from '../i18n/en';
  import { type ArrowKey, screenStep } from './keys';
  import {
    FAST_STEP,
    liftSelectedStep,
    moveSelected,
    rotateSelected,
    shiftHeld,
    viewTheta,
  } from './siteEditing';

  /**
   * On-screen arrows and turns for the selected group: the arrow keys and R for touch screens, and a
   * reminder of them for everyone. Arrows move as seen on screen, like the keys (Away, Toward, Left,
   * Right), and each shows which axis it changes in the current view. Holding a button repeats.
   */

  const cells: (
    { key: ArrowKey; glyph: string; label: string } | { turn: 1 | -1 } | { lift: 1 | -1 } | null
  )[] = [
    { lift: 1 },
    { key: 'ArrowUp', glyph: '↑', label: t.site.nudgeDir.up },
    { turn: -1 },
    { key: 'ArrowLeft', glyph: '←', label: t.site.nudgeDir.left },
    null,
    { key: 'ArrowRight', glyph: '→', label: t.site.nudgeDir.right },
    { lift: -1 },
    { key: 'ArrowDown', glyph: '↓', label: t.site.nudgeDir.down },
    { turn: 1 },
  ];

  function axisOf(key: ArrowKey, theta: number): { axis: 'x' | 'z'; text: string } {
    const [dx, dz] = screenStep(key, theta);
    return dx !== 0
      ? { axis: 'x', text: t.site.nudgeStep('X', dx) }
      : { axis: 'z', text: t.site.nudgeStep('Z', dz) };
  }

  const REPEAT_DELAY_MS = 400;
  const REPEAT_MS = 110;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stop() {
    clearTimeout(timer);
    timer = undefined;
  }

  function press(e: PointerEvent, run: () => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    run();
    stop();
    const again = () => {
      run();
      timer = setTimeout(again, REPEAT_MS);
    };
    timer = setTimeout(again, REPEAT_DELAY_MS);
  }

  $effect(() => stop);

  // Pointer presses act on pointerdown; keyboard activation of the buttons (Enter / Space) arrives as a
  // click with no pointer (detail 0).
  function keyClick(e: MouseEvent, run: () => void) {
    if (e.detail === 0) run();
  }
</script>

<div class="pad" role="group" aria-label={t.site.nudge} data-testid="nudge-pad">
  {#each cells as c, i (i)}
    {#if c === null}
      <span class="cell empty">{i === 4 ? ($shiftHeld ? FAST_STEP : 1) : ''}</span>
    {:else if 'key' in c}
      {@const a = axisOf(c.key, $viewTheta)}
      {@const run = () => moveSelected(c.key, $shiftHeld)}
      <button
        class="cell"
        type="button"
        aria-label={`${t.site.nudge}: ${c.label} (${a.text})`}
        title={`${c.label} (${a.text})`}
        data-testid={`nudge-${c.key}`}
        onpointerdown={(e) => press(e, run)}
        onpointerup={stop}
        onpointerleave={stop}
        onpointercancel={stop}
        onclick={(e) => keyClick(e, run)}
        >{c.glyph}<span class="word">{c.label}</span><span
          class="ax"
          class:x={a.axis === 'x'}
          class:z={a.axis === 'z'}>{a.text}</span
        ></button
      >
    {:else if 'lift' in c}
      {@const dir = c.lift}
      {@const run = () => liftSelectedStep(dir, $shiftHeld)}
      <button
        class="cell"
        type="button"
        aria-label={dir > 0 ? t.site.raise : t.site.lower}
        title={dir > 0 ? t.site.raise : t.site.lower}
        data-testid={dir > 0 ? 'nudge-raise' : 'nudge-lower'}
        onpointerdown={(e) => press(e, run)}
        onpointerup={stop}
        onpointerleave={stop}
        onpointercancel={stop}
        onclick={(e) => keyClick(e, run)}
        >{dir > 0 ? '⤒' : '⤓'}<span class="word">{dir > 0 ? t.site.nudgeRaise : t.site.nudgeLower}</span><span
          class="ax y">Y</span
        ></button
      >
    {:else}
      {@const dir = c.turn}
      <button
        class="cell"
        type="button"
        aria-label={dir > 0 ? t.site.turnRight : t.site.turnLeft}
        title={dir > 0 ? t.site.turnRight : t.site.turnLeft}
        data-testid={dir > 0 ? 'nudge-turn-right' : 'nudge-turn-left'}
        onclick={() => rotateSelected(dir)}
        >{dir > 0 ? '⟳' : '⟲'}<span class="word">{t.site.nudgeTurn}</span></button
      >
    {/if}
  {/each}
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 64px);
    grid-template-rows: repeat(3, 46px);
    gap: 2px;
    flex: none;
  }
  .cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    appearance: none;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0;
    margin: 0;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .cell:hover {
    color: var(--text);
    background: var(--surface);
  }
  .cell:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .empty {
    border-color: transparent;
    font-size: 13px;
    color: var(--text);
    cursor: default;
  }
  .word {
    font-size: 13px;
  }
  .ax {
    position: absolute;
    right: 4px;
    top: 3px;
    font-size: 10px;
  }
  .ax.x {
    color: var(--axis-x);
  }
  .ax.z {
    color: var(--axis-z);
  }
  .ax.y {
    color: var(--muted);
  }
</style>
