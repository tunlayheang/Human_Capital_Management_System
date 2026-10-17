import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  shouldPromptLeaveNavigation,
  tryLeaveWithUnsavedChanges,
} from '../../utils/unsavedChangesGuard';
import { useAuth } from '../../context/AuthContext';
import { usePinLock } from '../../context/PinLockContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMenuConfigOptional } from '../../context/MenuConfigContext';
import {
  filterNavSections,
  filterSidebarFooterItems,
  isModuleSidebarChildActive,
  isNavItemActive,
} from '../../config/navUtils';
import { getVisibleModuleChildren } from '../../config/moduleSidebarNav';
import { SidebarModuleGroup } from './SidebarModuleGroup';
import { SidebarRailNavItem } from './SidebarRailNavItem';
import { SidebarRailAction } from './SidebarRailAction';
import { useModuleSidebarContext } from '../../hooks/useModuleSidebarContext';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { Logo } from '../ui/Logo';
import { LogOut, ChevronLeft, X } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  isMobile?: boolean;
  /** Viewport &lt; lg — drawer over content */
  isOverlayLayout?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = memo(function Sidebar({
  isOpen,
  toggleSidebar,
  isMobile: _isMobile = false,
  isOverlayLayout = false,
}) {
  const { logout, hasRole, hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const { goTo, tabsEnabled } = useWorkspaceNavigate();
  const menuConfig = useMenuConfigOptional();
  const { restrictNavToDashboard } = usePinLock();
  const moduleSidebarCtx = useModuleSidebarContext();
  const isOverlay = isOverlayLayout;
  const showLabels = isOpen;
  const isRail = !showLabels && !isOverlay;

  const sections = useMemo(
    () =>
      filterNavSections(
        hasRole,
        menuConfig?.isPathVisible,
        hasPermission,
        user?.role,
        { dashboardOnly: restrictNavToDashboard }
      ),
    [hasRole, menuConfig?.isPathVisible, hasPermission, user?.role, restrictNavToDashboard]
  );
  const footerItems = useMemo(
    () =>
      filterSidebarFooterItems(
        hasRole,
        menuConfig?.isPathVisible,
        hasPermission,
        restrictNavToDashboard,
        user?.role
      ),
    [hasRole, menuConfig?.isPathVisible, hasPermission, restrictNavToDashboard, user?.role]
  );

  const activeModuleNavKey = useMemo(() => {
    for (const section of sections) {
      for (const item of section.items) {
        const children = getVisibleModuleChildren(item.navKey, moduleSidebarCtx);
        if (
          children?.some((c) =>
            isModuleSidebarChildActive(c, location.pathname, location.search, children)
          )
        ) {
          return item.navKey;
        }
      }
    }
    return null;
  }, [sections, moduleSidebarCtx, location.pathname, location.search]);

  const [expandedNavKey, setExpandedNavKey] = useState<string | null>(null);
  const prevIsOpenRef = useRef(isOpen);

  /** Auto-expand active module on route change; collapse when leaving module routes */
  useEffect(() => {
    if (!isOpen) return;
    if (activeModuleNavKey) {
      setExpandedNavKey(activeModuleNavKey);
    } else {
      setExpandedNavKey(null);
    }
  }, [activeModuleNavKey, isOpen]);

  /** Collapse dropdown when sidebar closes; restore when it opens */
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (!isOverlay && wasOpen && !isOpen) {
      setExpandedNavKey(null);
    } else if (isOpen && !wasOpen && activeModuleNavKey) {
      setExpandedNavKey(activeModuleNavKey);
    }
  }, [isOpen, isOverlay, activeModuleNavKey]);

  const handleToggleModule = useCallback((navKey: string) => {
    setExpandedNavKey((prev) => (prev === navKey ? null : navKey));
  }, []);

  const navItemClass = isOverlay ? 'min-h-[44px]' : '';
  const navLinkLayout = showLabels
    ? 'gap-2.5 px-2.5 py-2'
    : 'justify-center gap-0 px-0 py-2';

  const sidebarClass = isOverlay
    ? `fixed left-0 top-0 z-[60] hcms-sidebar-height w-[min(20rem,calc(100vw-env(safe-area-inset-left)-env(safe-area-inset-right)))] max-w-[85vw] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] glass-nav border-r shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ease-out motion-reduce:transition-none ${isOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}`
    : `fixed left-0 top-0 z-50 hidden lg:flex hcms-sidebar-height lg:h-screen lg:max-h-none glass-nav border-r shadow-xl flex-col overflow-hidden transition-all duration-300 motion-reduce:transition-none ${isOpen ? 'w-[13.5rem] translate-x-0' : 'w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] translate-x-0'}`;

  const linkClass = (active: boolean) =>
    `app-sidebar-nav flex items-center rounded-lg transition-colors relative text-sm w-full min-w-0 outline-none border border-transparent ${navLinkLayout} ${navItemClass} ${
      active ? 'app-sidebar-nav--active' : 'text-sidebar-foreground/70'
    }`;

  const renderNavLink = (
    item: (typeof sections)[0]['items'][0],
    label: string
  ) => {
    const targetPath = item.path;
    const targetSearch = item.search ?? '';
    const active = isNavItemActive(item, location.pathname, location.search);
    const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isOpen) setExpandedNavKey(null);
      else if (!getVisibleModuleChildren(item.navKey, moduleSidebarCtx)) {
        setExpandedNavKey(null);
      }
      const navigateTo = () => goTo(targetPath, targetSearch);
      if (shouldPromptLeaveNavigation(location.pathname, targetPath)) {
        e.preventDefault();
        tryLeaveWithUnsavedChanges(navigateTo);
        return;
      }
      if (tabsEnabled) {
        e.preventDefault();
        navigateTo();
      }
    };

    if (isRail) {
      return (
        <SidebarRailNavItem
          key={item.navKey}
          enabled={isRail}
          navKey={item.navKey}
          label={label}
          labelKey={item.labelKey}
          to={item.path}
          search={item.search}
          icon={item.icon}
          end={item.path === '/profile'}
          onClick={onClick}
          className={({ isActive }) => linkClass(active || isActive)}
        />
      );
    }

    return (
      <NavLink
        key={item.navKey}
        to={
          item.search
            ? { pathname: item.path, search: item.search }
            : item.path
        }
        end={item.path === '/profile'}
        onClick={onClick}
        className={() => linkClass(active)}
      >
        <item.icon className="w-5 h-5 shrink-0" />
        <span className="whitespace-nowrap truncate">{label}</span>
      </NavLink>
    );
  };

  return (
    <aside
      className={sidebarClass}
      aria-hidden={isOverlay && !isOpen ? true : undefined}
      {...(isOverlay && isOpen
        ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Main navigation' }
        : {})}
    >
      <div
        className={`flex items-center shrink-0 border-b border-sidebar-border h-16 ${
          showLabels ? 'justify-between px-4' : 'justify-center px-1'
        }`}
      >
        {showLabels ? (
          <>
            <div className="overflow-hidden min-w-0">
              <Logo size="md" showSubtitle={false} align="start" />
            </div>
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-2 rounded-xl hover:bg-sidebar-accent text-muted-foreground transition-colors shrink-0 ml-auto"
              aria-label={isOverlay ? 'Close navigation menu' : 'Collapse sidebar'}
            >
              {isOverlay ? <X className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex items-center justify-center rounded-xl p-1 hover:bg-sidebar-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            aria-label="Expand navigation menu"
            title={t('nav.expandMenu') || 'Expand menu'}
          >
            <Logo size="md" showSubtitle={false} className="pointer-events-none" />
          </button>
        )}
      </div>

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden py-3 ${showLabels ? 'px-2' : 'px-1'}`}
      >
        <nav className="sidebar-rail-scroll custom-scrollbar flex min-h-0 flex-1 flex-col pr-0.5 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              {showLabels && (
                <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {section.titleKey ? t(section.titleKey) : section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const label = item.labelKey
                    ? t(item.labelKey) || item.fallbackLabel
                    : item.fallbackLabel;
                  const moduleChildren = getVisibleModuleChildren(
                    item.navKey,
                    moduleSidebarCtx
                  );

                  if (moduleChildren) {
                    return (
                      <SidebarModuleGroup
                        key={item.navKey}
                        item={item}
                        label={label}
                        subItems={moduleChildren}
                        showLabels={showLabels}
                        isOverlay={isOverlay}
                        isRail={isRail}
                        expanded={expandedNavKey === item.navKey}
                        onToggleExpanded={() => handleToggleModule(item.navKey)}
                      />
                    );
                  }

                  return renderNavLink(item, label);
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="pt-3 mt-2 border-t border-sidebar-border shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-0.5">
          {footerItems.map((item) => {
            const label = item.labelKey
              ? t(item.labelKey) || item.fallbackLabel
              : item.fallbackLabel;
            return renderNavLink(item, label);
          })}
          {isRail ? (
            <SidebarRailAction
              enabled={isRail}
              label={t('nav.logout') || 'Logout'}
              icon={LogOut}
              onAction={() => void logout()}
              className={`w-full flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 px-0 py-2.5 ${navItemClass}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => void logout()}
              className={`w-full flex items-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 ${navLinkLayout} ${navItemClass}`}
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
              <span className="whitespace-nowrap text-sm font-medium truncate">
                {t('nav.logout') || 'Logout'}
              </span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
});
