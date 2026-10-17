import React from 'react';
import { authInputClass } from './authStyles';
import { filterInputChange } from '../../utils/formInputFilters';
import { normalizeEmployeeDisplayId } from '../../utils';

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  'aria-invalid'?: boolean;
};

/**
 * Clean login EmpID while typing — uppercase / alphanumerics and IROC|EMP → ROC.
 * Does NOT zero-pad digits (that would fight backspace). Padding runs on blur / submit.
 */
function sanitizeLoginEmpIdWhileTyping(raw: string): string {
  const filtered = filterInputChange('alphanumeric', raw, {
    maxLength: 32,
    uppercase: true,
  });
  if (/^IROC$/i.test(filtered) || /^EMP$/i.test(filtered)) return 'ROC';
  const legacy = filtered.match(/^(?:IROC|EMP)(\d*)$/i);
  if (legacy) return `ROC${legacy[1]}`;
  return filtered;
}

export const AuthEmployeeIdField: React.FC<Props> = ({
  id,
  value,
  onChange,
  placeholder = 'ROC00001',
  autoComplete = 'username',
  required,
  'aria-invalid': ariaInvalid,
}) => (
  <input
    id={id}
    name="username"
    type="text"
    inputMode="text"
    spellCheck={false}
    value={value}
    onChange={(e) => onChange(sanitizeLoginEmpIdWhileTyping(e.target.value))}
    onBlur={(e) => {
      const next = normalizeEmployeeDisplayId(e.target.value);
      if (next !== value) onChange(next);
    }}
    className={authInputClass}
    placeholder={placeholder}
    autoComplete={autoComplete}
    required={required}
    aria-invalid={ariaInvalid}
  />
);
