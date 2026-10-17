import React from 'react';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';

export function PayrollCurrencyToggle({
  value,
  onChange,
  className = '',
}: {
  value?: PreferredCurrency;
  onChange?: (currency: PreferredCurrency) => void;
  className?: string;
}) {
  const { currency: contextCurrency, setCurrency } = usePreferredCurrency();
  const current = value ?? contextCurrency;

  const select = (next: PreferredCurrency) => {
    setCurrency(next);
    onChange?.(next);
  };

  return (
    <div
      className={`inline-flex rounded-lg border border-slate-200 dark:border-slate-600 p-0.5 bg-slate-50 dark:bg-slate-900/60 ${className}`}
      role="group"
      aria-label="Preferred currency"
    >
      {(['KHR', 'USD'] as const).map((code) => {
        const active = current === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => select(code)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              active
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
