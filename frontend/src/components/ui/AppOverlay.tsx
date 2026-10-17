import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  getModalOverlayPortalRoot,
  overlayPositionClass,
  WIZARD_FOOTER_ROOT_ID,
} from '../../utils/overlayPortal';

export type AppOverlayAlign = 'center' | 'top';

type Props = {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  zIndexClass?: string;
  backdrop?: 'dim' | 'transparent' | 'none';
  className?: string;
  align?: AppOverlayAlign;
  lockScroll?: boolean;
  hostRef?: React.RefObject<HTMLElement | null>;
};

export const AppOverlay: React.FC<Props> = ({
  open,
  onClose,
  children,
  zIndexClass = 'z-[250]',
  backdrop = 'dim',
  className = '',
  align = 'center',
  lockScroll = true,
  hostRef,
}) => {
  useEffect(() => {
    if (!open || !lockScroll || hostRef) return;
    const root = hostRef?.current ?? getModalOverlayPortalRoot();
    const mainEl =
      root.id === 'app-overlay-root'
        ? (root.parentElement?.querySelector('main') as HTMLElement | null)
        : null;
    const targets = mainEl ? [mainEl] : [document.documentElement];
    const prev = targets.map((el) => el.style.overflow);
    targets.forEach((el) => {
      el.style.overflow = 'hidden';
    });
    return () => {
      targets.forEach((el, i) => {
        el.style.overflow = prev[i] ?? '';
      });
    };
  }, [open, lockScroll, hostRef]);

  // Sticky wizard/action bars live on body above page-scoped overlays — inert them
  // while a body-lifted modal is open so Back/Next/Save cannot steal focus/clicks.
  useEffect(() => {
    if (!open || hostRef) return;
    if (!document.documentElement.classList.contains('hcms-wizard-active')) return;
    const footerRoot = document.getElementById(WIZARD_FOOTER_ROOT_ID);
    if (!footerRoot) return;
    const prevHidden = footerRoot.getAttribute('aria-hidden');
    const hadInert = footerRoot.hasAttribute('inert');
    footerRoot.setAttribute('aria-hidden', 'true');
    footerRoot.setAttribute('inert', '');
    return () => {
      if (prevHidden === null) footerRoot.removeAttribute('aria-hidden');
      else footerRoot.setAttribute('aria-hidden', prevHidden);
      if (!hadInert) footerRoot.removeAttribute('inert');
    };
  }, [open, hostRef]);

  if (!open) return null;

  const hostEl = hostRef?.current;
  if (hostRef && !hostEl) return null;

  const root = hostEl ?? getModalOverlayPortalRoot();
  const position = hostEl ? 'absolute' : overlayPositionClass(root);
  const pageScoped = !hostEl && root.id === 'app-overlay-root';

  const backdropClass =
    backdrop === 'dim'
      ? 'bg-black/40 backdrop-blur-[2px]'
      : backdrop === 'transparent'
        ? 'bg-transparent'
        : '';

  const hostScoped = Boolean(hostEl);

  const alignClass =
    align === 'top'
      ? 'items-start justify-center pt-2 pb-3 sm:pt-3 sm:pb-4'
      : 'items-center justify-center py-1.5 sm:py-4';

  const padClass = hostScoped
    ? 'p-2 rounded-2xl'
    : pageScoped
      ? 'px-1.5 sm:px-3'
      : 'p-3 sm:p-5 lg:p-6';

  return createPortal(
    <div
      className={`${position} inset-0 ${zIndexClass} flex min-h-0 overflow-hidden ${alignClass} ${padClass} ${backdropClass} animate-in fade-in duration-200 ${className}`}
      role="presentation"
      onClick={onClose}
    >
      {children}
    </div>,
    root
  );
};
