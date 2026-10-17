import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  type InputFilterKind,
  type InputFilterOptions,
  applyInputFilter,
  filterInputChange,
  inputModeForFilter,
  patternForFilter,
  registerFilteredInput,
} from '../../utils/formInputFilters';
import type { UseFormRegister, FieldPath, FieldValues } from 'react-hook-form';
import { DatePickerInput } from './shadcn/date-picker-input';

export interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  type?: string;
  error?: string;
  required?: boolean;
  icon?: React.ElementType;
  rightElement?: React.ReactNode;
  helper?: string;
  registration?: any;
  /** Live filter: digits, integer, decimal, name, letters, phone, otp, passport, etc. */
  filter?: InputFilterKind;
  filterOptions?: InputFilterOptions;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

function mergeRegistration(
  registration: Record<string, unknown> | undefined,
  filter: InputFilterKind,
  filterOptions?: InputFilterOptions
) {
  if (filter === 'none' || !registration?.onChange) return registration;
  const baseOnChange = registration.onChange as (e: React.ChangeEvent<HTMLInputElement>) => void;
  return {
    ...registration,
    inputMode: inputModeForFilter(filter),
    ...(patternForFilter(filter) ? { pattern: patternForFilter(filter) } : {}),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = applyInputFilter(filter, e.target.value, filterOptions);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      return baseOnChange(e);
    },
  };
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      registration,
      icon: Icon,
      rightElement,
      helper,
      className = '',
      filter = 'none',
      filterOptions,
      value,
      onChange,
      type,
      inputMode: inputModeProp,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined && onChange !== undefined;
    const useFilter = filter !== 'none';
    const effectiveType =
      useFilter && (filter === 'integer' || filter === 'decimal' || filter === 'digits' || filter === 'phone' || filter === 'otp')
        ? 'text'
        : type;

    const handleControlledChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!onChange) return;
      const cleaned = filterInputChange(filter, e.target.value, filterOptions);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      onChange(e);
    };

    const reg = mergeRegistration(registration, filter, filterOptions);
    const fieldClass = `w-full min-w-0 max-w-full box-border ${Icon ? 'pl-9 sm:pl-10' : 'px-3 sm:px-4'} py-2 sm:py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 dark:focus:border-primary-500 dark:text-white text-base transition-all shadow-sm placeholder:text-slate-400 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : 'hover:border-slate-400 dark:hover:border-slate-500'} ${className}`;

    return (
    <div className="space-y-1.5">
        <label className="hcms-field-label">{label}</label>
        <div className="relative group">
            {Icon && (
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon className="h-5 w-5 text-slate-400 group-focus-within:text-primary-500 transition-colors" />
                </div>
            )}
            {effectiveType === 'date' ? (
              <DatePickerInput
                ref={ref}
                className={fieldClass}
                {...(isControlled ? { value, onChange: handleControlledChange } : {})}
                {...reg}
                {...props}
              />
            ) : (
            <input 
                ref={ref}
                className={fieldClass}
                type={effectiveType}
                inputMode={useFilter ? inputModeForFilter(filter) : inputModeProp}
                {...(isControlled
                  ? { value, onChange: handleControlledChange }
                  : {})}
                {...reg}
                {...props}
            />
            )}
            {rightElement && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {rightElement}
                </div>
            )}
        </div>
        {helper && <p className="text-xs text-slate-500">{helper}</p>}
        {error && <p className="text-xs text-red-500 font-medium animate-in slide-in-from-left-1">{error}</p>}
    </div>
    );
  }
);

/** Number-like field (decimal / integer) — blocks letters while typing. */
export type NumberInputProps = Omit<InputProps, 'filter' | 'type'> & {
  filter?: 'integer' | 'decimal';
  filterOptions?: InputFilterOptions;
};

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ filter = 'decimal', filterOptions, ...rest }, ref) => (
    <Input ref={ref} filter={filter} filterOptions={filterOptions} {...rest} />
  )
);

export function registerFilteredField<T extends FieldValues>(
  register: UseFormRegister<T>,
  name: FieldPath<T>,
  filter: InputFilterKind,
  options?: InputFilterOptions
) {
  return registerFilteredInput(register, name, filter, options);
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
    error?: string;
    options: { value: string; label: string }[];
    registration?: any;
    helper?: string;
    onAdd?: () => void;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ label, error, options, registration, helper, onAdd, className = '', ...props }, ref) => (
    <div className="space-y-1.5">
        <div className="flex justify-between items-center">
            <label className="hcms-field-label">{label}</label>
            {onAdd && (
                <button type="button" onClick={onAdd} className="text-xs text-primary-600 hover:text-primary-700 font-medium hover:underline transition-all">
                    + {useLanguage().t('common.add') || 'Add New'}
                </button>
            )}
        </div>
        <div className="relative">
            <select 
                ref={ref}
                className={`w-full min-w-0 max-w-full box-border px-3 sm:px-4 py-2 sm:py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 dark:focus:border-primary-500 dark:text-white text-base transition-all shadow-sm appearance-none ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : 'hover:border-slate-400 dark:hover:border-slate-500'} ${className}`}
                {...registration}
                {...props}
            >
                <option value="" disabled hidden>
                  {useLanguage().t('common.select') || 'Select...'}
                </option>
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </div>
        {helper && <p className="text-xs text-slate-500">{helper}</p>}
        {error && <p className="text-xs text-red-500 font-medium animate-in slide-in-from-left-1">{error}</p>}
    </div>
));

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label: string;
    error?: string;
    registration?: any;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, registration, className = '', ...props }, ref) => (
    <div className="space-y-1.5">
        <label className="hcms-field-label">{label}</label>
        <textarea 
            ref={ref}
            className={`w-full min-w-0 max-w-full box-border px-3 sm:px-4 py-2 sm:py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 dark:focus:border-primary-500 dark:text-white text-base transition-all shadow-sm placeholder:text-slate-400 ${error ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' : 'hover:border-slate-400 dark:hover:border-slate-500'} ${className}`}
            {...registration}
            {...props}
        />
        {error && <p className="text-xs text-red-500 font-medium animate-in slide-in-from-left-1">{error}</p>}
    </div>
));

export const InputField = Input;
export const SelectField = Select;
export const TextareaField = Textarea;
