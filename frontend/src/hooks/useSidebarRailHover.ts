import { useCallback, useRef, useState } from 'react';

const HOVER_CLOSE_MS = 150;

/** Delayed close + open helpers for sidebar rail hover menus */
export function useSidebarRailHover(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const openMenu = useCallback(() => {
    if (!enabled) return;
    cancelClose();
    setOpen(true);
  }, [enabled, cancelClose]);

  const scheduleClose = useCallback(() => {
    if (!enabled) return;
    cancelClose();
    hideTimerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  }, [enabled, cancelClose]);

  const closeMenu = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  return { open, openMenu, scheduleClose, closeMenu };
}
