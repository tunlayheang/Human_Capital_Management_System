import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbCrumb } from '@/hooks/useAppBreadcrumbs';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/shadcn/breadcrumb';

type Props = {
  crumbs: BreadcrumbCrumb[];
  pageTitle: string;
  className?: string;
};

export const AppBreadcrumbs: React.FC<Props> = ({ crumbs, pageTitle, className = '' }) => {
  const trail = crumbs.length > 1 ? crumbs.slice(1) : crumbs;

  return (
    <div className={`min-w-0 flex-1 ${className}`.trim()}>
      <Breadcrumb>
        <BreadcrumbList className="flex-nowrap gap-0.5 sm:gap-1 text-[11px] sm:text-xs">
          {trail.map((crumb, idx) => {
            const isLast = idx === trail.length - 1;
            return (
              <React.Fragment key={`${crumb.label}-${idx}`}>
                {idx > 0 ? (
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
                  </BreadcrumbSeparator>
                ) : null}
                <BreadcrumbItem className="min-w-0">
                  {isLast || !crumb.href ? (
                    <BreadcrumbPage className="truncate max-w-[10rem] sm:max-w-[14rem] font-medium text-muted-foreground">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link
                        to={crumb.href}
                        className="truncate max-w-[8rem] sm:max-w-[12rem] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="text-sm sm:text-base font-semibold text-foreground leading-tight truncate mt-0.5">
        {pageTitle}
      </h1>
    </div>
  );
};
