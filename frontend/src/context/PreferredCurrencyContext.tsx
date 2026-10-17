import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { Api } from '../services/api';
import {
  getPayrollDisplayCurrency,
  setPayrollDisplayCurrency,
  type PreferredCurrency,
} from '../utils/payrollCurrencyDisplay';

type PreferredCurrencyContextValue = {
  currency: PreferredCurrency;
  setCurrency: (next: PreferredCurrency) => void;
};

const PreferredCurrencyContext = createContext<PreferredCurrencyContextValue | undefined>(
  undefined
);

export function PreferredCurrencyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [currency, setCurrencyState] = useState<PreferredCurrency>(() => {
    const fromUser = user?.preferredCurrency;
    if (fromUser === 'KHR' || fromUser === 'USD') return fromUser;
    return getPayrollDisplayCurrency();
  });

  useEffect(() => {
    const fromUser = user?.preferredCurrency;
    if (fromUser === 'KHR' || fromUser === 'USD') {
      setCurrencyState(fromUser);
      setPayrollDisplayCurrency(fromUser);
    }
  }, [user?.preferredCurrency, user?.id]);

  const setCurrency = useCallback(
    (next: PreferredCurrency) => {
      setCurrencyState(next);
      setPayrollDisplayCurrency(next);
      if (!user?.id) return;
      void Api.auth.updatePreferences({ preferredCurrency: next }).catch(() => {
        /* keep local preference on network failure */
      });
    },
    [user?.id]
  );

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);

  return (
    <PreferredCurrencyContext.Provider value={value}>{children}</PreferredCurrencyContext.Provider>
  );
}

export function usePreferredCurrency(): PreferredCurrencyContextValue {
  const ctx = useContext(PreferredCurrencyContext);
  if (!ctx) {
    return {
      currency: getPayrollDisplayCurrency(),
      setCurrency: setPayrollDisplayCurrency,
    };
  }
  return ctx;
}
