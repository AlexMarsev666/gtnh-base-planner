<script module lang="ts">
  /** What the menu items get: `pick` closes the menu and runs the item; `close` only closes it. */
  export interface MenuApi {
    pick: (run: () => void) => void;
    close: (refocus?: boolean) => void;
  }
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  /**
   * A button that opens a popup menu under it. The items are `role="menuitem"` elements (class `menu-item`)
   * rendered by the caller. Focus moves to the first item on opening; ↑ / ↓ / Home / End move through the items;
   * Escape closes the menu and returns focus to the button; a click elsewhere or tabbing out closes it. These keys
   * stop here, so the app's own shortcuts (deselect, move the group) do not run as well.
   */
  interface Props {
    /** Accessible name of the menu. */
    label: string;
    testid?: string;
    /** Accessible name of the button, when its content is not text. */
    buttonLabel?: string;
    buttonClass?: string;
    /** The menu hangs from the button's right edge (default) or its left one. */
    align?: 'left' | 'right';
    /** What the button shows. */
    button: Snippet;
    children: Snippet<[MenuApi]>;
    onclose?: () => void;
  }
  let {
    label,
    testid,
    buttonLabel,
    buttonClass = 'btn',
    align = 'right',
    button,
    children,
    onclose,
  }: Props = $props();

  let open = $state(false);
  let box = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();
  const items = () => [...(box?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  async function openMenu() {
    open = true;
    await tick();
    items()[0]?.focus();
  }
  function close(refocus = true) {
    if (!open) return;
    open = false;
    onclose?.();
    if (refocus) trigger?.focus();
  }
  function pick(run: () => void) {
    close();
    run();
  }
  const api: MenuApi = { pick, close };

  function onkeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const last = list.length - 1;
    let next = 0;
    if (e.key === 'End') next = last;
    else if (e.key === 'ArrowDown') next = at < last ? at + 1 : 0;
    else if (e.key === 'ArrowUp') next = at > 0 ? at - 1 : last;
    list[next]?.focus();
  }
  // Tabbing out of the menu closes it, and focus goes on where Tab sent it.
  // A mouse-down inside does not always focus what was pressed (Safari, Firefox on macOS), and padding or a
  // separator takes no focus: the menu stays open while the pointer is down inside it.
  let pointerInside = false;
  function onpointerdown() {
    pointerInside = true;
    window.addEventListener('pointerup', () => setTimeout(() => (pointerInside = false)), { once: true });
  }
  function onfocusout(e: FocusEvent) {
    if (!open || pointerInside) return;
    const to = e.relatedTarget as Node | null;
    if (box?.contains(to)) return;
    // Focus went nowhere: still inside when the focused element is (the browser reports no target).
    if (!to && box?.contains(document.activeElement) && document.activeElement !== document.body) return;
    close(false);
  }
  function outsideClick(e: MouseEvent) {
    if (open && !box?.contains(e.target as Node)) close(false);
  }
</script>

<svelte:window onclick={outsideClick} />

<div class="menu-box" bind:this={box} {onkeydown} {onfocusout} {onpointerdown} role="presentation">
  <button
    class={buttonClass}
    bind:this={trigger}
    data-testid={testid}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={buttonLabel}
    onclick={() => (open ? close() : void openMenu())}>{@render button()}</button
  >
  {#if open}
    <div class="menu" class:right={align === 'right'} role="menu" tabindex="-1" aria-label={label}>
      {@render children(api)}
    </div>
  {/if}
</div>

<style>
  .menu-box {
    position: relative;
    display: inline-flex;
  }
</style>
