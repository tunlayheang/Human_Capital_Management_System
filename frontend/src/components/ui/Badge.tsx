import React from 'react';
import { Badge as ShadcnBadge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  className?: string;
  title?: string;
}

const legacyVariants: Record<NonNullable<BadgeProps['variant']>, string> = {
  success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  info: 'border-transparent bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400',
  neutral: 'border-transparent bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
};

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'neutral', className = '', title }) => (
  <ShadcnBadge
    title={title}
    className={cn('rounded-full px-2.5 py-0.5 font-medium', legacyVariants[variant], className)}
  >
    {children}
  </ShadcnBadge>
);
