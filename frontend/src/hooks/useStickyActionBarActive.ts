import { useCallback, useLayoutEffect, useState, type RefCallback } from 'react';
import { subscribeStickyActionBarInsets } from '../utils/stickyActionBarInsets';

export const HCMS_WIZARD_ACTIVE_EVENT = 'hcms-wizard-active-change';

/**
 * Marks the document when a fixed bottom action/wizard bar is mounted so
 * Layout can clear copyright inset and chat FAB can lift out of the way.
 * Returns a callback ref to attach to the bar element for height measurement.
 */
export function useStickyActionBarActive(active = true): RefCallback<HTMLDivElement> {
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);

  const barRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setBarEl(node);
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add('hcms-wizard-active');
    window.dispatchEvent(new Event(HCMS_WIZARD_ACTIVE_EVENT));
    return () => {
      root.classList.remove('hcms-wizard-active');
      root.style.removeProperty('--hcms-wizard-footer-height');
      window.dispatchEvent(new Event(HCMS_WIZARD_ACTIVE_EVENT));
    };
  }, [active]);

  useLayoutEffect(() => {
    if (!active || !barEl) return;
    const syncHeight = () => {
      // Use border-box height so padding/safe-area are included in scroll clearance.
      document.documentElement.style.setProperty(
        '--hcms-wizard-footer-height',
        `${Math.ceil(barEl.getBoundingClientRect().height)}px`
      );
    };
    syncHeight();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeight) : null;
    ro?.observe(barEl);
    const unsubscribe = subscribeStickyActionBarInsets(syncHeight);
    return () => {
      ro?.disconnect();
      unsubscribe();
    };
  }, [active, barEl]);

  return barRef;
}
