import React from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../ui/page/PageHeader';
import { useRoutePageMeta, useSyncDocumentTitle } from '../../hooks/useRoutePageMeta';
import { shouldSkipAutoPageHeader } from '../../utils/pageRouteMeta';

type Props = {
  className?: string;
};

/**
 * Renders the glass page hero for sidebar routes.
 * Module pages that already include PageHeader opt out via shouldSkipAutoPageHeader.
 */
export const LayoutPageHeader: React.FC<Props> = ({ className = '' }) => {
  const { pathname } = useLocation();
  const meta = useRoutePageMeta();

  useSyncDocumentTitle(meta?.title);

  if (!meta || shouldSkipAutoPageHeader(pathname)) return null;

  return (
    <PageHeader
      className={className}
      title={meta.title}
      subtitle={meta.subtitle}
      iconComponent={meta.icon}
    />
  );
};
