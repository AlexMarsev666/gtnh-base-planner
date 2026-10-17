import { readable } from 'svelte/store';

/** Matches the `max-width: 760px` breakpoint of the Template view's CSS. */
const QUERY = '(max-width: 760px)';

/** True on narrow screens, where the Template outline is not docked but sits inside the Template panel. */
export const narrow = readable(false, (set) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia(QUERY);
  set(mq.matches);
  const onchange = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener('change', onchange);
  return () => mq.removeEventListener('change', onchange);
});
