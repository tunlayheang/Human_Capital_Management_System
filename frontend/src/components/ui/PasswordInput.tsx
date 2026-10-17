import React, { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { inputClass } from '../../constants/designSystem';

export type PasswordInputPurpose = 'login' | 'current' | 'new' | 'confirm';

const PURPOSE_AUTOCOMPLETE: Record<PasswordInputPurpose, string> = {
  login: 'current-password',
  current: 'current-password',
  new: 'new-password',
  confirm: 'off',
};

const PURPOSE_NAME: Record<PasswordInputPurpose, string> = {
  login: 'hcms-portal-login-password',
  current: 'hcms-portal-current-password',
  new: 'hcms-portal-new-password',
  confirm: 'hcms-portal-confirm-password',
};

/** Absorbs browser autofill on password-change forms (place once at top of form). */
export function PasswordFormAutofillTrap() {
  return (
    <div
      className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      aria-hidden
    >
      <input type="text" name="hcms_autofill_trap_user" autoComplete="username" tabIndex={-1} readOnly />
      <input type="password" name="hcms_autofill_trap_pass" autoComplete="current-password" tabIndex={-1} readOnly />
    </div>
  );
}

export type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'autoComplete' | 'name'
> & {
  purpose: PasswordInputPurpose;
  label?: string;
  labelClassName?: string;
  error?: string;
  showToggle?: boolean;
  inputClassName?: string;
  /** Link a hidden username for change-password forms (improves browser behavior). */
  usernameHint?: string;
};

/**
 * Password field that avoids Chrome / password-manager overlays blocking manual entry.
 * Uses correct autocomplete tokens, non-generic names, and readonly-until-focus for new passwords.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      purpose,
      label,
      labelClassName,
      error,
      showToggle = false,
      inputClassName,
      className,
      id: idProp,
      usernameHint,
      onFocus,
      readOnly,
      value,
      ...props
    },
    ref
  ) => {
    const autoId = useId();
    const id = idProp ?? autoId;
    const innerRef = useRef<HTMLInputElement | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [editable, setEditable] = useState(purpose === 'login' || purpose === 'current');

    const blockManagerPopup = purpose === 'new' || purpose === 'confirm';
    const isReadOnly = readOnly ?? (blockManagerPopup && !editable);

    useEffect(() => {
      if (blockManagerPopup && !value) {
        setEditable(false);
      }
    }, [blockManagerPopup, value]);

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      if (blockManagerPopup && !editable) {
        setEditable(true);
        e.currentTarget.removeAttribute('readonly');
      }
      onFocus?.(e);
    };

    const field = (
      <div className={showToggle ? 'relative' : undefined}>
        {usernameHint ? (
          <input
            type="text"
            name="hcms-portal-username-hint"
            autoComplete="username"
            value={usernameHint}
            readOnly
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
          />
        ) : null}
        <input
          {...props}
          value={value}
          ref={setRefs}
          id={id}
          type={showToggle && revealed ? 'text' : 'password'}
          name={PURPOSE_NAME[purpose]}
          autoComplete={PURPOSE_AUTOCOMPLETE[purpose]}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore
          data-bwignore
          data-form-type={purpose === 'login' ? 'login' : 'other'}
          readOnly={isReadOnly}
          onFocus={handleFocus}
          className={`${inputClassName ?? inputClass} ${showToggle ? 'pr-10' : ''} ${className ?? ''}`}
          aria-invalid={error ? true : props['aria-invalid']}
        />
        {showToggle && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRevealed((v) => !v);
            }}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    );

    if (!label) {
      return (
        <div className="space-y-1">
          {field}
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <label
          htmlFor={id}
          className={
            labelClassName ??
            'block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
          }
        >
          {label}
        </label>
        {field}
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';
