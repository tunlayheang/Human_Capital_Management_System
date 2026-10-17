import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Shield } from 'lucide-react';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';

export type LogoutConfirmContext = 'app' | 'pin';

type Props = {
  open: boolean;
  context: LogoutConfirmContext;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export const LogoutConfirmDialog: React.FC<Props> = ({
  open,
  context,
  loading = false,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();
  const fromPin = context === 'pin';

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const title = fromPin
    ? t('pin.logoutConfirmTitle') || 'Leave and sign out?'
    : t('nav.logoutConfirmTitle') || 'Sign out?';

  const description = fromPin
    ? t('pin.logoutConfirmDescription') ||
      'You will leave this device and must sign in again. Your PIN stays on this account until you sign back in.'
    : t('nav.logoutConfirmDescription') || 'You will need to sign in again to access HCMS.';

  const confirmLabel = fromPin
    ? t('pin.logoutConfirmAction') || 'Sign out completely'
    : t('nav.logoutConfirmAction') || t('nav.logout') || 'Sign out';

  const cancelLabel = fromPin
    ? t('pin.logoutConfirmCancel') || 'Stay on PIN screen'
    : t('nav.logoutConfirmCancel') || 'Stay signed in';

  return createPortal(
    <div
      className="fixed inset-0 z-[350] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-[3px]"
        aria-label="Close dialog"
        disabled={loading}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[min(100%,22rem)] sm:max-w-md overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/25 dark:border-slate-600 dark:bg-slate-800 animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`h-1.5 w-full ${
            fromPin
              ? 'bg-gradient-to-r from-primary-600 via-primary-500 to-cyan-500'
              : 'bg-gradient-to-r from-red-600 via-rose-500 to-orange-400'
          }`}
        />

        <div className="px-6 pt-7 pb-2 text-center">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-inner ${
              fromPin
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-950/60 dark:text-primary-300'
                : 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'
            }`}
          >
            {fromPin ? <Shield className="h-7 w-7" /> : <LogOut className="h-7 w-7" />}
          </div>
          <h2
            id="logout-confirm-title"
            className="text-lg font-bold text-slate-900 dark:text-white leading-snug"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        </div>

        <div className="flex flex-col gap-2 px-6 pb-6 pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center border-slate-200 dark:border-slate-600 font-semibold"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={`w-full justify-center font-semibold ${
              fromPin
                ? 'bg-slate-800 hover:bg-slate-900 text-white border-transparent dark:bg-slate-700 dark:hover:bg-slate-600'
                : 'bg-red-600 hover:bg-red-700 text-white border-transparent'
            }`}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? t('pin.verifying') || 'Please wait…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
