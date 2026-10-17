import React from 'react';
import { cn } from '@/lib/utils';
import { listToolbarIconPillClass } from '../../../constants/designSystem';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Lucide (or similar) icon element. */
  icon: React.ReactNode;
};

/**
 * Circular list-toolbar control — same chrome as {@link ExportFormatMenu} icon trigger
 * and filter pills (not the grey rounded-square outline Button).
 */
export const ListToolbarIconButton = React.forwardRef<HTMLButtonElement, Props>(
  ({ icon, className, type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(listToolbarIconPillClass, className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
);

ListToolbarIconButton.displayName = 'ListToolbarIconButton';

/** Icon size used by list toolbar import / export / refresh controls. */
export const listToolbarGlyphClass = 'w-[1.05rem] h-[1.05rem]';
