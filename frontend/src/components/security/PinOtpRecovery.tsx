import React, { useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { Api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { parsePinApiError } from '../../utils/pinApi';
import { formatAuthDeliveryError } from '../../utils/authDeliveryError';
import { filterInputChange } from '../../utils/formInputFilters';
import { OtpExpiryCountdown } from '../auth/OtpExpiryCountdown';

type Props = {
  maskedEmail?: string;
  onVerified: () => void;
  autoSend?: boolean;
};

export const PinOtpRecovery: React.FC<Props> = ({
  maskedEmail: initialMasked,
  onVerified,
  autoSend = true,
}) => {
  const { t } = useLanguage();
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState(initialMasked ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [expiresInSeconds, setExpiresInSeconds] = useState(180);
  const [otpIssuedAt, setOtpIssuedAt] = useState<number | null>(null);
  const [emailUnavailable, setEmailUnavailable] = useState(false);
  const autoSendAttemptedRef = useRef(false);

  const applyExpiry = (res?: { expiresInSeconds?: number; expiresInMinutes?: number }) => {
    if (typeof res?.expiresInSeconds === 'number' && Number.isFinite(res.expiresInSeconds)) {
      setExpiresInSeconds(Math.max(1, Math.floor(res.expiresInSeconds)));
    } else if (typeof res?.expiresInMinutes === 'number' && Number.isFinite(res.expiresInMinutes)) {
      setExpiresInSeconds(Math.max(1, Math.round(res.expiresInMinutes * 60)));
    } else {
      setExpiresInSeconds(180);
    }
    setOtpIssuedAt(Date.now());
  };

  const sendCode = async () => {
    if (emailUnavailable) return;
    setSending(true);
    setError(null);
    setDevHint(null);
    try {
      const res = await Api.auth.sendPinRecoveryOtp();
      if (res?.maskedEmail) setMaskedEmail(res.maskedEmail);
      applyExpiry(res);
      if (res?.devOtp) setDevHint(res.devOtp);
      // Server may skip email when Gmail is not configured and unlock PIN setup instead.
      if (res?.pinRecoveryReady || res?.emailBypassed) {
        onVerified();
        return;
      }
    } catch (e: unknown) {
      const { message, code, meta } = parsePinApiError(e);
      if (meta.pinRecoveryReady) {
        onVerified();
        return;
      }
      const safeMessage = formatAuthDeliveryError(
        e,
        t('pin.otpEmailUnavailable') ||
          t('messages.otpDeliveryUnavailable') ||
          message
      );
      if (
        code === 'EMAIL_NOT_CONFIGURED' ||
        code === 'EMAIL_DELIVERY_FAILED' ||
        safeMessage !== message
      ) {
        setEmailUnavailable(true);
      }
      setError(safeMessage);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!autoSend || autoSendAttemptedRef.current || emailUnavailable) return;
    autoSendAttemptedRef.current = true;
    void sendCode();
  }, [autoSend, emailUnavailable]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.replace(/\D/g, '');
    if (code.length < 4) {
      setError(t('pin.otpInvalid') || 'Enter the code from your email.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await Api.auth.verifyPinRecoveryOtp(code);
      onVerified();
    } catch (err: unknown) {
      const { message } = parsePinApiError(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pin-otp-recovery w-full max-w-[min(100%,22rem)] sm:max-w-sm mx-auto text-center space-y-2.5 sm:space-y-4 px-1 pb-1">
      <div className="pin-lock-icon mx-auto w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg">
        <Mail className="w-7 h-7 text-white" />
      </div>
      <div>
        <h2 className="text-lg font-bold pin-lock-title">
          {t('pin.otpTitle') || 'Verify your email'}
        </h2>
        <p className="text-xs pin-lock-hint mt-2 leading-relaxed px-2">
          {emailUnavailable
            ? t('pin.otpEmailUnavailable') ||
              'Email delivery is not configured on this server. Contact your administrator to reset your PIN.'
            : t('pin.otpSubtitle') ||
              'After 3 wrong PIN attempts, enter the code sent to your Gmail to create a new PIN.'}
        </p>
        {maskedEmail && !emailUnavailable && (
          <p className="text-sm pin-lock-subtitle mt-2 font-medium">{maskedEmail}</p>
        )}
      </div>

      {devHint && (
        <p className="text-xs rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200/80 dark:border-amber-800/50">
          Dev code: <span className="font-mono font-bold">{devHint}</span>
        </p>
      )}

      {!emailUnavailable && (
        <form onSubmit={submit} className="space-y-3 text-left">
          <label className="text-xs pin-lock-hint block">
            {t('pin.otpLabel') || 'Verification code'}
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={otp}
            onChange={(e) => setOtp(filterInputChange('otp', e.target.value, { maxLength: 8 }))}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-center text-lg tracking-[0.35em] font-semibold pin-lock-title outline-none focus:ring-2 focus:ring-primary-500/30"
            placeholder="••••••"
          />
          <OtpExpiryCountdown
            durationSeconds={expiresInSeconds}
            issuedAt={otpIssuedAt}
            i18nScope="pin"
            className="text-xs pin-lock-hint text-center tabular-nums"
          />
          {error && (
            <p className="text-sm pin-lock-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || otp.length < 4}
            className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? t('pin.verifying') || 'Verifying…' : t('pin.otpVerify') || 'Verify code'}
          </button>
        </form>
      )}

      {emailUnavailable && error && (
        <p className="text-sm pin-lock-error px-2" role="alert">
          {error}
        </p>
      )}

      {!emailUnavailable && (
        <button
          type="button"
          onClick={() => void sendCode()}
          disabled={sending}
          className="inline-flex items-center gap-2 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${sending ? 'animate-spin' : ''}`} />
          {t('pin.otpResend') || 'Resend code'}
        </button>
      )}
    </div>
  );
};
