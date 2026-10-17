import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useMenuConfigOptional } from '../context/MenuConfigContext';
import { usePinLock } from '../context/PinLockContext';
import {
  filterNavSections,
  isModuleSidebarChildActive,
  isNavItemActive,
  moduleSidebarChildLabel,
} from '../config/navUtils';
import type { NavItemConfig } from '../config/navConfig';
import { getVisibleModuleChildren } from '../config/moduleSidebarNav';
import { useModuleSidebarContext } from './useModuleSidebarContext';

export type BreadcrumbCrumb = { label: string; href?: string };

function navItemLabel(item: NavItemConfig, t: (key: string) => string): string {
  const key = item.labelKey?.trim();
  if (key) {
    const translated = t(key);
    if (translated && translated !== key && !translated.includes('.')) {
      return translated;
    }
  }
  return item.fallbackLabel;
}

function navItemHref(item: NavItemConfig): string {
  return `${item.path}${item.search ?? ''}`;
}

function childHref(path: string, search?: string): string {
  return `${path}${search ?? ''}`;
}

export function useAppBreadcrumbs(): { crumbs: BreadcrumbCrumb[]; pageTitle: string } {
  const { pathname, search } = useLocation();
  const { hasRole, hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const menuConfig = useMenuConfigOptional();
  const { restrictNavToDashboard } = usePinLock();
  const moduleCtx = useModuleSidebarContext();

  return useMemo(() => {
    const homeLabel = t('nav.home') || 'Home';
    const dashboardLabel = t('nav.dashboard') || 'Dashboard';
    const crumbs: BreadcrumbCrumb[] = [{ label: homeLabel, href: '/dashboard' }];

    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
      crumbs.push({ label: dashboardLabel });
      return { crumbs, pageTitle: dashboardLabel };
    }

    const sections = filterNavSections(
      hasRole,
      menuConfig?.isPathVisible,
      hasPermission,
      user?.role,
      { dashboardOnly: restrictNavToDashboard }
    );

    for (const section of sections) {
      for (const item of section.items) {
        const children = getVisibleModuleChildren(item.navKey, moduleCtx);
        if (children?.length) {
          const activeChild = children.find((c) =>
            isModuleSidebarChildActive(c, pathname, search, children)
          );
          if (activeChild) {
            const parentLabel = navItemLabel(item, t);
            crumbs.push({ label: parentLabel, href: navItemHref(item) });
            const childLabel = moduleSidebarChildLabel(activeChild, t);
            crumbs.push({ label: childLabel });
            return { crumbs, pageTitle: childLabel };
          }
        }

        if (isNavItemActive(item, pathname, search)) {
          const label = navItemLabel(item, t);
          crumbs.push({ label });
          return { crumbs, pageTitle: label };
        }
      }
    }

    const segment = pathname.split('/').filter(Boolean).pop();
    const fallback =
      segment?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Page';
    crumbs.push({ label: fallback });
    return { crumbs, pageTitle: fallback };
  }, [
    pathname,
    search,
    hasRole,
    hasPermission,
    user?.role,
    menuConfig?.isPathVisible,
    restrictNavToDashboard,
    moduleCtx,
    t,
  ]);
}
