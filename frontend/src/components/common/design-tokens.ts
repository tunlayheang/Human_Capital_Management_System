/** HCMS design tokens — aligned with shadcn/ui + Tailwind theme. */
export const designTokens = {
  colors: {
    primary: 'primary-600',
    success: 'success-600',
    warning: 'warning-600',
    danger: 'error-600',
    neutral: 'slate',
  },
  radius: {
    sm: 'rounded-md',
    md: 'rounded-lg',
    lg: 'rounded-xl',
    xl: 'rounded-2xl',
    full: 'rounded-full',
  },
  shadow: {
    card: 'shadow-soft',
    modal: 'shadow-modal',
  },
  typography: {
    pageTitle: 'text-2xl font-bold tracking-tight text-foreground',
    sectionTitle: 'text-lg font-semibold text-foreground',
    body: 'text-sm text-muted-foreground',
    label: 'hcms-field-label',
  },
} as const;
