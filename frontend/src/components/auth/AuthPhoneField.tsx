import React from 'react';
import { authInputClass } from '../auth/authStyles';
import { filterInputChange } from '../../utils/formInputFilters';

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  'aria-invalid'?: boolean;
};

export const AuthPhoneField: React.FC<Props> = ({
  id,
  value,
  onChange,
  placeholder = '0123456789',
  autoComplete = 'tel',
  required,
  'aria-invalid': ariaInvalid,
}) => (
  <input
    id={id}
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    value={value}
    onChange={(e) => onChange(filterInputChange('phone', e.target.value, { maxLength: 12 }))}
    className={authInputClass}
    placeholder={placeholder}
    autoComplete={autoComplete}
    required={required}
    aria-invalid={ariaInvalid}
  />
);
