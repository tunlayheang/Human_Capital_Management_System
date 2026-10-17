import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

type Props = {
  onLogout: () => void;
};

/** Shown when a non-admin account is locked out and must wait for Admin PIN reset. */
export const PinAdminResetRequired: React.FC<Props> = ({ onLogout }) => {
  const { t } = useLanguage();

  return (
    <div className="w-full max-w-[min(100%,22rem)] sm:max-w-sm mx-auto text-center space-y-3 sm:space-y-4 px-1 pb-1">
      <div className="pin-lock-icon mx-auto w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg">
        <ShieldAlert className="w-7 h-7 text-white" />
      </div>
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
          {t('pin.adminResetRequiredTitle') || 'PIN locked'}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {t('pin.adminResetRequiredBody') ||
            'You entered an incorrect PIN too many times. Ask an administrator to reset your security PIN, then sign in again to create a new one.'}
        </p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('pin.adminResetRequiredHint') ||
          'Administrators can reset your PIN from User Management.'}
      </p>
      <button
        type="button"
        onClick={onLogout}
        className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 transition"
      >
        {t('pin.logoutKey') || 'Sign out'}
      </button>
    </div>
  );
};
