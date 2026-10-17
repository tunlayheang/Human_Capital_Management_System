import React from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ListIconButton, listIconButtonClass } from './ListIconButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './shadcn/dropdown-menu';

export type ResponsiveRowAction = {
  key?: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type ResponsiveRowActionsProps = {
  actions: ResponsiveRowAction[];
  menuLabel?: string;
  className?: string;
  inlineClassName?: string;
  dropdownAlign?: 'start' | 'center' | 'end';
  /**
   * `auto` — icon row from `inlineFrom` up, menu below.
   * `menu` — always a compact ⋮ menu (better for dense tables).
   */
  mode?: 'auto' | 'menu';
  /** Min breakpoint for inline icons when mode is `auto`. Default `md`. */
  inlineFrom?: 'md' | 'lg' | 'xl';
};

function ActionsMenu({
  actions,
  menuLabel,
  dropdownAlign,
}: {
  actions: ResponsiveRowAction[];
  menuLabel: string;
  dropdownAlign: 'start' | 'center' | 'end';
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={menuLabel}
          title={menuLabel}
          className={listIconButtonClass}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={dropdownAlign}
        className="min-w-[11rem]"
        onClick={(event) => event.stopPropagation()}
      >
        {actions.map((action, index) => (
          <DropdownMenuItem
            key={action.key ?? `${action.label}-${index}`}
            disabled={action.disabled}
            className={cn(
              'gap-2',
              action.destructive &&
                'text-rose-600 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-300'
            )}
            onSelect={(event) => {
              event.preventDefault();
              if (action.disabled) return;
              action.onClick();
            }}
          >
            {action.icon ?? <MoreVertical className="w-4 h-4" />}
            <span>{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResponsiveRowActions({
  actions,
  menuLabel = 'Open actions',
  className,
  inlineClassName,
  dropdownAlign = 'end',
  mode = 'auto',
  inlineFrom = 'md',
}: ResponsiveRowActionsProps) {
  const visibleActions = actions.filter(Boolean);
  if (!visibleActions.length) return null;

  if (mode === 'menu') {
    return (
      <div className={cn('inline-flex items-center justify-end', className)}>
        <ActionsMenu
          actions={visibleActions}
          menuLabel={menuLabel}
          dropdownAlign={dropdownAlign}
        />
      </div>
    );
  }

  const inlineVisible =
    inlineFrom === 'xl'
      ? 'hidden xl:flex'
      : inlineFrom === 'lg'
        ? 'hidden lg:flex'
        : 'hidden md:flex';
  const menuVisible =
    inlineFrom === 'xl'
      ? 'xl:hidden'
      : inlineFrom === 'lg'
        ? 'lg:hidden'
        : 'md:hidden';

  return (
    <div className={cn('inline-flex items-center justify-end', className)}>
      <div className={cn(inlineVisible, 'items-center justify-end gap-1.5 flex-wrap', inlineClassName)}>
        {visibleActions.map((action, index) => (
          <ListIconButton
            key={action.key ?? `${action.label}-${index}`}
            label={action.label}
            icon={action.icon ?? <MoreVertical className="w-4 h-4" />}
            disabled={action.disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (action.disabled) return;
              action.onClick();
            }}
          />
        ))}
      </div>

      <div className={menuVisible}>
        <ActionsMenu
          actions={visibleActions}
          menuLabel={menuLabel}
          dropdownAlign={dropdownAlign}
        />
      </div>
    </div>
  );
}
