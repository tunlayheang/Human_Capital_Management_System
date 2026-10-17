import React from 'react';
import { Delete, LogOut } from 'lucide-react';
import { usePinKeyboard } from './pinShared';

type PinKeypadVariant = 'overlay' | 'modal';

type Props = {
  digits: string[];
  loading?: boolean;
  keyboardEnabled?: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onLogout?: () => void;
  logoutAriaLabel?: string;
  /** overlay = full-screen lock; modal = compact dialog keypad */
  variant?: PinKeypadVariant;
};

export const PinKeypad: React.FC<Props> = ({
  digits,
  loading = false,
  keyboardEnabled = true,
  onDigit,
  onBackspace,
  onLogout,
  logoutAriaLabel = 'Sign out',
  variant = 'overlay',
}) => {
  usePinKeyboard({
    enabled: keyboardEnabled,
    digitsLength: digits.length,
    loading,
    onDigit,
    onBackspace,
  });

  const isModal = variant === 'modal';
  const gridClass = isModal
    ? 'grid grid-cols-3 gap-2 w-full max-w-[13.5rem] mx-auto touch-manipulation'
    : 'pin-keypad-grid grid grid-cols-3 gap-1.5 sm:gap-3 w-full max-w-[min(100%,17.5rem)] sm:max-w-[280px] mx-auto touch-manipulation';
  const keyClass = isModal
    ? 'h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/40 active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm'
    : 'pin-key min-h-[2.75rem] h-11 sm:h-14 rounded-xl sm:rounded-2xl text-base sm:text-lg md:text-xl font-semibold active:scale-95 transition-all disabled:opacity-50';
  const mutedKeyClass = isModal
    ? `${keyClass} text-slate-500 dark:text-slate-400`
    : 'pin-key pin-key--muted min-h-[2.75rem] h-11 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center';
  const spacerClass = isModal ? 'h-10' : 'min-h-[2.75rem] h-11 sm:h-14';

  return (
    <div className={gridClass}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
        <button
          key={n}
          type="button"
          disabled={loading}
          onClick={() => onDigit(n)}
          className={keyClass}
        >
          {n}
        </button>
      ))}
      {onLogout ? (
        <button
          type="button"
          onClick={onLogout}
          className={`${mutedKeyClass} flex items-center justify-center`}
          aria-label={logoutAriaLabel}
          title={logoutAriaLabel}
        >
          <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      ) : (
        <span className={spacerClass} aria-hidden />
      )}
      <button
        type="button"
        disabled={loading}
        onClick={() => onDigit('0')}
        className={keyClass}
      >
        0
      </button>
      <button
        type="button"
        disabled={loading || digits.length === 0}
        onClick={onBackspace}
        className={`${mutedKeyClass} flex items-center justify-center disabled:opacity-40`}
        aria-label="Delete"
      >
        <Delete className="w-4 h-4" />
      </button>
    </div>
  );
};
