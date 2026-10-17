import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePersonDisplayName } from '../../hooks/usePersonDisplayName';
import { Role } from '../../types';
import { resolveDateFnsDateFormatPattern } from '../../utils/companyLocaleSettings';

function welcomeSubtitle(
  hasRole: (role: Role) => boolean,
  t: (key: string) => string
): string {
  if (hasRole(Role.ADMIN)) {
    return t('dashboard.adminOverview') || 'Your organization at a glance.';
  }
  if (hasRole(Role.HR)) {
    return t('dashboard.hrOverview') || 'HR overview for your workforce.';
  }
  if (hasRole(Role.MANAGER)) {
    return t('dashboard.teamOverview') || 'Your team at a glance.';
  }
  return (
    t('dashboard.welcomeSubtitle') ||
    "Here's what's happening with your work today."
  );
}

/** High-contrast welcome strip shown at the top of every role dashboard. */
export function DashboardWelcomeBanner() {
  const { t } = useLanguage();
  const { hasRole } = useAuth();
  const displayName = usePersonDisplayName();
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-700 px-4 py-3.5 sm:px-5 sm:py-4 text-white shadow-lg shadow-indigo-900/25"
      role="banner"
      aria-label={t('dashboard.welcomeBack') || 'Welcome back'}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-violet-400/20 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base sm:text-xl font-bold font-khmer text-white drop-shadow-sm">
            {t('dashboard.welcomeBack') || 'Welcome back'}, {displayName}!
          </h2>
          <p className="mt-0.5 text-sm text-blue-50/95 sm:text-[15px]">
            {welcomeSubtitle(hasRole, t)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg sm:text-2xl font-bold tabular-nums text-white drop-shadow-sm">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-[11px] sm:text-xs font-medium text-blue-50/90">
            {format(currentTime, `EEE, ${resolveDateFnsDateFormatPattern()}`)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardWelcomeBanner;
