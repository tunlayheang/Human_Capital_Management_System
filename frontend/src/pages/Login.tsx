import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { LoginStaffPanel, type LoginStep } from '../components/login/LoginStaffPanel';
import { invalidatePortalBrandingCache } from '../services/portalBranding';
import { validatePortalPassword } from '../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../hooks/usePortalPasswordPolicy';
import { takePinLockoutMessage } from '../utils/pinApi';
import { normalizeEmployeeDisplayId } from '../utils';
import { formatAuthDeliveryError } from '../utils/authDeliveryError';
import { AuthBootSplash } from '../components/auth/AuthBootSplash';

export const Login: React.FC = () => {
  const {
    login,
    forgotPassword,
    verifyResetPasswordOtp,
    resetPassword,
    redeemHandoff,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { t } = useLanguage();
  usePortalPasswordPolicy();

  const postLoginPath = () => {
    const redirect = searchParams.get('redirect');
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      return redirect;
    }
    return '/dashboard';
  };

  useEffect(() => {
    invalidatePortalBrandingCache();
  }, []);

  useEffect(() => {
    const lockoutMsg = takePinLockoutMessage();
    if (lockoutMsg) {
      showToast(lockoutMsg, 'warning');
    }
  }, [showToast]);

  // Home-screen / shortcut: redeem one-time transfer from Safari login.
  useEffect(() => {
    const token = searchParams.get('handoff');
    if (!token || isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      const ok = await redeemHandoff(token);
      if (cancelled) return;
      if (ok) {
        navigate(postLoginPath(), { replace: true });
      } else {
        const next = new URLSearchParams(searchParams);
        next.delete('handoff');
        navigate(
          { pathname: '/login', search: next.toString() ? `?${next}` : '' },
          { replace: true }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per handoff token
  }, [searchParams.get('handoff')]);

  const [step, setStep] = useState<LoginStep>('login');
  const [employeeId, setEmployeeId] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [resetOtpVerified, setResetOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [isFormValid, setIsFormValid] = useState(false);
  const [otpExpiresInSeconds, setOtpExpiresInSeconds] = useState(180);
  const [otpIssuedAt, setOtpIssuedAt] = useState<number | null>(null);

  useEffect(() => {
    const errors: { [key: string]: string } = {};
    const id = normalizeEmployeeDisplayId(employeeId);

    if (!id) {
      errors.employeeId = t('messages.employeeIdRequired');
    } else if (!/^[A-Z0-9]{3,32}$/.test(id)) {
      errors.employeeId = t('messages.employeeIdInvalid');
    }

    if (step === 'login') {
      if (!password.trim()) {
        errors.password = t('messages.passwordRequired');
      } else if (password.length < 4) {
        errors.password = t('messages.passwordMinLength');
      }
    }

    setFormErrors(errors);
    const idOk = /^[A-Z0-9]{3,32}$/.test(id);
    const pwdOk = step !== 'login' || password.trim().length >= 4;
    setIsFormValid(idOk && pwdOk && Object.keys(errors).length === 0);
  }, [employeeId, password, step, t]);

  if (authLoading) {
    return <AuthBootSplash label="Restoring your session…" />;
  }
  if (isAuthenticated) {
    return <Navigate to={postLoginPath()} replace />;
  }

  const showOtpSentToast = (res?: { devOtp?: string; maskedEmail?: string }) => {
    if (res?.devOtp) {
      showToast(t('messages.otpSentDev').replace('{code}', res.devOtp), 'success');
    } else if (res?.maskedEmail) {
      showToast(t('messages.otpSentToEmail').replace('{email}', res.maskedEmail), 'success');
    } else {
      showToast(t('messages.otpSent'), 'success');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(normalizeEmployeeDisplayId(employeeId), password);
      showToast(t('messages.welcomeBack'), 'success');
      navigate(postLoginPath());
    } catch (error: any) {
      console.error(error);
      showToast(error.message || t('messages.loginFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const applyOtpExpiry = (res?: { expiresInSeconds?: number; expiresInMinutes?: number }) => {
    if (typeof res?.expiresInSeconds === 'number' && Number.isFinite(res.expiresInSeconds)) {
      setOtpExpiresInSeconds(Math.max(1, Math.floor(res.expiresInSeconds)));
    } else if (typeof res?.expiresInMinutes === 'number' && Number.isFinite(res.expiresInMinutes)) {
      setOtpExpiresInSeconds(Math.max(1, Math.round(res.expiresInMinutes * 60)));
    } else {
      setOtpExpiresInSeconds(180);
    }
    setOtpIssuedAt(Date.now());
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await forgotPassword(normalizeEmployeeDisplayId(employeeId));
      if (res?.maskedEmail) setOtpEmail(res.maskedEmail);
      applyOtpExpiry(res);
      showOtpSentToast(res);
      setOtp('');
      setNewPassword('');
      setResetOtpVerified(false);
      setStep('verify-reset-otp');
    } catch (error: any) {
      console.error(error);
      showToast(
        formatAuthDeliveryError(
          error,
          t('messages.otpDeliveryUnavailable') || t('messages.failedRequestOtp')
        ),
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendResetOtp = async () => {
    setLoading(true);
    try {
      const res = await forgotPassword(normalizeEmployeeDisplayId(employeeId));
      if (res?.maskedEmail) setOtpEmail(res.maskedEmail);
      applyOtpExpiry(res);
      showOtpSentToast(res);
      setResetOtpVerified(false);
      setOtp('');
      setStep('verify-reset-otp');
    } catch (error: any) {
      showToast(
        formatAuthDeliveryError(
          error,
          t('messages.otpDeliveryUnavailable') || t('messages.failedRequestOtp')
        ),
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      showToast(t('messages.invalidOtp') || 'Enter the 6-digit code from your email.', 'error');
      return;
    }
    setLoading(true);
    try {
      await verifyResetPasswordOtp(normalizeEmployeeDisplayId(employeeId), otp);
      setResetOtpVerified(true);
      showToast(t('messages.otpVerified') || 'Code verified. Set your new password.', 'success');
      setStep('set-new-password');
    } catch (error: any) {
      console.error(error);
      showToast(error.message || t('messages.invalidOtp'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOtpVerified) {
      showToast(
        t('messages.verifyOtpBeforePassword') ||
          'Verify the email code before setting a new password.',
        'error'
      );
      setStep('verify-reset-otp');
      return;
    }
    const pwdCheck = validatePortalPassword(newPassword);
    if (!pwdCheck.valid) {
      showToast(pwdCheck.message, 'error');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(normalizeEmployeeDisplayId(employeeId), newPassword);
      setResetOtpVerified(false);
      showToast(t('messages.passwordResetSuccess'), 'success');
      setStep('login');
      setPassword('');
      setOtp('');
      setNewPassword('');
    } catch (error: any) {
      console.error(error);
      const msg = String(error?.message || '');
      if (/verify your email code/i.test(msg)) {
        setResetOtpVerified(false);
        setStep('verify-reset-otp');
      }
      showToast(msg || t('messages.failedResetPassword'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginStaffPanel
      step={step}
      employeeId={employeeId}
      otpEmail={otpEmail}
      password={password}
      newPassword={newPassword}
      otp={otp}
      loading={loading}
      showPassword={showPassword}
      formErrors={formErrors}
      isFormValid={isFormValid}
      onEmployeeIdChange={setEmployeeId}
      onPasswordChange={setPassword}
      onNewPasswordChange={setNewPassword}
      onOtpChange={setOtp}
      onStepChange={setStep}
      onTogglePassword={() => setShowPassword((v) => !v)}
      onLogin={handleLogin}
      onForgotPassword={handleForgotPassword}
      onVerifyResetOtp={handleVerifyResetOtp}
      onResetPassword={handleResetPassword}
      onResendResetOtp={handleResendResetOtp}
      otpExpiresInSeconds={otpExpiresInSeconds}
      otpIssuedAt={otpIssuedAt}
    />
  );
};
