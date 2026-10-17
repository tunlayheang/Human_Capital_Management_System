import type { ChangeEvent, ClipboardEvent, HTMLAttributes } from 'react';
import type { FieldPath, FieldValues, UseFormRegister } from 'react-hook-form';

/** Filter kinds for text inputs across the portal. */
export type InputFilterKind =
  | 'none'
  | 'digits'
  | 'integer'
  | 'decimal'
  | 'letters'
  | 'name'
  | 'city'
  | 'alphanumeric'
  | 'passport'
  | 'phone'
  | 'otp';

export type InputFilterOptions = {
  maxLength?: number;
  maxDecimals?: number;
  /** Uppercase output (passport, codes). */
  uppercase?: boolean;
};

const KHMER_LETTER = '\u1780-\u17FF';
const LATIN_LETTER = 'A-Za-z\u00C0-\u024F\u1E00-\u1EFF';

export function digitsOnly(value: string, maxLength?: number): string {
  let d = String(value ?? '').replace(/\D/g, '');
  if (maxLength != null && maxLength > 0) d = d.slice(0, maxLength);
  return d;
}

/** Letters and spaces only (names — Latin + Khmer). */
export function lettersOnly(value: string, maxLength?: number): string {
  const re = new RegExp(`[^${LATIN_LETTER}${KHMER_LETTER}\\s]`, 'gu');
  let v = String(value ?? '').replace(re, '');
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

/** Person / place names: letters, spaces, hyphen, apostrophe, period. */
export function nameLettersOnly(value: string, maxLength?: number): string {
  const re = new RegExp(`[^${LATIN_LETTER}${KHMER_LETTER}\\s\\-'.]`, 'gu');
  let v = String(value ?? '').replace(re, '');
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

export function cityLettersOnly(value: string, maxLength?: number): string {
  const re = new RegExp(`[^${LATIN_LETTER}${KHMER_LETTER}\\s\\-,]`, 'gu');
  let v = String(value ?? '').replace(re, '');
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

export function alphanumericOnly(value: string, maxLength?: number): string {
  let v = String(value ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

export function passportIdOnly(value: string, maxLength = 15): string {
  return alphanumericOnly(value, maxLength).toUpperCase();
}

export function integerStringOnly(value: string, maxLength?: number): string {
  let v = String(value ?? '').replace(/\D/g, '');
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

export function decimalStringOnly(value: string, maxDecimals = 2, maxLength?: number): string {
  let v = String(value ?? '').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  }
  if (dot !== -1 && maxDecimals >= 0) {
    const [intPart, frac = ''] = v.split('.');
    v = frac.length ? `${intPart}.${frac.slice(0, maxDecimals)}` : `${intPart}.`;
  }
  if (maxLength != null && maxLength > 0) v = v.slice(0, maxLength);
  return v;
}

/**
 * Controlled numeric inputs: keep '' while the user clears the field so they can
 * retype freely. Coerce with {@link coerceFiniteNumber} on submit / blur.
 */
export type NumberInputValue = number | '';

export function numberInputFromRaw(raw: string): NumberInputValue {
  if (raw.trim() === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : '';
}

export function coerceFiniteNumber(value: NumberInputValue | null | undefined, fallback = 0): number {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function applyInputFilter(
  kind: InputFilterKind,
  value: string,
  options: InputFilterOptions = {}
): string {
  const maxLength = options.maxLength;
  let out: string;
  switch (kind) {
    case 'digits':
    case 'phone':
    case 'otp':
      out = digitsOnly(value, maxLength);
      break;
    case 'integer':
      out = integerStringOnly(value, maxLength);
      break;
    case 'decimal':
      out = decimalStringOnly(value, options.maxDecimals ?? 2, maxLength);
      break;
    case 'letters':
      out = lettersOnly(value, maxLength);
      break;
    case 'name':
      out = nameLettersOnly(value, maxLength);
      break;
    case 'city':
      out = cityLettersOnly(value, maxLength);
      break;
    case 'alphanumeric':
      out = alphanumericOnly(value, maxLength);
      break;
    case 'passport':
      out = passportIdOnly(value, maxLength ?? 15);
      break;
    case 'none':
    default:
      out = String(value ?? '');
  }
  if (options.uppercase) out = out.toUpperCase();
  return out;
}

export function inputModeForFilter(kind: InputFilterKind): HTMLAttributes<HTMLInputElement>['inputMode'] {
  switch (kind) {
    case 'digits':
    case 'phone':
    case 'otp':
    case 'integer':
      return 'numeric';
    case 'decimal':
      return 'decimal';
    default:
      return 'text';
  }
}

export function patternForFilter(kind: InputFilterKind): string | undefined {
  switch (kind) {
    case 'digits':
    case 'phone':
    case 'otp':
    case 'integer':
      return '[0-9]*';
    case 'decimal':
      return '[0-9.]*';
    default:
      return undefined;
  }
}

/** Controlled inputs (login phone, OTP, etc.). */
export function filterInputChange(
  kind: InputFilterKind,
  value: string,
  options?: InputFilterOptions
): string {
  return applyInputFilter(kind, value, options);
}

function setValueAsForFilter(
  kind: InputFilterKind,
  options: InputFilterOptions
): ((v: unknown) => unknown) | undefined {
  if (kind === 'integer') {
    return (v) => {
      const s = integerStringOnly(String(v ?? ''), options.maxLength);
      if (!s) return '';
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : '';
    };
  }
  if (kind === 'decimal') {
    return (v) => {
      const s = decimalStringOnly(String(v ?? ''), options.maxDecimals ?? 2, options.maxLength);
      if (!s || s === '.') return '';
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : s;
    };
  }
  return (v) => applyInputFilter(kind, String(v ?? ''), options);
}

/** react-hook-form register with live keystroke filtering. */
export function registerFilteredInput<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(
  register: UseFormRegister<TFieldValues>,
  name: TFieldName,
  kind: InputFilterKind,
  options: InputFilterOptions = {}
) {
  if (kind === 'none') return register(name);

  const setValueAs = setValueAsForFilter(kind, options);
  const { onChange, ...field } = register(name, setValueAs ? { setValueAs } : undefined);

  const inputMode = inputModeForFilter(kind);
  const pattern = patternForFilter(kind);
  const useTextType = kind === 'integer' || kind === 'decimal' || kind === 'digits' || kind === 'phone' || kind === 'otp';

  return {
    ...field,
    type: useTextType ? ('text' as const) : undefined,
    inputMode,
    ...(pattern ? { pattern } : {}),
    autoComplete: 'off' as const,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const cleaned = applyInputFilter(kind, e.target.value, options);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      return onChange(e);
    },
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData('text');
      const cleaned = applyInputFilter(kind, pasted, options);
      if (pasted !== cleaned) {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = applyInputFilter(
          kind,
          el.value.slice(0, start) + cleaned + el.value.slice(end),
          options
        );
        el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
  };
}

/** @deprecated Use registerFilteredInput(register, name, 'digits', opts) */
export function registerDigitsOnly<
  TFieldValues extends FieldValues = FieldValues,
  TFieldName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(register: UseFormRegister<TFieldValues>, name: TFieldName, options?: { maxLength?: number }) {
  return registerFilteredInput(register, name, 'digits', options);
}

/** Static attrs for numeric text inputs (use with filtered onChange). */
export type NumericInputAttrProps = {
  type: 'text';
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  pattern?: string;
};

export function numericInputAttrs(kind: 'integer' | 'decimal' | 'digits'): NumericInputAttrProps {
  const pattern = patternForFilter(kind);
  return {
    type: 'text',
    inputMode: inputModeForFilter(kind),
    ...(pattern ? { pattern } : {}),
  };
}

/** Controlled input onChange that applies filter before calling handler. */
export function onFilteredChange(
  kind: InputFilterKind,
  handler: (value: string) => void,
  options?: InputFilterOptions
) {
  return (e: ChangeEvent<HTMLInputElement>) => {
    handler(applyInputFilter(kind, e.target.value, options));
  };
}

/** Full props bundle for controlled filtered inputs. */
export type FilteredInputProps = {
  type?: 'text';
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  pattern?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
};

export function filteredInputProps(
  kind: InputFilterKind,
  value: string,
  onValueChange: (value: string) => void,
  options?: InputFilterOptions
): FilteredInputProps {
  const useTextType =
    kind === 'integer' ||
    kind === 'decimal' ||
    kind === 'digits' ||
    kind === 'phone' ||
    kind === 'otp';
  const pattern = patternForFilter(kind);
  return {
    ...(useTextType ? { type: 'text' as const } : {}),
    ...(kind !== 'none' ? { inputMode: inputModeForFilter(kind) } : {}),
    ...(pattern ? { pattern } : {}),
    value,
    onChange: onFilteredChange(kind, onValueChange, options),
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData('text');
      const cleaned = applyInputFilter(kind, pasted, options);
      if (pasted !== cleaned) {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = applyInputFilter(
          kind,
          el.value.slice(0, start) + cleaned + el.value.slice(end),
          options
        );
        onValueChange(next);
      }
    },
  };
}

export const PHONE_FORMAT_HINT = 'e.g. 012 345 678';
export const NATIONAL_ID_FORMAT_HINT = 'e.g. 098529828';
export const PASSPORT_NUMBER_FORMAT_HINT = 'e.g. 123456789';
export const BANK_ACCOUNT_FORMAT_HINT = 'e.g. 001234567890';
