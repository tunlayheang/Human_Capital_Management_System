import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import type { ModuleSidebarChild } from '../../config/moduleSidebarNav';
import { isModuleSidebarChildActive, moduleSidebarChildUsesEnd } from '../../config/navUtils';
import {
  shouldPromptLeaveNavigation,
  tryLeaveWithUnsavedChanges,
} from '../../utils/unsavedChangesGuard';
import { useLanguage } from '../../context/LanguageContext';
import { moduleSidebarChildLabel } from '../../config/navUtils';

type Props = {
  open: boolean;
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  subItems: ModuleSidebarChild[];
  onClose: () => void;
  /** Hover rail menus — no full-screen backdrop */
  hoverMode?: boolean;
  /** Single-link flyouts omit the section title bar */
  hideHeader?: boolean;
  /** When set, flyout rows trigger this instead of router navigation */
  onActionSelect?: () => void;
  onPanelMouseEnter?: () => void;
  onPanelMouseLeave?: () => void;
};

export function SidebarRailFlyout({
  open,
  label,
  anchorRef,
  subItems,
  onClose,
  hoverMode = false,
  hideHeader = false,
  onActionSelect,
  onPanelMouseEnter,
  onPanelMouseLeave,
}: Props) {
  const location = useLocation();
  const { goTo, tabsEnabled } = useWorkspaceNavigate();
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;

    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const panelHeight = panelRef.current?.offsetHeight ?? 240;
      const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);
      const top = Math.min(rect.top, maxTop);
      setPosition({ top, left: rect.right + 4 });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, subItems.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  /** Label-only hover tooltips omit duplicate icons; rows stay clickable like expanded dropdowns */
  const showItemIcons = !hideHeader;
  const menuLabel =
    hideHeader && subItems.length === 1
      ? moduleSidebarChildLabel(subItems[0], t)
      : label;

  const panel = (
    <div
      ref={panelRef}
      role="menu"
      aria-label={menuLabel}
      onMouseEnter={onPanelMouseEnter}
      onMouseLeave={onPanelMouseLeave}
      className="sidebar-rail-flyout fixed z-[71] min-w-[8rem] max-w-[min(16rem,calc(100vw-5rem))] py-1.5 rounded-xl bg-sidebar border border-sidebar-border shadow-xl shadow-black/10 dark:shadow-black/40 animate-in fade-in slide-in-from-left-1 duration-150 before:absolute before:-left-2 before:top-0 before:h-full before:w-2 before:content-['']"
      style={{ top: position.top, left: position.left }}
    >
      <p
        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-sidebar-border mb-1 ${
          hideHeader ? 'hidden' : ''
        }`}
      >
        {label}
      </p>
      <div
        className={
          subItems.length > 1 && !hideHeader
            ? 'mx-2 pl-2 border-l border-sidebar-border space-y-0.5'
            : 'space-y-0.5'
        }
      >
        {subItems.map((child) => {
          const active = isModuleSidebarChildActive(
            child,
            location.pathname,
            location.search,
            subItems
          );
          const childLinkClass = active
            ? 'app-sidebar-nav--active'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer';

          if (onActionSelect) {
            return (
              <button
                key={child.navKey}
                type="button"
                role="menuitem"
                onClick={() => {
                  onActionSelect();
                  onClose();
                }}
                className={`app-sidebar-nav app-sidebar-nav--nested relative flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors text-left outline-none border border-transparent ${showItemIcons ? 'gap-2' : ''} ${childLinkClass}`}
              >
                {showItemIcons ? <child.icon className="w-4 h-4 shrink-0" /> : null}
                <span className="truncate">{moduleSidebarChildLabel(child, t)}</span>
              </button>
            );
          }

          return (
            <NavLink
              key={child.navKey}
              role="menuitem"
              end={moduleSidebarChildUsesEnd(child, subItems)}
              to={
                child.search
                  ? { pathname: child.path, search: child.search }
                  : child.path
              }
              onClick={(e) => {
                const navigateTo = () => {
                  goTo(child.path, child.search);
                  onClose();
                };
                if (shouldPromptLeaveNavigation(location.pathname, child.path)) {
                  e.preventDefault();
                  tryLeaveWithUnsavedChanges(navigateTo);
                  return;
                }
                if (tabsEnabled) {
                  e.preventDefault();
                  navigateTo();
                  return;
                }
                onClose();
              }}
              className={() =>
                `app-sidebar-nav app-sidebar-nav--nested relative flex items-center rounded-lg px-3 py-2 text-sm transition-colors outline-none border border-transparent ${showItemIcons ? 'gap-2' : ''} ${childLinkClass}`
              }
            >
              {showItemIcons ? <child.icon className="w-4 h-4 shrink-0" /> : null}
              <span className="truncate">{moduleSidebarChildLabel(child, t)}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );

  if (hoverMode) {
    return createPortal(panel, document.body);
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[70] cursor-default bg-transparent"
        aria-label="Close submenu"
        onClick={onClose}
      />
      {panel}
    </>,
    document.body
  );
}
