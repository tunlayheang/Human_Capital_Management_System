import React, { useEffect, useState } from 'react';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';
import {
  displayValueToKhrStorage,
  displayValueToUsdStorage,
  khrStorageToDisplayValue,
  usdStorageToDisplayValue,
} from '../../utils/payrollRulesCurrency';
import { NumericField } from './NumericField';

type StorageCurrency = 'usd' | 'khr';

export type CurrencyAmountFieldProps = Omit<
  React.ComponentProps<typeof NumericField>,
  'kind' | 'value' | 'onValueChange' | 'filterOptions'
> & {
  /** Currency unit stored in form/state/API. */
  storage: StorageCurrency;
  /** Amount in `storage` units. */
  value: number;
  /** Preferred display/edit currency (KHR or USD). */
  currency: PreferredCurrency;
  exchangeRateKhrPerUsd: number;
  /** Called with the amount in `storage` units. */
  onValueChange: (storageValue: number) => void;
};

function toDisplay(
  storage: StorageCurrency,
  value: number,
  currency: PreferredCurrency,
  rate: number
): string | number {
  return storage === 'usd'
    ? usdStorageToDisplayValue(value, currency, rate)
    : khrStorageToDisplayValue(value, currency, rate);
}

function toStorage(
  storage: StorageCurrency,
  raw: string,
  currency: PreferredCurrency,
  rate: number,
  fallback: number
): number {
  return storage === 'usd'
    ? displayValueToUsdStorage(raw, currency, rate, fallback)
    : displayValueToKhrStorage(raw, currency, rate, fallback);
}

/**
 * Money input that stays editable when display currency ≠ storage currency.
 * Cross-rate conversion is applied on blur so intermediate keystrokes are not
 * rounded away (e.g. typing 4100 KHR while storage is USD).
 */
export const CurrencyAmountField: React.FC<CurrencyAmountFieldProps> = ({
  storage,
  value,
  currency,
  exchangeRateKhrPerUsd,
  onValueChange,
  onFocus,
  onBlur,
  ...rest
}) => {
  const rate = exchangeRateKhrPerUsd;
  const sameUnit =
    (storage === 'usd' && currency === 'USD') || (storage === 'khr' && currency === 'KHR');
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const display = toDisplay(storage, Number(value) || 0, currency, rate);

  useEffect(() => {
    if (!focused) setDraft(String(display));
  }, [display, focused]);

  const kind = currency === 'USD' ? 'decimal' : 'integer';

  return (
    <NumericField
      {...rest}
      kind={kind}
      filterOptions={kind === 'decimal' ? { maxDecimals: 2 } : undefined}
      value={focused ? draft : display}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(display));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        const next = toStorage(storage, draft, currency, rate, Number(value) || 0);
        onValueChange(next);
        setFocused(false);
        onBlur?.(e);
      }}
      onValueChange={(raw) => {
        setDraft(raw);
        if (sameUnit) {
          onValueChange(toStorage(storage, raw, currency, rate, Number(value) || 0));
        }
      }}
    />
  );
};

export default CurrencyAmountField;
