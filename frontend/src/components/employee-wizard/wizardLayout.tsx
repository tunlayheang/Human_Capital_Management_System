import React from 'react';
import type { InputHTMLAttributes } from 'react';
import type { FieldPath, FieldValues, UseFormRegister } from 'react-hook-form';
import { Pencil } from 'lucide-react';
import { FieldLabel } from './FieldLabel';
import {
  type InputFilterKind,
  type InputFilterOptions,
  registerFilteredInput,
} from '../../utils/formInputFilters';
import { inputClass } from '../../constants/designSystem';

/** Shared input styles for every onboarding step (same visibility as app-wide inputs). */
export const WIZARD_INPUT_CLASS = inputClass;

export const WIZARD_SELECT_CLASS = WIZARD_INPUT_CLASS;

export const WIZARD_TEXTAREA_CLASS = `${WIZARD_INPUT_CLASS} resize-y min-h-[88px]`;

export const WIZARD_READONLY_CLASS =
  'w-full px-4 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-600/60 bg-slate-50/90 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 cursor-not-allowed text-sm';

export function WizardStepStack({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

type SectionCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: string;
  headerAside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function WizardSectionCard({
  icon: Icon,
  title,
  description,
  headerAside,
  children,
  className = '',
  bodyClassName = '',
}: SectionCardProps) {
  return (
    <section
      className={`surface-card overflow-visible ${className}`}
    >
      <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/40 dark:border-white/10 bg-white/25 dark:bg-slate-900/20 backdrop-blur-md">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        {headerAside ? <div className="shrink-0 pt-0.5">{headerAside}</div> : null}
      </div>
      <div className={`p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type BannerVariant = 'teal' | 'violet' | 'blue' | 'amber';

const BANNER_STYLES: Record<BannerVariant, string> = {
  teal: 'border-primary-200/80 dark:border-primary-800/50 bg-primary-50/70 dark:bg-primary-950/25 text-primary-900 dark:text-primary-100',
  violet:
    'border-violet-200/80 dark:border-violet-800/50 bg-violet-50/70 dark:bg-violet-950/25 text-violet-900 dark:text-violet-100',
  blue: 'border-blue-200/80 dark:border-blue-800/50 bg-blue-50/70 dark:bg-blue-950/25 text-blue-900 dark:text-blue-100',
  amber:
    'border-amber-200/80 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/25 text-amber-900 dark:text-amber-100',
};

export function WizardInfoBanner({
  icon: Icon,
  title,
  children,
  variant = 'teal',
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  children: React.ReactNode;
  variant?: BannerVariant;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 flex gap-3 ${BANNER_STYLES[variant]}`}>
      {Icon ? <Icon className="w-5 h-5 shrink-0 mt-0.5 opacity-80" aria-hidden /> : null}
      <div className="min-w-0 text-sm leading-relaxed">
        {title ? <p className="font-semibold mb-0.5">{title}</p> : null}
        <div className="text-xs opacity-90 [&_strong]:font-semibold [&_strong]:opacity-100">
          {children}
        </div>
      </div>
    </div>
  );
}

export function WizardMetaBar({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

export function WizardFieldGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4 ${className}`}>{children}</div>
  );
}

export function WizardFieldFull({ children }: { children: React.ReactNode }) {
  return <div className="md:col-span-2">{children}</div>;
}

export function WizardSubsectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="md:col-span-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

export function WizardField({
  label,
  required = false,
  error,
  hint,
  children,
  className = '',
}: {
  label: React.ReactNode;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${className} ${
        error
          ? '[&_input]:border-red-500 [&_input]:focus:border-red-500 [&_input]:focus:ring-red-500/25 [&_select]:border-red-500 [&_select]:focus:border-red-500 [&_select]:focus:ring-red-500/25 [&_textarea]:border-red-500 [&_button]:border-red-500 dark:[&_input]:border-red-500 dark:[&_select]:border-red-500'
          : ''
      }`}
    >
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function WizardHighlightPanel({
  active,
  children,
  className = '',
}: {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 transition-colors ${
        active
          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/20'
          : 'border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40'
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function WizardReviewCard({
  title,
  stepIndex,
  onEdit,
  children,
}: {
  title: string;
  stepIndex: number;
  onEdit: (index: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-card/80 overflow-hidden relative">
      <button
        type="button"
        onClick={() => onEdit(stepIndex)}
        className="absolute top-3 right-3 p-2 rounded-lg text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-colors z-10"
        aria-label={`Edit ${title}`}
      >
        <Pencil className="w-4 h-4" aria-hidden />
      </button>
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-900/40">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 pr-10">
          {title}
        </h4>
      </div>
      <div className="p-4 sm:p-5 space-y-2.5">{children}</div>
    </div>
  );
}

export function WizardReviewRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="font-medium text-slate-900 dark:text-white text-right break-all">{value}</span>
    </div>
  );
}

type WizardInputProps<T extends FieldValues> = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'name' | 'onChange' | 'onBlur' | 'ref' | 'type'
> & {
  register: UseFormRegister<T>;
  name: FieldPath<T>;
  filter?: InputFilterKind;
  filterOptions?: InputFilterOptions;
  className?: string;
};

/** Wizard text input with optional digit / letter / decimal filtering. */
export function WizardInput<T extends FieldValues = FieldValues>({
  register,
  name,
  filter = 'none',
  filterOptions,
  className = WIZARD_INPUT_CLASS,
  ...rest
}: WizardInputProps<T>) {
  const field =
    filter === 'none'
      ? register(name)
      : registerFilteredInput(register, name, filter, filterOptions);
  return <input {...field} className={className} {...rest} />;
}
