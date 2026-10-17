/**
 * Canvas pixels the docked outline covers on the left, a drawer on the right (side drawer) or at the bottom
 * (bottom sheet on phones).
 */
export interface Inset {
  left: number;
  right: number;
  bottom: number;
}

/**
 * Measures the docked outline (`aside.outline`) and the open drawer (`aside.drawer`) on the next frame and
 * whenever either resizes, reporting the part of the canvas they cover (none when neither is shown).
 * Returns a function that stops watching.
 */
export function watchDrawerInset(report: (inset: Inset) => void): () => void {
  let observer: ResizeObserver | undefined;
  const raf = requestAnimationFrame(() => {
    const drawer = document.querySelector<HTMLElement>('aside.drawer');
    const outline = document.querySelector<HTMLElement>('aside.outline');
    const measure = () => {
      const left = outline?.isConnected ? Math.max(0, Math.round(outline.getBoundingClientRect().right)) : 0;
      if (!drawer?.isConnected) {
        report({ left, right: 0, bottom: 0 });
        return;
      }
      const r = drawer.getBoundingClientRect();
      report(
        r.left > 0
          ? { left, right: Math.max(0, window.innerWidth - r.left), bottom: 0 }
          : { left, right: 0, bottom: Math.max(0, window.innerHeight - r.top) },
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      if (drawer) observer.observe(drawer);
      if (outline) observer.observe(outline);
    }
  });
  return () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
  };
}
