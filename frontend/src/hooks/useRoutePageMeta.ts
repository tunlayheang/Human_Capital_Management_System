import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useModuleSidebarContext } from './useModuleSidebarContext';
import { resolveRoutePageMeta } from '../utils/pageRouteMeta';

export function useRoutePageMeta() {
  const { pathname, search } = useLocation();
  const { t } = useLanguage();
  const moduleCtx = useModuleSidebarContext();

  return useMemo(
    () => resolveRoutePageMeta(pathname, search, t, moduleCtx),
    [pathname, search, t, moduleCtx]
  );
}

/** Keep browser tab title aligned with the in-page header title. */
export function useSyncDocumentTitle(title?: string | null, suffix = 'HCMS') {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · ${suffix}`;
    return () => {
      document.title = prev;
    };
  }, [title, suffix]);
}
