import React from 'react';
import {
  numericInputAttrs,
  onFilteredChange,
  type InputFilterOptions,
} from '../../utils/formInputFilters';

type NumericKind = 'integer' | 'decimal' | 'digits';

export type NumericFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value' | 'inputMode' | 'pattern'
> & {
  kind?: NumericKind;
  value: string | number;
  onValueChange: (value: string) => void;
  filterOptions?: InputFilterOptions;
};

/** Text input that only accepts numeric characters (blocks letters while typing). */
export const NumericField: React.FC<NumericFieldProps> = ({
  kind = 'decimal',
  value,
  onValueChange,
  filterOptions,
  ...rest
}) => (
  <input
    {...numericInputAttrs(kind)}
    value={value}
    onChange={onFilteredChange(kind, onValueChange, filterOptions)}
    {...rest}
  />
);
