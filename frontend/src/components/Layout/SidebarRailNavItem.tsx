import React, { memo, useRef } from 'react';
import type { ElementType } from 'react';
import { NavLink } from 'react-router-dom';
import type { ModuleSidebarChild } from '../../config/moduleSidebarNav';
import { useSidebarRailHover } from '../../hooks/useSidebarRailHover';
import { SidebarRailFlyout } from './SidebarRailFlyout';

type Props = {
  enabled: boolean;
  navKey: string;
  label: string;
  labelKey?: string;
  to: string;
  search?: string;
  icon: ElementType;
  end?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  className: string | ((props: { isActive: boolean; isPending: boolean }) => string);
  /** When set, hover shows full submenu; otherwise a single link row */
  subItems?: ModuleSidebarChild[];
  children?: React.ReactNode;
};

export const SidebarRailNavItem: React.FC<Props> = memo(function SidebarRailNavItem({
  enabled,
  navKey,
  label,
  labelKey,
  to,
  search,
  icon: Icon,
  end,
  onClick,
  className,
  subItems,
  children,
}) {
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const { open, openMenu, scheduleClose, closeMenu } = useSidebarRailHover(enabled);

  const flyoutItems: ModuleSidebarChild[] =
    subItems ?? [
      {
        navKey,
        labelKey,
        fallbackLabel: label,
        path: to,
        icon: Icon,
        search,
      },
    ];

  return (
    <>
      <NavLink
        ref={triggerRef}
        to={search ? { pathname: to, search } : to}
        end={end}
        onClick={onClick}
        onMouseEnter={enabled ? openMenu : undefined}
        onMouseLeave={enabled ? scheduleClose : undefined}
        className={className}
      >
        {children ?? <Icon className="w-5 h-5 shrink-0" />}
      </NavLink>

      {enabled && (
        <SidebarRailFlyout
          open={open}
          label={label}
          anchorRef={triggerRef}
          subItems={flyoutItems}
          onClose={closeMenu}
          hoverMode
          hideHeader={!subItems}
          onPanelMouseEnter={openMenu}
          onPanelMouseLeave={scheduleClose}
        />
      )}
    </>
  );
});
