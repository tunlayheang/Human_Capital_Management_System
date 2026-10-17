import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle,
  Fingerprint,
  KeyRound,
  Lock,
  Mail,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '../ui/Button';
import {
  authBtnPrimaryClass,
  authInputClass,
  authLabelClass,
  authLinkClass,
} from '../auth/authStyles';
import { AuthSplitLayout, type AuthFeatureItem } from '../auth/AuthSplitLayout';
import { AuthEmployeeIdField } from '../auth/AuthEmployeeIdField';
import { OtpCodeInput } from '../auth/OtpCodeInput';
import { OtpExpiryCountdown } from '../auth/OtpExpiryCountdown';
import { useLanguage } from '../../context/LanguageContext';
import { PasswordRequirements } from '../ui/PasswordRequirements';
import { PasswordFormAutofillTrap, PasswordInput } from '../ui/PasswordInput';
import { validatePortalPassword } from '../../utils/passwordPolicy';

export type LoginStep =
  | 'login'
  | 'forgot-password'
  | 'verify-reset-otp'
  | 'set-new-password';

type Props = {
  step: LoginStep;
  employeeId: string;
  otpEmail: string;
  password: string;
  newPassword: string;
  otp: string;
  loading: boolean;
  showPassword: boolean;
  formErrors: Record<string, string>;
  isFormValid: boolean;
  onEmployeeIdChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onNewPasswordChange: (v: string) => void;
  onOtpChange: (v: string) => void;
  onStepChange: (step: LoginStep) => void;
  onTogglePassword: () => void;
  onLogin: (e: React.FormEvent) => void;
  onForgotPassword: (e: React.FormEvent) => void;
  onVerifyResetOtp: (e: React.FormEvent) => void;
  onResetPassword: (e: React.FormEvent) => void;
  onResendResetOtp: () => void;
  /** Optional — careers landing was removed; omit to hide the back link. */
  onBackToLanding?: () => void;
  /** OTP validity window in seconds (default 180). */
  otpExpiresInSeconds?: number;
  /** Epoch ms when the current OTP was issued / resent. */
  otpIssuedAt?: number | null;
};

const RegisteredEmailCard: React.FC<{
  otpEmail: string;
  employeeId: string;
  t: (key: string) => string;
}> = ({ otpEmail, employeeId, t }) => (
  <div className="auth-notice-card">
    <p className="auth-notice-card-label">{t('login.codeSentTo')}</p>
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600">
        <Mail className="h-4 w-4 text-[#1a5fa8] dark:text-blue-400" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{otpEmail || '—'}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('login.employeeIdLinkedTo')}{' '}
          <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{employeeId}</span>
        </p>
      </div>
    </div>
  </div>
);

const AuthFormHeader: React.FC<{
  title: string;
  description?: string;
  t: (key: string) => string;
}> = ({ title, description, t }) => (
  <header className="mb-1">
    <p className="auth-form-eyebrow">{t('login.staffPortal')}</p>
    <h1 className="auth-form-title">{title}</h1>
    {description ? <p className="auth-form-desc">{description}</p> : null}
    <div className="auth-form-divider" aria-hidden />
  </header>
);

const RESET_FLOW_STEPS: LoginStep[] = ['forgot-password', 'verify-reset-otp', 'set-new-password'];

function ResetStepPills({
  step,
  t,
}: {
  step: LoginStep;
  t: (key: string) => string;
}) {
  const pills = [
    { id: 'forgot-password' as const, label: t('login.stepEmployeeId') },
    { id: 'verify-reset-otp' as const, label: t('login.stepVerify') },
    { id: 'set-new-password' as const, label: t('login.stepPassword') },
  ];
  const currentIdx = RESET_FLOW_STEPS.indexOf(step);
  return (
    <div className="auth-step-pills">
      {pills.map((p, i) => {
        const active = step === p.id;
        const done = currentIdx > i;
        return (
          <span
            key={p.id}
            className={`auth-step-pill${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
          >
            {p.label}
          </span>
        );
      })}
    </div>
  );
}

export const LoginStaffPanel: React.FC<Props> = ({
  step,
  employeeId,
  otpEmail,
  password,
  newPassword,
  otp,
  loading,
  showPassword,
  formErrors,
  isFormValid,
  onEmployeeIdChange,
  onPasswordChange,
  onNewPasswordChange,
  onOtpChange,
  onStepChange,
  onTogglePassword,
  onLogin,
  onForgotPassword,
  onVerifyResetOtp,
  onResetPassword,
  onResendResetOtp,
  onBackToLanding,
  otpExpiresInSeconds = 180,
  otpIssuedAt = null,
}) => {
  const { t } = useLanguage();

  const features: AuthFeatureItem[] = [
    {
      icon: Fingerprint,
      title: t('login.featurePinTitle'),
    },
    {
      icon: Calendar,
      title: t('login.featureAttTitle'),
    },
    {
      icon: Users,
      title: t('login.featureHrTitle'),
    },
  ];

  const stepTitle =
    step === 'login'
      ? t('login.welcomeBack')
      : step === 'forgot-password'
        ? t('login.resetPassword')
        : step === 'verify-reset-otp'
          ? t('login.verifyResetCode')
          : t('login.setNewPassword');

  const stepDesc =
    step === 'login'
      ? t('login.signInWithEmployeeIdPassword')
      : step === 'forgot-password'
        ? t('login.enterEmployeeIdForResetEmail')
        : step === 'verify-reset-otp'
          ? ''
          : t('login.enterNewPasswordOnly');

  return (
    <AuthSplitLayout
      title={t('login.portalTitle')}
      subtitle={t('login.portalSubtitle')}
      features={features}
      footer={
        <>
          <div className="auth-trust-row">
            <span className="auth-trust-pill">
              <ShieldCheck className="w-3.5 h-3.5 text-[#1a5fa8]" />
              {t('login.trustEncrypted')}
            </span>
            <span className="auth-trust-pill">
              <Lock className="w-3.5 h-3.5 text-[#1a5fa8]" />
              {t('login.trustPin')}
            </span>
          </div>
          {onBackToLanding ? (
            <p className="mt-4 text-center">
              <button
                type="button"
                onClick={onBackToLanding}
                className="auth-link inline-flex items-center gap-1.5 font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('common.back')}
              </button>
            </p>
          ) : null}
        </>
      }
    >
      {step !== 'login' && <ResetStepPills step={step} t={t} />}

      <AuthFormHeader title={stepTitle} description={stepDesc} t={t} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24 }}
        >
          {step === 'login' && (
            <form onSubmit={onLogin} className="space-y-4">
              <div>
                <label className={authLabelClass} htmlFor="login-employee-id">
                  {t('login.employeeId')}
                </label>
                <AuthEmployeeIdField
                  id="login-employee-id"
                  value={employeeId}
                  onChange={onEmployeeIdChange}
                  aria-invalid={!!formErrors.employeeId}
                />
                {formErrors.employeeId && (
                  <p className="auth-field-error" role="alert">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {formErrors.employeeId}
                  </p>
                )}
              </div>
              <PasswordFormAutofillTrap />
              <PasswordInput
                id="login-password"
                purpose="login"
                label={t('messages.password')}
                labelClassName={authLabelClass}
                inputClassName={authInputClass}
                showToggle
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                aria-invalid={!!formErrors.password}
                error={formErrors.password}
              />
              <Button
                type="submit"
                variant="ghost"
                className={authBtnPrimaryClass}
                isLoading={loading}
                disabled={loading || !isFormValid}
              >
                <KeyRound className="w-4 h-4" />
                {t('messages.signIn')}
                <ArrowRight className="w-4 h-4" />
              </Button>
              <button type="button" onClick={() => onStepChange('forgot-password')} className={authLinkClass}>
                {t('messages.forgotPassword')}
              </button>
            </form>
          )}

          {step === 'forgot-password' && (
            <form onSubmit={onForgotPassword} className="space-y-4">
              <div>
                <label className={authLabelClass} htmlFor="forgot-employee-id">
                  {t('login.employeeId')}
                </label>
                <AuthEmployeeIdField
                  id="forgot-employee-id"
                  value={employeeId}
                  onChange={onEmployeeIdChange}
                  aria-invalid={!!formErrors.employeeId}
                />
                {formErrors.employeeId && (
                  <p className="auth-field-error" role="alert">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {formErrors.employeeId}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                variant="ghost"
                className={authBtnPrimaryClass}
                isLoading={loading}
                disabled={loading || !employeeId.trim() || !!formErrors.employeeId}
              >
                <Send className="w-4 h-4" />
                {t('messages.sendResetOtp')}
              </Button>
              <button
                type="button"
                onClick={() => onStepChange('login')}
                className="w-full text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-1"
              >
                ← {t('messages.backToLogin')}
              </button>
            </form>
          )}

          {step === 'verify-reset-otp' && (
            <form onSubmit={onVerifyResetOtp} className="space-y-4">
              <RegisteredEmailCard otpEmail={otpEmail} employeeId={employeeId} t={t} />

              <div>
                <label className={authLabelClass}>{t('messages.oneTimePassword')}</label>
                <OtpCodeInput value={otp} onChange={onOtpChange} disabled={loading} />
                <OtpExpiryCountdown
                  durationSeconds={otpExpiresInSeconds}
                  issuedAt={otpIssuedAt}
                  i18nScope="login"
                  className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center tabular-nums"
                />
              </div>

              <Button
                type="submit"
                variant="ghost"
                className={authBtnPrimaryClass}
                isLoading={loading}
                disabled={otp.length !== 6 || loading}
              >
                {t('login.verifyCode')}
              </Button>
              <button
                type="button"
                onClick={onResendResetOtp}
                disabled={loading}
                className={`${authLinkClass} disabled:opacity-50`}
              >
                {t('messages.resendOtp')}
              </button>
              <button
                type="button"
                onClick={() => onStepChange('forgot-password')}
                className="w-full text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ← {t('messages.backToLogin')}
              </button>
            </form>
          )}

          {step === 'set-new-password' && (
            <form onSubmit={onResetPassword} className="relative space-y-4" autoComplete="off">
              <PasswordFormAutofillTrap />
              <div className="rounded-lg border border-emerald-200/90 dark:border-emerald-800/50 bg-emerald-50/80 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                  {t('login.emailVerifiedSetPassword')}
                </p>
              </div>

              <PasswordInput
                purpose="new"
                label={t('messages.newPassword')}
                labelClassName={authLabelClass}
                inputClassName={`${authInputClass} pl-4`}
                value={newPassword}
                onChange={(e) => onNewPasswordChange(e.target.value)}
                usernameHint={employeeId}
                required
              />
              <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/50 px-3 py-2">
                <PasswordRequirements password={newPassword} />
              </div>

              <Button
                type="submit"
                variant="ghost"
                className={authBtnPrimaryClass}
                isLoading={loading}
                disabled={!validatePortalPassword(newPassword).valid || loading}
              >
                {t('messages.resetPassword')}
              </Button>
              <button
                type="button"
                onClick={() => onStepChange('login')}
                className="w-full text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ← {t('messages.backToLogin')}
              </button>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthSplitLayout>
  );
};
