import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Shield, UserRound } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PinKeypad } from './PinKeypad';
import { PinDigitIndicators, usePinDigits } from './pinShared';
import { Api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { parsePinApiError } from '../../utils/pinApi';

type Props = {
  isOpen: boolean;
  targetUserId: string;
  targetName: string;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
};

/** Admin must enter their own PIN to reset another user's security PIN. */
export const AdminPinResetModal: React.FC<Props> = ({
  isOpen,
  targetUserId,
  targetName,
  onClose,
  onSuccess,
}) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const digits = usePinDigits();
  const { clear, push, pop, isComplete, value, digits: pinDigits } = digits;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    clear();
    setError(null);
    setLoading(false);
  }, [clear]);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
      return;
    }
    focusRef.current?.focus();
  }, [isOpen, resetForm]);

  const submit = useCallback(
    async (pin: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await Api.auth.resetUserPin(targetUserId, pin);
        showToast(
          (res as { message?: string })?.message ||
            t('pin.adminResetSuccess') ||
            'User PIN reset. They must create a new PIN on next sign-in.',
          'success'
        );
        resetForm();
        await onSuccess();
        onClose();
      } catch (e: unknown) {
        const { message } = parsePinApiError(e);
        setError(message);
        clear();
      } finally {
        setLoading(false);
      }
    },
    [targetUserId, showToast, t, resetForm, onSuccess, onClose, clear]
  );

  useEffect(() => {
    if (!isOpen || !isComplete) return;
    void submit(value);
  }, [isOpen, isComplete, value, submit]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={t('pin.adminResetTitle') || 'Reset user PIN'}
      size="sm"
      description={
        t('pin.adminResetDescription') ||
        "Admin verification is required before resetting another user's PIN."
      }
      disableClose={loading}
      footer={
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          {t('pin.cancel') || 'Cancel'}
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-200/90 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {targetName}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {t('pin.adminResetSubtitle', { name: targetName }) ||
                  `Their security PIN will be cleared. They must create a new PIN on next sign-in.`}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-4 py-5">
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
              <Shield className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t('pin.adminResetVerify') || 'Enter your admin PIN'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
              {t('pin.adminResetVerifyHint') ||
                'Use the 4-digit PIN for your own account to authorize this reset.'}
            </p>

            <div className="mt-4 min-h-[1.25rem] w-full" aria-live="polite">
              {error ? (
                <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : loading ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <KeyRound className="h-3.5 w-3.5 animate-pulse" />
                  {t('pin.verifying') || 'Verifying…'}
                </p>
              ) : null}
            </div>

            <div className="my-4">
              <PinDigitIndicators count={4} filled={pinDigits.length} variant="modal" />
            </div>

            <div
              ref={focusRef}
              tabIndex={-1}
              className="sr-only outline-none"
              aria-label={t('pin.adminResetTitle') || 'Reset user PIN'}
            />

            <PinKeypad
              variant="modal"
              digits={pinDigits}
              loading={loading}
              keyboardEnabled={!loading}
              onDigit={(d) => {
                setError(null);
                push(d);
              }}
              onBackspace={() => {
                setError(null);
                pop();
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
