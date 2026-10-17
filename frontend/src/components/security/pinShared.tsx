import React, { useCallback, useEffect, useState } from 'react';

export type PinEntryPhase = 'enter' | 'confirm' | 'current';

export function usePinDigits(maxLength = 4) {
  const [digits, setDigits] = useState<string[]>([]);

  const push = useCallback(
    (d: string) => {
      setDigits((prev) => (prev.length >= maxLength ? prev : [...prev, d]));
    },
    [maxLength]
  );

  const pop = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setDigits([]);
  }, []);

  return {
    digits,
    value: digits.join(''),
    isComplete: digits.length === maxLength,
    push,
    pop,
    clear,
    setDigits,
  };
}

/** Physical keyboard / numpad input for PIN entry (0–9, Backspace, Delete). */
export function usePinKeyboard(options: {
  enabled?: boolean;
  maxLength?: number;
  digitsLength: number;
  loading?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}) {
  const { enabled = true, maxLength = 4, digitsLength, loading = false, onDigit, onBackspace } =
    options;

  useEffect(() => {
    if (!enabled || loading) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (digitsLength < maxLength) onDigit(e.key);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onBackspace();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, loading, maxLength, digitsLength, onDigit, onBackspace]);
}

export const PinDigitIndicators: React.FC<{
  count: number;
  filled: number;
  variant?: 'overlay' | 'modal';
}> = ({ count, filled, variant = 'overlay' }) => {
  if (variant === 'modal') {
    return (
      <div className="flex justify-center gap-2.5" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`block h-2.5 w-2.5 rounded-full border-2 transition-colors duration-150 ${
              filled > i
                ? 'border-primary-600 bg-primary-600 dark:border-primary-500 dark:bg-primary-500'
                : 'border-slate-300 bg-transparent dark:border-slate-600'
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="pin-digit-row flex justify-center gap-2.5 sm:gap-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="pin-dot-wrap inline-flex h-4 w-4 shrink-0 items-center justify-center sm:h-[0.95rem] sm:w-[0.95rem]"
        >
          <span
            className={`pin-dot block h-3 w-3 rounded-full border-2 transition-colors duration-150 sm:h-3.5 sm:w-3.5 ${
              filled > i ? 'pin-dot--filled' : 'pin-dot--empty'
            }`}
          />
        </span>
      ))}
    </div>
  );
};

/** Reserved height so error / attempt hints do not shift the keypad. */
export const PinStatusSlot: React.FC<{
  error?: string | null;
  attempts?: number | null;
  attemptsText?: string | null;
}> = ({ error, attempts, attemptsText }) => {
  const showAttempts =
    !error && attempts != null && attempts > 0 && Boolean(attemptsText);

  return (
    <div
      className="pin-status-slot mb-3 flex min-h-[2.5rem] flex-col items-center justify-center px-2"
      aria-live="polite"
    >
      {error ? (
        <p className="text-sm pin-lock-error" role="alert">
          {error}
        </p>
      ) : showAttempts ? (
        <p className="text-xs pin-lock-attempts">{attemptsText}</p>
      ) : null}
    </div>
  );
};

/** Reserved height so "Verifying…" does not appear/disappear and resize the card. */
export const PinLoadingSlot: React.FC<{ loading?: boolean; label?: string }> = ({
  loading,
  label,
}) => (
  <div className="pin-loading-slot mt-5 flex min-h-[1.25rem] items-start justify-center sm:mt-6">
    {loading ? <p className="text-xs pin-lock-hint">{label}</p> : null}
  </div>
);
