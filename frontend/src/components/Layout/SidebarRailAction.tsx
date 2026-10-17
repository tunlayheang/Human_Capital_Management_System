import React, { memo, useRef } from 'react';
import type { ElementType } from 'react';
import { useSidebarRailHover } from '../../hooks/useSidebarRailHover';
import { SidebarRailFlyout } from './SidebarRailFlyout';

type Props = {
  enabled: boolean;
  label: string;
  icon: ElementType;
  onAction: () => void;
  className?: string;
  children?: React.ReactNode;
};

/** Icon-rail button (e.g. Logout) with hover label flyout */
export const SidebarRailAction: React.FC<Props> = memo(function SidebarRailAction({
  enabled,
  label,
  icon: Icon,
  onAction,
  className = '',
  children,
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, openMenu, scheduleClose, closeMenu } = useSidebarRailHover(enabled);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onAction}
        onMouseEnter={enabled ? openMenu : undefined}
        onMouseLeave={enabled ? scheduleClose : undefined}
        className={className}
        aria-label={label}
      >
        {children ?? <Icon className="w-5 h-5 shrink-0" />}
      </button>

      {enabled && (
        <SidebarRailFlyout
          open={open}
          label={label}
          anchorRef={triggerRef}
          subItems={[
            {
              navKey: 'rail-action-logout',
              fallbackLabel: label,
              path: '/',
              icon: Icon,
            },
          ]}
          onClose={closeMenu}
          hoverMode
          hideHeader
          onActionSelect={onAction}
          onPanelMouseEnter={openMenu}
          onPanelMouseLeave={scheduleClose}
        />
      )}
    </>
  );
});
