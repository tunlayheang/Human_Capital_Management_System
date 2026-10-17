import React from 'react';
import type { RulesConfigHelpContent, RulesConfigHelpId } from '../../content/rulesConfigHelpContent';
import { RulesConfigHelp } from './RulesConfigHelp';
import { Card as ShadcnCard } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  help?: RulesConfigHelpId | RulesConfigHelpContent;
}

export const Card: React.FC<CardProps> = ({
  title,
  children,
  action,
  className = '',
  icon,
  help,
}) => (
  <ShadcnCard
    className={cn(
      'glass-card relative p-3 xs:p-3.5 sm:p-5 md:p-6 transition-all duration-300 hover:shadow-glass',
      className
    )}
  >
    {help && (
      <RulesConfigHelp
        help={help}
        className={cn(
          'absolute z-20',
          title || action || icon ? 'top-3 right-3 sm:top-4 sm:right-4 md:top-5 md:right-5' : 'top-2.5 right-2.5 sm:top-3 sm:right-3'
        )}
      />
    )}
    {(title || action || icon) && (
      <div
        className={cn(
          'mb-3 flex items-center justify-between border-b border-white/40 pb-2.5 sm:mb-4 sm:pb-3 md:mb-5 md:pb-4 dark:border-white/10',
          help && 'pr-10'
        )}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {icon && (
            <div className="shrink-0 rounded-lg glass-inset p-1.5 sm:p-2">{icon}</div>
          )}
          {title && (
            <h3 className="truncate text-base sm:text-lg font-bold tracking-tight text-slate-800 dark:text-white">
              {title}
            </h3>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )}
    {children}
  </ShadcnCard>
);
