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
  COMPANY_TZ_CHANGED_EVENT,
  DEFAULT_COMPANY_TIMEZONE,
  getCompanyTimezone,
  setCompanyTimezone,
  todayYmdInCompanyTz,
} from '../utils/companyCalendar';
import { setCompanyLocaleFromSettings } from '../utils/companyLocaleSettings';

type CompanyCalendarContextValue = {
  timeZone: string;
  /** YYYY-MM-DD for today in company timezone (updates periodically). */
  todayYmd: string;
  refresh: () => Promise<void>;
};

const CompanyCalendarContext = createContext<CompanyCalendarContextValue | undefined>(undefined);

export function CompanyCalendarProvider({ children }: { children: React.ReactNode }) {
  const [timeZone, setTimeZone] = useState(() => getCompanyTimezone());
  const [todayYmd, setTodayYmd] = useState(() => todayYmdInCompanyTz());

  const refresh = useCallback(async () => {
    try {
      const res = await Api.system.getCompanySettings();
      setCompanyLocaleFromSettings((res?.settings ?? {}) as Record<string, unknown>);
      const next = setCompanyTimezone(res?.settings?.['company.timezone']);
      setTimeZone(next);
      setTodayYmd(todayYmdInCompanyTz(new Date(), next));
    } catch {
      const fallback = setCompanyTimezone(DEFAULT_COMPANY_TIMEZONE);
      setTimeZone(fallback);
      setTodayYmd(todayYmdInCompanyTz(new Date(), fallback));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onTzChanged = () => {
      const tz = getCompanyTimezone();
      setTimeZone(tz);
      setTodayYmd(todayYmdInCompanyTz(new Date(), tz));
    };
    window.addEventListener(COMPANY_TZ_CHANGED_EVENT, onTzChanged);
    return () => window.removeEventListener(COMPANY_TZ_CHANGED_EVENT, onTzChanged);
  }, []);

  // Keep "today" current across midnight without a full reload.
  useEffect(() => {
    const tick = () => setTodayYmd(todayYmdInCompanyTz(new Date(), timeZone));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [timeZone]);

  const value = useMemo(
    () => ({ timeZone, todayYmd, refresh }),
    [timeZone, todayYmd, refresh]
  );

  return (
    <CompanyCalendarContext.Provider value={value}>{children}</CompanyCalendarContext.Provider>
  );
}

export function useCompanyCalendar(): CompanyCalendarContextValue {
  const ctx = useContext(CompanyCalendarContext);
  if (!ctx) {
    const tz = getCompanyTimezone();
    return {
      timeZone: tz,
      todayYmd: todayYmdInCompanyTz(new Date(), tz),
      refresh: async () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}
