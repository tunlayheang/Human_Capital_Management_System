import type React from 'react';
import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/context/ThemeContext';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      offset={{ bottom: '6rem', right: '1.5rem' }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          success: 'group-[.toast]:!bg-emerald-600 group-[.toast]:!text-white group-[.toast]:!border-emerald-700',
          error: 'group-[.toast]:!bg-red-600 group-[.toast]:!text-white group-[.toast]:!border-red-700',
          warning: 'group-[.toast]:!bg-amber-500 group-[.toast]:!text-white group-[.toast]:!border-amber-600',
          info: 'group-[.toast]:!bg-primary-600 group-[.toast]:!text-white group-[.toast]:!border-primary-700',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
