/**
 * Keep fixed wizard/action bars fully visible on every device:
 * desktop, tablet, phone, iOS Safari chrome, Android keyboards, safe areas.
 */

export const HCMS_BOTTOM_NAV_ID = 'hcms-bottom-nav';

export function visualViewportBottomGap(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/** True when the on-screen keyboard (or similar) has shrunk the visual viewport. */
export function isVisualKeyboardOpen(gap = visualViewportBottomGap()): boolean {
  return gap > 96;
}

export function measureBottomNavHeight(): number {
  if (typeof document === 'undefined') return 0;
  const nav = document.getElementById(HCMS_BOTTOM_NAV_ID);
  if (!nav) return 0;
  return Math.ceil(nav.getBoundingClientRect().height);
}

type SyncStickyActionBarInsetsOptions = {
  /** Compact chrome (< lg): overlay sidebar + bottom nav */
  compact: boolean;
  /** Desktop sidebar width inset CSS length (e.g. 13.5rem / 4.5rem) */
  mainInsetLeft?: string;
  /** Copyright / app footer height when it is still visible */
  appFooterHeightPx?: number;
  /** Wizard/action bar currently mounted */
  wizardActive?: boolean;
};

/**
 * Writes CSS variables used by `.hcms-wizard-sticky-footer` / `.hcms-action-sticky-footer`.
 * Uses pixel bottoms (not nested calc) for older WebViews.
 */
export function syncStickyActionBarInsets(opts: SyncStickyActionBarInsetsOptions): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const wizardActive =
    opts.wizardActive ?? root.classList.contains('hcms-wizard-active');
  const vvGap = visualViewportBottomGap();
  const keyboardOpen = isVisualKeyboardOpen(vvGap);

  if (opts.compact) {
    root.style.setProperty('--hcms-main-inset-left', '0px');
    // When the keyboard is open, sit above the keyboard only (bottom nav is covered).
    const navH = keyboardOpen ? 0 : measureBottomNavHeight() || 68;
    root.style.setProperty('--hcms-wizard-footer-bottom', `${vvGap + navH}px`);
    root.style.setProperty('--hcms-bottom-nav-height', `${navH}px`);
    return;
  }

  root.style.setProperty('--hcms-main-inset-left', opts.mainInsetLeft ?? '4.5rem');
  root.style.setProperty('--hcms-bottom-nav-height', '0px');

  if (wizardActive) {
    // Copyright collapsed — pin to the visible bottom. Safe-area is padding inside the bar.
    root.style.setProperty('--hcms-wizard-footer-bottom', `${vvGap}px`);
    return;
  }

  const footerH = Math.max(0, opts.appFooterHeightPx ?? 0);
  root.style.setProperty('--hcms-wizard-footer-bottom', `${footerH + vvGap}px`);
}

/** Subscribe to viewport / orientation changes that affect fixed bottom bars. */
export function subscribeStickyActionBarInsets(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onChange);
  };

  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  window.addEventListener('hcms-wizard-active-change', schedule);

  const vv = window.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);

  // iOS address-bar show/hide sometimes only fires scroll on visualViewport
  document.addEventListener('visibilitychange', schedule);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    window.removeEventListener('hcms-wizard-active-change', schedule);
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    document.removeEventListener('visibilitychange', schedule);
  };
}
