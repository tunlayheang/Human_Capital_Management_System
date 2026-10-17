import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Api } from '../services/api';
import {
  PAYROLL_EXCHANGE_RATE_UPDATED_EVENT,
  notifyPayrollExchangeRateUpdated,
} from '../constants/payrollExchangeRate';
import {
  getActiveExchangeRateKhrPerUsd,
  getConfiguredExchangeRateKhrPerUsd,
  setPayrollExchangeRateCache,
} from '../utils/payrollExchangeRateCache';

export type PayrollExchangeRateContextValue = {
  configuredExchangeRateKhrPerUsd: number;
  activeExchangeRateKhrPerUsd: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

const PayrollExchangeRateContext = createContext<PayrollExchangeRateContextValue | null>(null);

export const PayrollExchangeRateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const fx = await Api.payroll.getExchangeRateDetails();
      const configured = fx.latestExchangeRateKhrPerUsd ?? fx.exchangeRateKhrPerUsd;
      const active = fx.exchangeRateKhrPerUsd;
      setPayrollExchangeRateCache({ configured, active });
      setTick((n) => n + 1);
    } catch {
      /* keep cached / fallback — public endpoint should not 401 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => {
      void refresh();
    };
    window.addEventListener(PAYROLL_EXCHANGE_RATE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PAYROLL_EXCHANGE_RATE_UPDATED_EVENT, onUpdated);
  }, [refresh]);

  const value = useMemo(
    (): PayrollExchangeRateContextValue => ({
      configuredExchangeRateKhrPerUsd: getConfiguredExchangeRateKhrPerUsd(),
      activeExchangeRateKhrPerUsd: getActiveExchangeRateKhrPerUsd(),
      loading,
      refresh,
    }),
    [loading, tick, refresh]
  );

  return (
    <PayrollExchangeRateContext.Provider value={value}>{children}</PayrollExchangeRateContext.Provider>
  );
};

export function usePayrollExchangeRate(): PayrollExchangeRateContextValue {
  const ctx = useContext(PayrollExchangeRateContext);
  if (!ctx) {
    return {
      configuredExchangeRateKhrPerUsd: getConfiguredExchangeRateKhrPerUsd(),
      activeExchangeRateKhrPerUsd: getActiveExchangeRateKhrPerUsd(),
      loading: false,
      refresh: async () => {
        notifyPayrollExchangeRateUpdated();
      },
    };
  }
  return ctx;
}

export { notifyPayrollExchangeRateUpdated };
