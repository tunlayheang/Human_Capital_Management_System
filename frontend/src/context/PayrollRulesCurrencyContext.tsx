import React, { createContext, useContext, useMemo } from 'react';
import { usePreferredCurrency } from './PreferredCurrencyContext';
import { usePayrollExchangeRate } from './PayrollExchangeRateContext';
import type { PreferredCurrency } from '../utils/payrollCurrencyDisplay';
import { resolveExchangeRateKhrPerUsd } from '../utils/payrollExchangeRateCache';

export type PayrollRulesCurrencyContextValue = {
  currency: PreferredCurrency;
  exchangeRateKhrPerUsd: number;
};

const PayrollRulesCurrencyContext = createContext<PayrollRulesCurrencyContextValue | null>(null);

export const PayrollRulesCurrencyProvider: React.FC<{
  exchangeRateKhrPerUsd?: number;
  children: React.ReactNode;
}> = ({ exchangeRateKhrPerUsd, children }) => {
  const { currency } = usePreferredCurrency();
  const value = useMemo(
    () => ({
      currency,
      exchangeRateKhrPerUsd: resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured'),
    }),
    [currency, exchangeRateKhrPerUsd]
  );
  return (
    <PayrollRulesCurrencyContext.Provider value={value}>
      {children}
    </PayrollRulesCurrencyContext.Provider>
  );
};

export function usePayrollRulesCurrency(): PayrollRulesCurrencyContextValue {
  const ctx = useContext(PayrollRulesCurrencyContext);
  const { currency } = usePreferredCurrency();
  const { configuredExchangeRateKhrPerUsd } = usePayrollExchangeRate();
  if (!ctx) {
    return {
      currency,
      exchangeRateKhrPerUsd: configuredExchangeRateKhrPerUsd,
    };
  }
  return ctx;
}
