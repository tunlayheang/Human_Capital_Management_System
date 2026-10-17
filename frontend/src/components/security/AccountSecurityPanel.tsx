import React, { useMemo, useState } from 'react';
import { Loader } from 'lucide-react';
import { PinSecuritySettings } from './PinSecuritySettings';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { Api } from '../../services/api';
import { PasswordRequirements } from '../ui/PasswordRequirements';
import { PasswordFormAutofillTrap, PasswordInput } from '../ui/PasswordInput';
import { validatePortalPassword } from '../../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';
import { InfoDetailsButton } from '../ui/InfoDetailsButton';
import { SectionEditToolbar } from '../ui/SectionEditToolbar';

const EMPTY_PASSWORD = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

function apiErrMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

export const AccountSecurityPanel: React.FC = () => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { user, refreshUser } = useAuth();
  usePortalPasswordPolicy();
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [passwordData, setPasswordData] = useState(EMPTY_PASSWORD);

  const fieldsLocked = !isEditingPassword || isPasswordSaving;

  const canSavePassword = useMemo(() => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      return false;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) return false;
    return validatePortalPassword(passwordData.newPassword).valid;
  }, [passwordData]);

  const handlePasswordFieldChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isEditingPassword) return;
    const { name, value } = e.target;
    const key =
      name === 'hcms-portal-current-password'
        ? 'currentPassword'
        : name === 'hcms-portal-new-password'
          ? 'newPassword'
          : name === 'hcms-portal-confirm-password'
            ? 'confirmPassword'
            : null;
    if (!key) return;
    setPasswordData((prev) => ({ ...prev, [key]: value }));
  };

  const resetPasswordForm = () => {
    setPasswordData(EMPTY_PASSWORD);
    setMessage(null);
  };

  const handleCancelPassword = () => {
    resetPasswordForm();
    setIsEditingPassword(false);
  };

  const savePasswordChange = async () => {
    setMessage(null);
    if (!canSavePassword) {
      const msg = 'All password fields are required.';
      if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
        setMessage({ text: msg, type: 'error' });
        return;
      }
      const pwdCheck = validatePortalPassword(passwordData.newPassword);
      if (!pwdCheck.valid) {
        setMessage({ text: pwdCheck.message, type: 'error' });
        return;
      }
      if (passwordData.newPassword !== passwordData.confirmPassword) {
        setMessage({ text: 'New password and confirmation do not match.', type: 'error' });
      }
      return;
    }
    setIsPasswordSaving(true);
    try {
      await Api.auth.changePassword(passwordData.currentPassword, passwordData.newPassword);
      resetPasswordForm();
      setIsEditingPassword(false);
      await refreshUser();
      const msg = t('profile.passwordChanged');
      setMessage({ text: msg, type: 'success' });
      showToast(msg, 'success');
    } catch (err) {
      const msg = apiErrMessage(err) || t('profile.passwordChangeError');
      setMessage({ text: msg, type: 'error' });
      showToast(msg, 'error');
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingPassword || isPasswordSaving || !canSavePassword) return;
    await savePasswordChange();
  };

  const usernameHint = user?.email || user?.phone || user?.id || '';

  return (
    <div className="space-y-6 w-full min-w-0">
      {message && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch w-full min-w-0">
        <div className="min-w-0 h-full [&_.pin-settings-panel]:h-full">
          <PinSecuritySettings />
        </div>

        <form
          onSubmit={handlePasswordSubmit}
          autoComplete="off"
          className={`relative surface-card shadow-sm p-5 sm:p-6 space-y-5 min-w-0 h-full flex flex-col ${
            isEditingPassword ? 'ring-2 ring-primary-500/20' : ''
          }`}
        >
          <PasswordFormAutofillTrap />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('profile.changePassword')}
              </h3>
              <InfoDetailsButton
                title={t('profile.changePassword')}
                summary={t('profile.securityNoticeText')}
                ariaLabel="Password policy guidelines"
              />
            </div>
            <SectionEditToolbar
              canEdit
              isEditing={isEditingPassword}
              saving={isPasswordSaving}
              saveDisabled={!canSavePassword}
              editVariant="outline"
              onEdit={() => {
                setMessage(null);
                setIsEditingPassword(true);
              }}
              onCancel={handleCancelPassword}
              onSave={() => void savePasswordChange()}
            />
          </div>

          <div className={`space-y-5 ${fieldsLocked && !isEditingPassword ? 'opacity-70' : ''}`}>
            <PasswordInput
              purpose="current"
              label={t('profile.currentPassword')}
              usernameHint={usernameHint}
              value={passwordData.currentPassword}
              onChange={handlePasswordFieldChange}
              showToggle={isEditingPassword}
              disabled={fieldsLocked}
              autoFocus={isEditingPassword}
              readOnly={!isEditingPassword}
              placeholder={isEditingPassword ? undefined : '••••••••'}
              aria-label={t('profile.currentPassword')}
            />
            <div className="grid grid-cols-1 gap-5">
              <PasswordInput
                purpose="new"
                label={t('profile.newPassword')}
                usernameHint={usernameHint}
                value={passwordData.newPassword}
                onChange={handlePasswordFieldChange}
                showToggle={isEditingPassword}
                disabled={fieldsLocked}
              />
              <PasswordInput
                purpose="confirm"
                label={t('profile.confirmPassword')}
                value={passwordData.confirmPassword}
                onChange={handlePasswordFieldChange}
                showToggle={isEditingPassword}
                disabled={fieldsLocked}
              />
            </div>
          </div>
          <div
            className={`rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5 ${
              fieldsLocked && !isEditingPassword ? 'opacity-70' : ''
            }`}
          >
            <PasswordRequirements password={passwordData.newPassword} />
          </div>
          {isPasswordSaving ? (
            <div className="mt-auto pt-1 flex items-center gap-2 text-sm text-slate-500">
              <Loader className="w-4 h-4 animate-spin" />
              Saving…
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
};
