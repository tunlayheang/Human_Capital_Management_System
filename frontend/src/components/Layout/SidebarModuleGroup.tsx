import React, { memo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { NavItemConfig } from '../../config/navConfig';
import {
  MODULE_NAV_KEYS_WITH_CHILDREN,
  type ModuleSidebarChild,
} from '../../config/moduleSidebarNav';
import { isModuleSidebarChildActive, moduleSidebarChildUsesEnd } from '../../config/navUtils';
import { ChevronDown } from 'lucide-react';
import {
  shouldPromptLeaveNavigation,
  tryLeaveWithUnsavedChanges,
} from '../../utils/unsavedChangesGuard';
import { useSidebarRailHover } from '../../hooks/useSidebarRailHover';
import { SidebarRailFlyout } from './SidebarRailFlyout';
import { useLanguage } from '../../context/LanguageContext';
import { moduleSidebarChildLabel } from '../../config/navUtils';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';

type Props = {
  item: NavItemConfig;
  label: string;
  subItems: ModuleSidebarChild[];
  showLabels: boolean;
  isOverlay: boolean;
  isRail: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
};

export const SidebarModuleGroup: React.FC<Props> = memo(function SidebarModuleGroup({
  item,
  label,
  subItems,
  showLabels,
  isOverlay,
  isRail,
  expanded,
  onToggleExpanded,
}) {
  const location = useLocation();
  const { goTo, tabsEnabled } = useWorkspaceNavigate();
  const { t } = useLanguage();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const { open: railHoverOpen, openMenu, scheduleClose, closeMenu } = useSidebarRailHover(isRail);

  const childActive = subItems.some((c) =>
    isModuleSidebarChildActive(c, location.pathname, location.search, subItems)
  );

  const navTouchClass = isOverlay ? 'min-h-[44px]' : '';
  const dropdownOpen = isRail ? railHoverOpen : expanded;

  const subMenuWrapClass =
    'ml-4 pl-2 border-l border-sidebar-border space-y-0.5';

  const triggerClass = `app-sidebar-nav relative w-full flex items-center rounded-lg transition-colors text-sm min-w-0 outline-none border border-transparent ${
    showLabels ? 'gap-3 px-3 py-2' : 'justify-center gap-0 px-0 py-2'
  } ${navTouchClass} ${
    childActive
      ? 'app-sidebar-nav--active'
      : dropdownOpen
        ? 'text-sidebar-foreground'
        : 'text-sidebar-foreground/70'
  }`;

  return (
    <div className="space-y-0.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={isRail ? undefined : onToggleExpanded}
        onMouseEnter={isRail ? openMenu : undefined}
        onMouseLeave={isRail ? scheduleClose : undefined}
        className={triggerClass}
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
      >
        <item.icon className="w-5 h-5 shrink-0" />
        {showLabels && (
          <>
            <span className="flex-1 text-left whitespace-nowrap truncate">{label}</span>
            <ChevronDown
              className={`w-4 h-4 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </button>

      {isRail && (
        <SidebarRailFlyout
          open={railHoverOpen}
          label={label}
          anchorRef={triggerRef}
          subItems={subItems}
          onClose={closeMenu}
          hoverMode
          onPanelMouseEnter={openMenu}
          onPanelMouseLeave={scheduleClose}
        />
      )}

      {!isRail && dropdownOpen && (
        <div className={subMenuWrapClass}>
          {subItems.map((child) => {
            const active = isModuleSidebarChildActive(
              child,
              location.pathname,
              location.search,
              subItems
            );
            const childLinkClass = `app-sidebar-nav app-sidebar-nav--nested relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none border border-transparent ${
              active
                ? 'app-sidebar-nav--active'
                : 'text-muted-foreground hover:text-sidebar-foreground'
            } ${isOverlay ? 'min-h-[44px]' : ''}`;

            return (
              <NavLink
                key={child.navKey}
                end={moduleSidebarChildUsesEnd(child, subItems)}
                to={
                  child.search
                    ? { pathname: child.path, search: child.search }
                    : child.path
                }
                onClick={(e) => {
                  const navigateTo = () => goTo(child.path, child.search);
                  if (shouldPromptLeaveNavigation(location.pathname, child.path)) {
                    e.preventDefault();
                    tryLeaveWithUnsavedChanges(navigateTo);
                    return;
                  }
                  if (tabsEnabled) {
                    e.preventDefault();
                    navigateTo();
                  }
                }}
                className={() => childLinkClass}
              >
                <child.icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{moduleSidebarChildLabel(child, t)}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
});

export function navItemUsesModuleChildren(navKey: string): boolean {
  return MODULE_NAV_KEYS_WITH_CHILDREN.has(navKey);
}
