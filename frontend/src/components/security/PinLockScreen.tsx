import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Shield } from 'lucide-react';
import { Api } from '../../services/api';
import { PinKeypad } from './PinKeypad';
import { PinThemeToggle } from './PinThemeToggle';
import { PinOtpRecovery } from './PinOtpRecovery';
import { PinAdminResetRequired } from './PinAdminResetRequired';
import { PinDigitIndicators, PinLoadingSlot, PinStatusSlot, usePinDigits } from './pinShared';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePinLock } from '../../context/PinLockContext';
import {
  PIN_MAX_ATTEMPTS,
  parsePinApiError,
  stashPinLockoutMessage,
} from '../../utils/pinApi';
import { Z_PIN_LOCK } from '../../utils/overlayPortal';

interface PinLockScreenProps {
  userName: string;
  /** e.g. "Projects" — shown on section gate */
  sectionLabel?: string;
  /** First-time user — create PIN (no email OTP). */
  needsFirstTimeSetup: boolean;
  /** Admin lockout — must verify Gmail OTP first. */
  requiresOtpRecovery: boolean;
  /** Non-admin lockout — Admin must reset PIN. */
  requiresAdminReset: boolean;
  pinRecoveryReady: boolean;
  maskedEmail?: string;
  autoLockMinutes: number;
  onVerified: () => void;
  onLogout: () => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  userName,
  sectionLabel,
  needsFirstTimeSetup,
  requiresOtpRecovery,
  requiresAdminReset,
  pinRecoveryReady: pinRecoveryReadyProp,
  maskedEmail,
  autoLockMinutes: initialAutoLock,
  onVerified,
  onLogout,
}) => {
  const { t } = useLanguage();
  const { refreshUser, logout } = useAuth();
  const { refreshSecurity } = usePinLock();
  const [otpVerified, setOtpVerified] = useState(pinRecoveryReadyProp);
  const [setupAutoLock, setSetupAutoLock] = useState(initialAutoLock);
  const [phase, setPhase] = useState<'enter' | 'confirm'>('enter');
  const [pendingPin, setPendingPin] = useState('');
  const enterDigits = usePinDigits();
  const confirmDigits = usePinDigits();
  const { clear: clearEnterDigits } = enterDigits;
  const { clear: clearConfirmDigits } = confirmDigits;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState(maskedEmail);
  /** Immediate switch to OTP UI when verify returns lockout (before security refresh). */
  const [otpLockout, setOtpLockout] = useState(requiresOtpRecovery);
  const [adminResetLockout, setAdminResetLockout] = useState(requiresAdminReset);
  const pinFocusRef = useRef<HTMLDivElement>(null);
  const forceLogoutInFlight = useRef(false);

  const showAdminReset = requiresAdminReset || adminResetLockout;
  const setupMode =
    !showAdminReset &&
    (pinRecoveryReadyProp ||
      otpVerified ||
      (needsFirstTimeSetup && !requiresOtpRecovery && !otpLockout));
  const showOtp =
    !showAdminReset &&
    (requiresOtpRecovery || otpLockout) &&
    !otpVerified &&
    !pinRecoveryReadyProp;
  const activeDigits = phase === 'enter' ? enterDigits : confirmDigits;

  useEffect(() => {
    setOtpVerified(pinRecoveryReadyProp);
  }, [pinRecoveryReadyProp]);

  useEffect(() => {
    if (maskedEmail) setRecoveryEmail(maskedEmail);
  }, [maskedEmail]);

  useEffect(() => {
    if (requiresOtpRecovery) setOtpLockout(true);
  }, [requiresOtpRecovery]);

  useEffect(() => {
    if (requiresAdminReset) setAdminResetLockout(true);
  }, [requiresAdminReset]);

  useEffect(() => {
    if (!showOtp && !showAdminReset) pinFocusRef.current?.focus();
  }, [showOtp, showAdminReset, phase]);

  const forceLogoutAfterLockout = useCallback(
    async (message: string) => {
      if (forceLogoutInFlight.current) return;
      forceLogoutInFlight.current = true;
      stashPinLockoutMessage(message);
      await logout({ skipConfirm: true });
    },
    [logout]
  );

  const resetEntry = useCallback(() => {
    clearEnterDigits();
    clearConfirmDigits();
    setPendingPin('');
    setPhase('enter');
  }, [clearEnterDigits, clearConfirmDigits]);

  const handleOtpVerified = useCallback(async () => {
    setOtpVerified(true);
    setError(null);
    resetEntry();
    await refreshSecurity();
  }, [refreshSecurity, resetEntry]);

  const submitPin = useCallback(
    async (pin: string) => {
      if (showAdminReset) return;
      if (
        (requiresOtpRecovery || otpLockout) &&
        !otpVerified &&
        !pinRecoveryReadyProp
      ) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (setupMode) {
          if (phase === 'enter') {
            setPendingPin(pin);
            setPhase('confirm');
            clearConfirmDigits();
            setLoading(false);
            return;
          }
          if (pin !== pendingPin) {
            setError(t('pin.mismatch') || 'PINs do not match. Try again.');
            resetEntry();
            setLoading(false);
            return;
          }
          await Api.auth.setPin(pin, undefined, setupAutoLock);
          await refreshUser();
          onVerified();
          return;
        }

        await Api.auth.verifyPin(pin);
        setRemainingAttempts(null);
        onVerified();
      } catch (e: unknown) {
        const { message, meta } = parsePinApiError(e);
        if (meta.forceLogout) {
          clearEnterDigits();
          clearConfirmDigits();
          setLoading(false);
          await forceLogoutAfterLockout(
            message ||
              t('pin.lockoutSignedOut') ||
              'Too many incorrect PIN attempts. You have been signed out.'
          );
          return;
        }
        if (meta.requiresAdminPinReset || meta.pinRequiresAdminReset) {
          setAdminResetLockout(true);
          setError(null);
          clearEnterDigits();
          clearConfirmDigits();
          await refreshSecurity();
          setLoading(false);
          return;
        }
        if (meta.requiresOtpRecovery || meta.pinRequiresOtpRecovery) {
          setOtpLockout(true);
          if (meta.maskedEmail) setRecoveryEmail(meta.maskedEmail);
          setError(null);
          clearEnterDigits();
          clearConfirmDigits();
          await refreshSecurity();
          setLoading(false);
          return;
        }
        setError(message);
        clearEnterDigits();
        if (typeof meta.remainingAttempts === 'number') {
          setRemainingAttempts(meta.remainingAttempts);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      setupMode,
      phase,
      pendingPin,
      setupAutoLock,
      refreshUser,
      onVerified,
      resetEntry,
      clearEnterDigits,
      clearConfirmDigits,
      refreshSecurity,
      requiresOtpRecovery,
      otpLockout,
      otpVerified,
      pinRecoveryReadyProp,
      showAdminReset,
      forceLogoutAfterLockout,
      t,
    ]
  );

  useEffect(() => {
    if (showOtp || showAdminReset || !activeDigits.isComplete) return;
    void submitPin(activeDigits.value);
  }, [activeDigits.isComplete, activeDigits.value, showOtp, showAdminReset, submitPin]);

  const title = showOtp || showAdminReset
    ? ''
    : setupMode
      ? phase === 'enter'
        ? needsFirstTimeSetup && !otpVerified
          ? t('pin.createTitle') || 'Create your 4-digit PIN'
          : t('pin.createNewTitle') || 'Create a new PIN'
        : t('pin.confirmTitle') || 'Confirm your PIN'
      : t('pin.enterTitle') || 'Enter security PIN';

  const sectionHint = sectionLabel
    ? t('pin.sectionGate', { section: sectionLabel }) ||
      `Enter your PIN to open ${sectionLabel}`
    : null;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const isFirstLoginSetup =
    setupMode &&
    needsFirstTimeSetup &&
    !otpVerified &&
    !requiresOtpRecovery &&
    !pinRecoveryReadyProp &&
    !showAdminReset;

  const subtitle = showOtp || showAdminReset
    ? ''
    : setupMode
      ? isFirstLoginSetup
        ? t('pin.firstLoginSubtitle') ||
          'Create your PIN now to continue — required on first sign-in.'
        : t('pin.setupSubtitle') ||
          'All portal accounts use the same 4-digit PIN. Choose a PIN only you know.'
      : sectionHint ||
        t('pin.enterSubtitle', { minutes: String(initialAutoLock) }) ||
        `Enter your PIN · auto-locks after ${initialAutoLock} min idle`;

  return (
    <div
      className="pin-lock-screen fixed inset-0 p-3 sm:p-4 md:px-6"
      style={{ zIndex: Z_PIN_LOCK }}
      role="dialog"
      aria-modal
      aria-label={t('pin.dialogLabel') || 'Security PIN'}
    >
      <PinThemeToggle className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-10" />

      <div className="pin-lock-card pin-lock-card--responsive w-full max-w-[min(100%,22rem)] sm:max-w-sm text-center px-3 py-4 sm:px-6 sm:py-6 rounded-2xl sm:rounded-3xl mx-auto">
        {sectionLabel && !showOtp && !showAdminReset && (
          <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-3 sm:mb-4">
            {sectionLabel}
          </p>
        )}
        {showAdminReset ? (
          <PinAdminResetRequired onLogout={() => void logout({ skipConfirm: true })} />
        ) : showOtp ? (
          <PinOtpRecovery
            maskedEmail={recoveryEmail}
            autoSend
            onVerified={() => void handleOtpVerified()}
          />
        ) : (
          <>
            <div className="pin-lock-icon mx-auto w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center mb-4 sm:mb-6 shadow-lg">
              <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
            </div>
            <h2 className="text-base sm:text-lg md:text-xl font-bold pin-lock-title px-1">{title}</h2>
            <p className="text-xs sm:text-sm pin-lock-subtitle mt-1 truncate max-w-full px-1">
              {userName}
            </p>
            <p className="text-[11px] sm:text-xs pin-lock-hint mt-2 mb-3 sm:mb-5 leading-relaxed px-1">
              {subtitle}
            </p>

            {setupMode && phase === 'enter' && (
              <div className="pin-lock-setup-slider mb-3 sm:mb-5 w-full max-w-xs px-1 text-left mx-auto">
                <label className="text-xs pin-lock-hint block mb-2">
                  {t('pin.autoLockLabel') || 'Auto-lock after idle (minutes)'}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={60}
                    value={setupAutoLock}
                    onChange={(e) => setSetupAutoLock(Number(e.target.value))}
                    className="flex-1 accent-primary-600"
                    tabIndex={phase === 'enter' ? 0 : -1}
                  />
                  <span className="text-sm font-semibold pin-lock-title w-10 text-right tabular-nums">
                    {setupAutoLock}m
                  </span>
                </div>
              </div>
            )}

            <PinStatusSlot
              error={error}
              attempts={setupMode ? null : remainingAttempts}
              attemptsText={
                remainingAttempts != null && remainingAttempts > 0
                  ? t('pin.attemptsRemaining', { count: String(remainingAttempts) }) ||
                    `${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining`
                  : null
              }
            />

            <div className="pin-digit-row mb-3 sm:mb-6">
              <PinDigitIndicators count={4} filled={activeDigits.digits.length} />
            </div>

            <div
              ref={pinFocusRef}
              tabIndex={-1}
              className="sr-only outline-none"
              aria-label={t('pin.dialogLabel') || 'Security PIN'}
            />

            <PinKeypad
              keyboardEnabled={!loading}
              digits={activeDigits.digits}
              loading={loading}
              onDigit={(d) => {
                setError(null);
                activeDigits.push(d);
              }}
              onBackspace={() => {
                setError(null);
                activeDigits.pop();
              }}
              onLogout={onLogout}
              logoutAriaLabel={t('pin.logoutKey') || 'Sign out'}
            />

            <PinLoadingSlot loading={loading} label={t('pin.verifying') || 'Verifying…'} />

            {!setupMode && (
              <p className="text-[10px] pin-lock-hint mt-4 opacity-80">
                {t('pin.maxAttemptsHint', { max: String(PIN_MAX_ATTEMPTS) }) ||
                  `After ${PIN_MAX_ATTEMPTS} wrong attempts you will be signed out.`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
