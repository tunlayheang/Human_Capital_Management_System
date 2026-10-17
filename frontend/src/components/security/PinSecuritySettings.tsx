import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Clock } from 'lucide-react';
import { Api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { isPinMandatoryRole } from '../../utils/pinSecurity';
import { parsePinApiError, stashPinLockoutMessage } from '../../utils/pinApi';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { SectionEditToolbar } from '../ui/SectionEditToolbar';
import { PinKeypad } from './PinKeypad';
import { PinDigitIndicators, PinStatusSlot, usePinDigits } from './pinShared';

type ChangePhase = 'idle' | 'current' | 'enter' | 'confirm';

interface PinSecuritySettingsProps {
  onPinEnabled?: () => void;
}

export const PinSecuritySettings: React.FC<PinSecuritySettingsProps> = ({ onPinEnabled }) => {
  const { user, refreshUser, logout } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [pinSet, setPinSet] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [savedAutoLockMinutes, setSavedAutoLockMinutes] = useState(15);
  const [isEditingAutoLock, setIsEditingAutoLock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifyingCurrent, setVerifyingCurrent] = useState(false);
  const [pinMustReset, setPinMustReset] = useState(false);
  const [changePhase, setChangePhase] = useState<ChangePhase>('idle');
  const [pendingNewPin, setPendingNewPin] = useState('');
  const [currentPinValue, setCurrentPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const currentDigits = usePinDigits();
  const enterDigits = usePinDigits();
  const confirmDigits = usePinDigits();
  const { clear: clearCurrentDigits } = currentDigits;
  const { clear: clearEnterDigits } = enterDigits;
  const { clear: clearConfirmDigits } = confirmDigits;

  const autoLockDirty =
    isEditingAutoLock && autoLockMinutes !== savedAutoLockMinutes;
  const { confirmDiscardIfDirty, ConfirmDialogHost } = useUnsavedChangesGuard({
    isDirty: autoLockDirty,
  });

  const applyAutoLockValue = useCallback((minutes: number) => {
    const next = Number.isFinite(minutes) && minutes >= 1 ? Math.min(60, Math.floor(minutes)) : 15;
    setAutoLockMinutes(next);
    setSavedAutoLockMinutes(next);
  }, []);

  const loadSecurity = async () => {
    setLoading(true);
    try {
      const s = await Api.auth.getSecurity();
      setPinSet(!!s.pinSet);
      setPinMustReset(!!s.pinMustReset);
      applyAutoLockValue(s.pinAutoLockMinutes ?? 15);
      setIsEditingAutoLock(false);
    } catch {
      showToast('Could not load security settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && isPinMandatoryRole(user.role)) void loadSecurity();
    else setLoading(false);
  }, [user?.id, user?.role]);

  const resetPinFlow = useCallback(() => {
    setChangePhase(pinSet ? 'idle' : 'enter');
    setPendingNewPin('');
    setCurrentPinValue('');
    setPinError(null);
    setRemainingAttempts(null);
    setVerifyingCurrent(false);
    clearCurrentDigits();
    clearEnterDigits();
    clearConfirmDigits();
  }, [pinSet, clearCurrentDigits, clearEnterDigits, clearConfirmDigits]);

  useEffect(() => {
    if (!loading) resetPinFlow();
  }, [loading, pinSet]);

  const exitAutoLockEdit = useCallback(() => {
    setAutoLockMinutes(savedAutoLockMinutes);
    setIsEditingAutoLock(false);
  }, [savedAutoLockMinutes]);

  const handleCancelAutoLock = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    exitAutoLockEdit();
  };

  const handleSaveAutoLock = async () => {
    if (!autoLockDirty) {
      setIsEditingAutoLock(false);
      return;
    }
    setSaving(true);
    try {
      const s = await Api.auth.updatePinSettings({
        autoLockMinutes,
        pinLockEnabled: true,
      });
      applyAutoLockValue(s.pinAutoLockMinutes ?? autoLockMinutes);
      setIsEditingAutoLock(false);
      showToast(t('pin.autoLockSaved') || 'Auto-lock time updated', 'success');
      await refreshUser();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const finishSetPin = useCallback(
    async (newPin: string, currentPin?: string) => {
      setSaving(true);
      setPinError(null);
      try {
        await Api.auth.setPin(newPin, currentPin, autoLockMinutes);
        setPinSet(true);
        setPinMustReset(false);
        applyAutoLockValue(autoLockMinutes);
        setIsEditingAutoLock(false);
        showToast(
          pinSet ? t('pin.updated') || 'PIN updated' : t('pin.created') || 'PIN created',
          'success'
        );
        await refreshUser();
        onPinEnabled?.();
        resetPinFlow();
      } catch (err: unknown) {
        const { message, meta } = parsePinApiError(err);
        // Current PIN was already verified; if set still fails on current PIN, restart.
        if (message.toLowerCase().includes('current pin')) {
          setPinError(message);
          setChangePhase('current');
          setPendingNewPin('');
          setCurrentPinValue('');
          clearCurrentDigits();
          clearEnterDigits();
          clearConfirmDigits();
        } else {
          setPinError(message || 'Failed to set PIN');
          if (meta.forceLogout) {
            stashPinLockoutMessage(message);
            await logout({ skipConfirm: true });
            return;
          }
          resetPinFlow();
        }
      } finally {
        setSaving(false);
      }
    },
    [
      autoLockMinutes,
      pinSet,
      refreshUser,
      onPinEnabled,
      resetPinFlow,
      showToast,
      t,
      clearCurrentDigits,
      clearEnterDigits,
      clearConfirmDigits,
      logout,
      applyAutoLockValue,
    ]
  );

  const onDigitComplete = useCallback(
    async (value: string) => {
      if (saving || verifyingCurrent) return;
      if (changePhase === 'current') {
        // Must verify current PIN with the server before allowing a new PIN.
        setVerifyingCurrent(true);
        setPinError(null);
        try {
          await Api.auth.verifyPin(value);
          setCurrentPinValue(value);
          setRemainingAttempts(null);
          setChangePhase('enter');
          clearEnterDigits();
        } catch (err: unknown) {
          const { message, meta } = parsePinApiError(err);
          if (meta.forceLogout) {
            stashPinLockoutMessage(message);
            await logout({ skipConfirm: true });
            return;
          }
          setPinError(
            message || t('pin.currentIncorrect') || 'Current PIN is incorrect. Try again.'
          );
          if (typeof meta.remainingAttempts === 'number') {
            setRemainingAttempts(meta.remainingAttempts);
          }
          setCurrentPinValue('');
          clearCurrentDigits();
        } finally {
          setVerifyingCurrent(false);
        }
        return;
      }
      if (changePhase === 'enter') {
        setPendingNewPin(value);
        setChangePhase('confirm');
        clearConfirmDigits();
        return;
      }
      if (changePhase === 'confirm') {
        if (value !== pendingNewPin) {
          setPinError(t('pin.mismatch') || 'PINs do not match. Try again.');
          setChangePhase('enter');
          setPendingNewPin('');
          clearEnterDigits();
          clearConfirmDigits();
          return;
        }
        if (pinSet && !currentPinValue) {
          setPinError(
            t('pin.currentRequired') || 'Enter your current PIN before setting a new one.'
          );
          setChangePhase('current');
          clearCurrentDigits();
          clearEnterDigits();
          clearConfirmDigits();
          return;
        }
        await finishSetPin(value, pinSet ? currentPinValue : undefined);
      }
    },
    [
      changePhase,
      pendingNewPin,
      pinSet,
      currentPinValue,
      finishSetPin,
      clearCurrentDigits,
      clearEnterDigits,
      clearConfirmDigits,
      logout,
      saving,
      verifyingCurrent,
      t,
    ]
  );

  const activeFlow =
    changePhase === 'current'
      ? currentDigits
      : changePhase === 'confirm'
        ? confirmDigits
        : changePhase === 'enter'
          ? enterDigits
          : null;

  useEffect(() => {
    if (!activeFlow?.isComplete || saving || verifyingCurrent) return;
    void onDigitComplete(activeFlow.value);
  }, [activeFlow?.isComplete, activeFlow?.value, onDigitComplete, saving, verifyingCurrent]);

  if (!user || !isPinMandatoryRole(user.role)) return null;

  if (loading) {
    return (
      <div className="pin-settings-panel">
        <div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700/50" />
      </div>
    );
  }

  const flowTitle =
    changePhase === 'current'
      ? t('pin.enterCurrent') || 'Enter current PIN'
      : changePhase === 'confirm'
        ? t('pin.confirmTitle') || 'Confirm your PIN'
        : t('pin.createTitle') || 'Create your 4-digit PIN';

  /** First-time / reset setup: auto-lock is chosen with the PIN (no separate Edit). */
  const setupAutoLockEditable = !pinSet || pinMustReset || changePhase === 'enter';
  /** Existing PIN: Edit → Cancel/Save like other settings sections. */
  const showAutoLockEditToolbar = pinSet && !pinMustReset && changePhase === 'idle';
  const showAutoLockSlider =
    setupAutoLockEditable || (showAutoLockEditToolbar && isEditingAutoLock);

  return (
    <>
      <ConfirmDialogHost />
      <div
        className={`pin-settings-panel pin-lock-card space-y-5 p-5 sm:p-6 ${
          isEditingAutoLock ? 'ring-2 ring-primary-500/20' : ''
        }`}
      >
        {(!pinSet || pinMustReset) && (
          <div className="pin-settings-alert">
            {pinMustReset
              ? t('pin.resetAlert') ||
                'Verify your email after too many wrong PIN attempts, then create a new PIN below.'
              : t('pin.createAlert') ||
                'Create your 4-digit PIN below to unlock the app, Projects, and Security.'}
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-left">
            <h3 className="font-bold pin-lock-title flex items-center gap-2 text-sm sm:text-base">
              <Shield className="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0" />
              {t('pin.settingsTitle') || 'Security PIN'}
            </h3>
            <p className="text-xs sm:text-sm pin-lock-hint mt-1 leading-relaxed">
              {t('pin.setupSubtitle') ||
                'All portal accounts use the same 4-digit PIN. Set or change your PIN below.'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="pin-settings-badge">{t('pin.required') || 'Required'}</span>
            {showAutoLockEditToolbar ? (
              <SectionEditToolbar
                canEdit
                isEditing={isEditingAutoLock}
                saving={saving}
                editVariant="outline"
                onEdit={() => setIsEditingAutoLock(true)}
                onCancel={() => void handleCancelAutoLock()}
                onSave={() => void handleSaveAutoLock()}
              />
            ) : null}
          </div>
        </div>

        <div className="pin-settings-row">
          <Clock className="w-5 h-5 text-primary-500 dark:text-primary-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="text-xs font-semibold uppercase pin-lock-hint block mb-1.5">
              {t('pin.autoLockLabel') || 'Auto-lock after idle (minutes)'}
            </label>
            {showAutoLockSlider ? (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={autoLockMinutes}
                  onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                  className="flex-1 accent-primary-600"
                  disabled={saving}
                  aria-valuemin={1}
                  aria-valuemax={60}
                  aria-valuenow={autoLockMinutes}
                />
                <span className="text-sm font-semibold pin-lock-title w-12 text-right tabular-nums">
                  {autoLockMinutes}m
                </span>
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                {t('pin.autoLockValue', { minutes: String(savedAutoLockMinutes) }) ||
                  `${savedAutoLockMinutes} minutes`}
              </p>
            )}
            {showAutoLockEditToolbar && !isEditingAutoLock ? (
              <p className="mt-1.5 text-[11px] pin-lock-hint">
                {t('pin.autoLockEditHint') || 'Select Edit to change the auto-lock time.'}
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-slate-200/80 dark:border-slate-600/50 pt-5 space-y-4">
          {!pinSet ? (
            <p className="text-xs font-semibold uppercase pin-lock-hint">
              {t('pin.createSection') || 'Create PIN'}
            </p>
          ) : changePhase === 'idle' ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                disabled={isEditingAutoLock || saving}
                onClick={() => {
                  setPinError(null);
                  setChangePhase('current');
                  clearCurrentDigits();
                }}
              >
                {t('pin.startChange') || 'Change PIN'}
              </button>
            </div>
          ) : null}

          {changePhase !== 'idle' && (
            <div className="text-center space-y-4">
              <p className="text-sm font-medium pin-lock-title">{flowTitle}</p>
              {changePhase === 'current' && (
                <p className="text-xs pin-lock-hint leading-relaxed">
                  {t('pin.currentRequiredHint') ||
                    'Enter your current PIN correctly to continue. You cannot set a new PIN until this step succeeds.'}
                </p>
              )}
              <PinStatusSlot
                error={pinError}
                attempts={changePhase === 'current' ? remainingAttempts : null}
                attemptsText={
                  remainingAttempts != null && remainingAttempts > 0
                    ? t('pin.attemptsRemaining', { count: String(remainingAttempts) }) ||
                      `${remainingAttempts} attempt(s) remaining`
                    : null
                }
              />
              <PinDigitIndicators count={4} filled={activeFlow?.digits.length ?? 0} />
              <PinKeypad
                digits={activeFlow?.digits ?? []}
                loading={saving || verifyingCurrent}
                keyboardEnabled={!saving && !verifyingCurrent}
                onDigit={(d) => {
                  setPinError(null);
                  activeFlow?.push(d);
                }}
                onBackspace={() => {
                  setPinError(null);
                  activeFlow?.pop();
                }}
              />
              <button
                type="button"
                className="text-xs pin-lock-hint hover:text-slate-700 dark:hover:text-slate-200 underline"
                onClick={resetPinFlow}
              >
                {t('pin.cancel') || 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
