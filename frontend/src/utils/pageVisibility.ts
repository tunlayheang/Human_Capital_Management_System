/** True when the tab is in the foreground (always true during SSR). */
export function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Interval that skips work while the tab is hidden — cuts idle API load ~60–80%. */
export function createVisibilityAwareInterval(
  fn: () => void,
  ms: number,
  runImmediately = false
): () => void {
  if (runImmediately && isPageVisible()) fn();
  const id = window.setInterval(() => {
    if (isPageVisible()) fn();
  }, ms);
  // Catch up as soon as the tab is focused again (sounds / badges while away).
  const onVisible = () => {
    if (isPageVisible()) fn();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
