/**
 * Runtime browser capability detection + mobile viewport height fix.
 * Sets CSS variables/classes on <html> so layout works without dvh / backdrop-filter / overflow:clip.
 *
 * Note: do NOT set CSS `zoom` on <html> — it breaks `position: fixed` wizard/action bars in Chromium.
 */

function setViewportHeightUnit(): void {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--hcms-vh', `${vh}px`);
}

function supportsCss(property: string, value: string): boolean {
  try {
    return typeof CSS !== 'undefined' && CSS.supports(property, value);
  } catch {
    return false;
  }
}

function detectFlexGap(): boolean {
  try {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.rowGap = '1px';
    el.appendChild(document.createElement('div'));
    el.appendChild(document.createElement('div'));
    document.body.appendChild(el);
    const supported = el.scrollHeight === 1;
    document.body.removeChild(el);
    return supported;
  } catch {
    return true;
  }
}

/** Call once before React mount. */
export function initBrowserCompat(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = document.documentElement;

  // Clear any previous zoom compensation that clipped fixed footers.
  root.style.removeProperty('zoom');

  setViewportHeightUnit();
  window.addEventListener('resize', setViewportHeightUnit, { passive: true });
  window.addEventListener('orientationchange', setViewportHeightUnit, { passive: true });

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', setViewportHeightUnit, { passive: true });
    vv.addEventListener('scroll', setViewportHeightUnit, { passive: true });
  }

  if (!supportsCss('height', '100dvh')) {
    root.classList.add('hcms-no-dvh');
  }

  const hasBackdrop =
    supportsCss('backdrop-filter', 'blur(1px)') ||
    supportsCss('-webkit-backdrop-filter', 'blur(1px)');
  if (!hasBackdrop) {
    root.classList.add('hcms-no-backdrop');
  }

  if (!supportsCss('overflow', 'clip')) {
    root.classList.add('hcms-no-overflow-clip');
  }

  if (!detectFlexGap()) {
    root.classList.add('hcms-no-flex-gap');
  }

  // Stable class for QA / support (not used for styling)
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) root.dataset.browser = 'edge';
  else if (/Firefox\//.test(ua)) root.dataset.browser = 'firefox';
  else if (/Chrome\//.test(ua)) root.dataset.browser = 'chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) root.dataset.browser = 'safari';
}
