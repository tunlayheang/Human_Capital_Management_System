import { navSections } from '../config/navConfig';
import { MODULE_NAV_KEYS_WITH_CHILDREN, getModuleSidebarChildren } from '../config/moduleSidebarNav';
import type { ModuleSidebarContext } from '../config/moduleSidebarNav';
import {
  isModuleSidebarChildActive,
  isNavItemActive,
  moduleSidebarChildLabel,
} from '../config/navUtils';
import { NAV_MENU_CATALOG } from '../config/navMenuCatalog';
import { resolveRoutePageMeta } from './pageRouteMeta';
import { normalizeWorkspacePath, normalizeWorkspaceSearch } from './workspaceTabs';
import {
  resolveDetailWorkspaceTabLabel,
  resolveQueryTabWorkspaceLabel,
} from './workspaceTabDetailLabels';

type TFn = (key: string) => string;

/** Human-readable workspace tab title — matches sidebar label and page header. */
export function resolveWorkspaceTabLabel(
  pathname: string,
  search: string,
  t: TFn,
  moduleCtx?: ModuleSidebarContext | null
): string {
  if (moduleCtx) {
    const meta = resolveRoutePageMeta(pathname, search, t, moduleCtx);
    if (meta?.title) return meta.title;
  }

  const path = normalizeWorkspacePath(pathname);
  const searchNorm = normalizeWorkspaceSearch(search);

  const detailLabel = resolveDetailWorkspaceTabLabel(path, searchNorm, t);
  if (detailLabel) return detailLabel;

  const queryTabLabel = resolveQueryTabWorkspaceLabel(path, searchNorm, t);
  if (queryTabLabel) return queryTabLabel;

  for (const section of navSections) {
    for (const item of section.items) {
      const itemSearch = normalizeWorkspaceSearch(item.search ?? '');
      if (item.path === path && itemSearch === searchNorm) {
        if (!item.labelKey) return item.fallbackLabel;
        const translated = t(item.labelKey);
        return translated !== item.labelKey ? translated : item.fallbackLabel;
      }
    }
  }

  if (moduleCtx) {
    for (const navKey of MODULE_NAV_KEYS_WITH_CHILDREN) {
      const children = getModuleSidebarChildren(navKey, moduleCtx);
      if (!children) continue;
      for (const child of children) {
        if (isModuleSidebarChildActive(child, path, searchNorm, children)) {
          return moduleSidebarChildLabel(child, t);
        }
      }
    }
  }

  const catalogMatch = NAV_MENU_CATALOG.filter(
    (c) => path === c.path || path.startsWith(`${c.path}/`)
  ).sort((a, b) => b.path.length - a.path.length)[0];
  if (catalogMatch) return catalogMatch.label;

  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return t('nav.dashboard') !== 'nav.dashboard' ? t('nav.dashboard') : 'Dashboard';
  return seg
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
