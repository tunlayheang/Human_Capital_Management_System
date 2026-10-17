import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Shared input/select classes for modal forms (rounded fields; use modalTextareaClass for multiline). */
export const modalInputClass = 'hcms-modal-field-input';

export const modalTextareaClass = 'hcms-modal-textarea';

export function ModalFormSection({
  title,
  icon: Icon,
  description,
  children,
  className = '',
}: {
  title?: string;
  icon?: LucideIcon;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hcms-modal-form-section ${className}`.trim()}>
      {title ? (
        <div className="space-y-1 pb-1 border-b border-slate-200/70 dark:border-slate-700/70">
          <div className="hcms-modal-section-title">
            {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
            {title}
          </div>
          {description ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pl-0.5">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function ModalField({
  label,
  htmlFor,
  required,
  hint,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`hcms-modal-field ${className}`.trim()}>
      <div className="hcms-modal-label-stack">
        <label htmlFor={htmlFor} className="hcms-modal-label">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
        {hint ? <p className="hcms-modal-hint">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Numeric / short fields in a row — labels stay one line; inputs align */
export function ModalFieldGrid({
  columns = 3,
  children,
}: {
  columns?: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  const gridClass =
    columns === 1
      ? 'grid grid-cols-1 gap-4'
      : columns === 2
        ? 'hcms-modal-grid-2'
        : 'hcms-modal-grid-3';
  return <div className={gridClass}>{children}</div>;
}

export function ModalCheckboxRow({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`hcms-modal-check-row ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
        {description ? (
          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Standard action row at the bottom of a modal form (scrolls with content; no overlap). */
export function ModalActions({
  children,
  align = 'end',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'between' | 'end';
  className?: string;
}) {
  return (
    <div
      className={`hcms-modal-actions hcms-modal-actions--${align} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function ModalFormFooter({
  onCancel,
  cancelLabel = 'Cancel',
  submitLabel,
  loading,
  children,
}: {
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="hcms-modal-actions hcms-modal-actions--between">
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="hcms-modal-btn-cancel inline-flex items-center justify-center"
      >
        {cancelLabel}
      </button>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {children}
        {typeof submitLabel === 'string' ? (
          <button
            type="submit"
            disabled={loading}
            className="hcms-modal-btn-primary inline-flex items-center justify-center"
          >
            {loading ? 'Please wait…' : submitLabel}
          </button>
        ) : (
          submitLabel
        )}
      </div>
    </div>
  );
}
