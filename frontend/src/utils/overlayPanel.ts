import type { ModalSize } from '../components/ui/Modal';

type OverlayPanelSize = ModalSize | 'wide' | 'confirm';

/** Centered overlay panel — pairs with `.hcms-overlay-panel--*` in index.css */
export function overlayPanelClass(size: OverlayPanelSize = 'md', extra = ''): string {
  const sizeClass =
    size === 'wide'
      ? 'hcms-overlay-panel--wide'
      : size === 'confirm'
        ? 'hcms-overlay-panel--confirm'
        : `hcms-overlay-panel--${size}`;
  return `hcms-overlay-panel ${sizeClass} flex min-h-0 flex-col overflow-hidden ${extra}`.trim();
}
