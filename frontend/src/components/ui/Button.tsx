import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import {
  Button as ShadcnButton,
  buttonVariants as shadcnButtonVariants,
} from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconOnly?: boolean;
}

const variantMap: Record<ButtonVariant, React.ComponentProps<typeof ShadcnButton>['variant']> = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
  outline: 'outline',
};

const sizeMap: Record<ButtonSize, React.ComponentProps<typeof ShadcnButton>['size']> = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
};

export function getButtonClassName(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = ''
) {
  return cn(
    shadcnButtonVariants({ variant: variantMap[variant], size: sizeMap[size] }),
    'rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2',
    variant === 'primary' && 'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500',
    variant === 'secondary' &&
      'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600',
    variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
    className
  );
}

type ButtonLinkProps = LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
};

export const ButtonLink: React.FC<ButtonLinkProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) => (
  <Link
    {...props}
    className={cn(
      'relative z-10 cursor-pointer pointer-events-auto',
      getButtonClassName(variant, size, className)
    )}
  >
    {children}
  </Link>
);

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  icon,
  iconOnly,
  className = '',
  disabled,
  ...props
}) => {
  const hasLabel = Boolean(children);
  const isIconOnly = iconOnly ?? (Boolean(icon) && !hasLabel && !isLoading);

  return (
    <ShadcnButton
      variant={variantMap[variant]}
      size={isIconOnly ? 'icon' : sizeMap[size]}
      className={cn(
        'rounded-lg',
        variant === 'primary' &&
          'bg-primary-600 text-white shadow hover:bg-primary-700 focus-visible:ring-primary-500',
        variant === 'secondary' &&
          'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
        isIconOnly && '!px-2.5',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <Loader2 className={cn('h-4 w-4 animate-spin', !isIconOnly && hasLabel && 'mr-2')} />
      )}
      {!isLoading && icon && <span className={hasLabel ? 'mr-2' : ''}>{icon}</span>}
      {children}
    </ShadcnButton>
  );
};
