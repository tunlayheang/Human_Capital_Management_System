/** Portal target over Layout page body (below header; includes workspace tabs when enabled). */
export const APP_OVERLAY_ROOT_ID = 'app-overlay-root';

/** Fixed wizard Back/Continue bars — always mounted on document.body to avoid overflow/transform clipping. */
export const WIZARD_FOOTER_ROOT_ID = 'hcms-wizard-footer-root';

/** Fixed messenger dock — no backdrop; clicks pass through except the panel. */
export const CHAT_WIDGET_ROOT_ID = 'chat-widget-root';

/**
 * Ensure the wizard footer host lives on `document.body` (never inside Layout's
 * overflow-hidden shell — that clips position:fixed bars on short viewports).
 */
export function ensureWizardFooterRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('ensureWizardFooterRoot requires document');
  }
  let el = document.getElementById(WIZARD_FOOTER_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = WIZARD_FOOTER_ROOT_ID;
    el.className = 'pointer-events-none [&>*]:pointer-events-auto';
    el.setAttribute('aria-hidden', 'true');
  }
  if (el.parentElement !== document.body) {
    document.body.appendChild(el);
  }
  return el;
}

export function getWizardFooterRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return ensureWizardFooterRoot();
}

/** Header chrome (tab bar menus, etc.) — above page content, below full modals. */
export const Z_CHROME_MENU = 280;

/** Floating chat dock + FAB (see ChatWidget). */
export const Z_CHAT_WIDGET = 281;

/** Toast notifications — above chat FAB so messages stay readable. */
export const Z_TOAST = 290;

/** Mobile bottom sheets / blocking dialogs — above chat FAB, below PIN. */
export const Z_SHEET = 285;

/** Full-screen security PIN lock — above all app chrome including chat and toasts. */
export const Z_PIN_LOCK = 300;

export const Z_PAGE_OVERLAY = 200;

/** Fixed dropdown aligned to bottom-right of anchor (viewport coords). */
export function fixedMenuBelowAnchor(
  anchorRect: DOMRect,
  minWidth = 200
): { top: number; right: number; minWidth: number } {
  return {
    top: anchorRect.bottom + 4,
    right: Math.max(8, window.innerWidth - anchorRect.right),
    minWidth,
  };
}

export function getOverlayPortalRoot(): HTMLElement {
  return document.getElementById(APP_OVERLAY_ROOT_ID) ?? document.body;
}

/**
 * Portal target for blocking overlays (Modal, ConfirmDialog, etc.).
 * Wizard/action bars mount on `document.body` (z-45). Page-scoped
 * `#app-overlay-root` cannot paint above them, so while a sticky bar is
 * active (`html.hcms-wizard-active`) overlays lift to `document.body`.
 */
export function getModalOverlayPortalRoot(): HTMLElement {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('hcms-wizard-active')
  ) {
    return document.body;
  }
  return getOverlayPortalRoot();
}

export function isPageScopedOverlay(root: HTMLElement = getOverlayPortalRoot()): boolean {
  return root.id === APP_OVERLAY_ROOT_ID;
}

/** `absolute` within main column; `fixed` when portaling to document.body (login, etc.). */
export function overlayPositionClass(root: HTMLElement = getOverlayPortalRoot()): 'absolute' | 'fixed' {
  return isPageScopedOverlay(root) ? 'absolute' : 'fixed';
}

/** Anchor in header → fixed popover coords (viewport). */
export function anchorRectToViewportStyle(anchorRect: DOMRect): {
  top: number;
  right: number;
  width: number;
} {
  const width = Math.min(420, Math.max(320, window.innerWidth - 24));
  const right = Math.max(8, window.innerWidth - anchorRect.right);
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - 120);
  return { top, right, width };
}

/** Anchor inside page overlay → coords relative to overlay root. */
export function anchorRectToOverlayStyle(
  anchorRect: DOMRect,
  root: HTMLElement = getOverlayPortalRoot()
): { top: number; right: number; left: number; width: number } {
  const rootRect = root.getBoundingClientRect();
  const width = Math.min(420, Math.max(320, rootRect.width - 24));
  const right = Math.max(8, rootRect.right - anchorRect.right);
  const top = Math.min(anchorRect.bottom + 8 - rootRect.top, rootRect.height - 120);
  return { top, right, left: rootRect.left, width };
}

type SavedSiblingA11y = { ariaHidden: string | null; hadInert: boolean };

function restoreSiblingA11y(child: Element, prev: SavedSiblingA11y) {
  if (prev.ariaHidden === null) child.removeAttribute('aria-hidden');
  else child.setAttribute('aria-hidden', prev.ariaHidden);
  if (prev.hadInert) child.setAttribute('inert', '');
  else child.removeAttribute('inert');
}

/**
 * When portaled overlays mount in #app-overlay-root, remove aria-hidden from the host
 * (so focused dialog controls stay exposed to AT) and hide sibling page chrome instead.
 */
export function attachPageOverlayAccessibilityManager(root: HTMLElement): () => void {
  const parent = root.parentElement;
  if (!parent) return () => {};

  const hidden = new Map<Element, SavedSiblingA11y>();

  const apply = () => {
    const active = root.childElementCount > 0;
    if (active) {
      root.removeAttribute('aria-hidden');
      for (const child of parent.children) {
        if (child === root) continue;
        if (!hidden.has(child)) {
          hidden.set(child, {
            ariaHidden: child.getAttribute('aria-hidden'),
            hadInert: child.hasAttribute('inert'),
          });
        }
        child.setAttribute('aria-hidden', 'true');
        child.setAttribute('inert', '');
      }
      return;
    }

    root.setAttribute('aria-hidden', 'true');
    for (const [child, prev] of hidden) {
      restoreSiblingA11y(child, prev);
    }
    hidden.clear();
  };

  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true });
  apply();

  return () => {
    observer.disconnect();
    root.setAttribute('aria-hidden', 'true');
    for (const [child, prev] of hidden) {
      restoreSiblingA11y(child, prev);
    }
    hidden.clear();
  };
}
