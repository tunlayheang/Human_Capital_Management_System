import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, LogOut } from 'lucide-react';
import { Api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { PasswordFormAutofillTrap, PasswordInput } from '../ui/PasswordInput';
import { PasswordRequirements } from '../ui/PasswordRequirements';
import { validatePortalPassword } from '../../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';
import { Z_PIN_LOCK } from '../../utils/overlayPortal';

function apiErrMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

/**
 * Full-screen gate after first sign-in (new staff or system admin) until the user
 * chooses their own password. Shown above the app shell; PIN setup waits until this clears.
 * Also applies after an admin assigns a temporary password on an existing account.
 */
export const MustChangePasswordGate: React.FC = () => {
  const { user, refreshUser, logout } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  usePortalPasswordPolicy();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  if (!user?.mustChangePassword) return null;

  const usernameHint = user.email || user.phone || user.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newPassword || !confirmPassword) {
      setError(t('profile.mustChangeAllFields') || 'Enter and confirm your new password.');
      return;
    }
    const check = validatePortalPassword(newPassword);
    if (!check.valid) {
      setError(check.message);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('profile.passwordMismatch') || 'New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      await Api.auth.changePassword('', newPassword, { forceChange: true });
      await refreshUser();
      setNewPassword('');
      setConfirmPassword('');
      const msg = t('profile.passwordChanged') || 'Password changed successfully.';
      showToast(msg, 'success');
    } catch (err) {
      const msg = apiErrMessage(err) || t('profile.passwordChangeError');
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      style={{ zIndex: Z_PIN_LOCK + 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="must-change-password-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-xl bg-amber-100 dark:bg-amber-900/40 p-2.5 text-amber-700 dark:text-amber-300">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2
              id="must-change-password-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {t('profile.mustChangeTitle') || 'Set your password'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t('profile.mustChangeSubtitle') ||
                'For security, choose a new password before continuing. You signed in with a temporary password.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative space-y-4" autoComplete="off">
          <PasswordFormAutofillTrap />
          <PasswordInput
            purpose="new"
            label={t('profile.newPassword') || 'New Password'}
            usernameHint={usernameHint}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            showToggle
            autoFocus
          />
          <PasswordInput
            purpose="confirm"
            label={t('profile.confirmPassword') || 'Confirm Password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            showToggle
          />
          <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5">
            <PasswordRequirements password={newPassword} />
          </div>
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void logout({ skipConfirm: true })}
              icon={<LogOut className="w-4 h-4" />}
            >
              {t('nav.logout') || 'Sign out'}
            </Button>
            <Button
              type="submit"
              disabled={saving}
              icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
            >
              {saving
                ? t('common.saving') || 'Saving…'
                : t('profile.mustChangeSubmit') || 'Save and continue'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
