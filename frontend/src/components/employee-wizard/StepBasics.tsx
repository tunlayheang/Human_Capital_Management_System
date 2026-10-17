import React, { useCallback, useState } from 'react';
import { Zap, Shield } from 'lucide-react';
import { Role } from '../../types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { accessRoleOptionsForEmployeeForm } from '../../utils/accessRole';
import { PHONE_FORMAT_HINT, registerDigitsOnly } from '../../utils/digitsOnlyInput';
import { registerFilteredInput } from '../../utils/formInputFilters';
import { useLanguage } from '../../context/LanguageContext';
import {
  WizardField,
  WizardFieldFull,
  WizardFieldGrid,
  WizardHighlightPanel,
  WizardSectionCard,
  WizardStepStack,
  WizardInput,
  WIZARD_INPUT_CLASS,
  WIZARD_READONLY_CLASS,
} from './wizardLayout';
import { WizardKhmerFieldGrid, WizardKhmerSubsection } from './wizardKhmerSection';

interface StepBasicsProps {
  register: any;
  errors: Record<string, any>;
  setValue: any;
  watchAccessRole?: Role;
  watchAllowLogin: boolean;
  employeeDisplayId?: string;
  portalAccountLinked?: boolean;
  onPortalAccessChange?: (enabled: boolean) => void;
  onValidateContact?: () => void;
  isManager: boolean;
  isEdit?: boolean;
}

export const StepBasics: React.FC<StepBasicsProps> = ({
  register,
  errors,
  setValue,
  watchAccessRole,
  watchAllowLogin,
  employeeDisplayId = '',
  portalAccountLinked = false,
  onPortalAccessChange,
  onValidateContact,
  isManager,
  isEdit = false,
}) => {
  const { t } = useLanguage();
  const emailField = register('email', {
    onBlur: () => onValidateContact?.(),
  });
  const { onBlur: phoneOnBlur, ...phoneInputProps } = registerFilteredInput(register, 'phone', 'phone', {
    maxLength: 11,
  });
  const { onBlur: telegramOnBlur, ...telegramInputProps } = registerFilteredInput(
    register,
    'telegramNumber',
    'phone',
    { maxLength: 11 }
  );
  const portalAccessOn = watchAllowLogin;
  const accessOptions = accessRoleOptionsForEmployeeForm();
  const isSystemAdminAccess = watchAccessRole === Role.ADMIN;
  const [portalConfirmOpen, setPortalConfirmOpen] = useState(false);

  const disablePortalAccess = useCallback(() => {
    setValue('allowLogin', false, { shouldValidate: true, shouldDirty: true });
    onPortalAccessChange?.(false);
    setValue('portalPassword', '', { shouldValidate: true, shouldDirty: true });
  }, [setValue, onPortalAccessChange]);

  const enablePortalAccess = useCallback(() => {
    setValue('allowLogin', true, { shouldValidate: true, shouldDirty: true });
    onPortalAccessChange?.(true);
    setValue('portalPassword', '', { shouldValidate: true, shouldDirty: true });
  }, [setValue, onPortalAccessChange]);

  const handlePortalConfirmYes = useCallback(() => {
    enablePortalAccess();
    setPortalConfirmOpen(false);
  }, [enablePortalAccess]);

  return (
    <WizardStepStack>
      <ConfirmDialog
        open={portalConfirmOpen}
        onClose={() => setPortalConfirmOpen(false)}
        title="Allow login to portal?"
        description="A portal account will be created for this employee. An administrator must set their sign-in password afterward in User Management before they can use password login."
        variant="success"
        confirmLabel="Enable portal login"
        cancelLabel="Cancel"
        onConfirm={handlePortalConfirmYes}
      />
      <WizardSectionCard
        icon={Zap}
        title="Identity & access"
      >
        <WizardFieldGrid>
          <WizardFieldFull>
            <WizardField
              label="Employee ID"
              error={errors.id?.message}
            >
              <input {...register('id')} readOnly className={`${WIZARD_READONLY_CLASS} font-mono`} />
            </WizardField>
          </WizardFieldFull>

          <WizardField label="Last name" required error={errors.lastName?.message}>
            <WizardInput register={register} name="lastName" filter="name" />
          </WizardField>

          <WizardField label="First name" required error={errors.firstName?.message}>
            <WizardInput register={register} name="firstName" filter="name" />
          </WizardField>

          <WizardKhmerSubsection>
            <WizardKhmerFieldGrid>
              <WizardField label={t('onboarding.khmer.lastName')} error={errors.lastNameKh?.message}>
                <WizardInput register={register} name="lastNameKh" filter="name" />
              </WizardField>
              <WizardField label={t('onboarding.khmer.firstName')} error={errors.firstNameKh?.message}>
                <WizardInput register={register} name="firstNameKh" filter="name" />
              </WizardField>
            </WizardKhmerFieldGrid>
          </WizardKhmerSubsection>

          <WizardField label="Work email" required error={errors.email?.message}>
            <input
              type="email"
              {...emailField}
              placeholder="Used for login & notifications"
              className={WIZARD_INPUT_CLASS}
            />
          </WizardField>

          <WizardField label="Phone" required error={errors.phone?.message}>
            <input
              {...phoneInputProps}
              placeholder={PHONE_FORMAT_HINT}
              onBlur={(e) => {
                void phoneOnBlur(e);
                onValidateContact?.();
              }}
              className={`${WIZARD_INPUT_CLASS} font-mono`}
            />
          </WizardField>

          <WizardField
            label="Telegram number"
            error={errors.telegramNumber?.message}
            hint="Shown on the employee ID card. Leave blank if not used."
          >
            <input
              {...telegramInputProps}
              placeholder={PHONE_FORMAT_HINT}
              onBlur={(e) => {
                void telegramOnBlur(e);
              }}
              className={`${WIZARD_INPUT_CLASS} font-mono`}
            />
          </WizardField>
        </WizardFieldGrid>
      </WizardSectionCard>

      <WizardHighlightPanel active={portalAccessOn}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Allow login to portal
              </p>
              {portalAccountLinked && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100">
                  Account linked
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={portalAccessOn}
            aria-label="Allow login to portal"
            onClick={() => {
              if (portalAccessOn) {
                disablePortalAccess();
              } else {
                setPortalConfirmOpen(true);
              }
            }}
            className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
              portalAccessOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                portalAccessOn ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <input type="hidden" {...register('portalPassword')} />
      </WizardHighlightPanel>

      <WizardSectionCard
        icon={Shield}
        title="Access role"
      >
        {isSystemAdminAccess && (
          <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">
            This account has <strong>Admin</strong> portal access. Change it in User Management; pick Staff, Manager,
            or HR below only if you are replacing that access level.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {accessOptions.map((opt) => {
            const selected = !isSystemAdminAccess && watchAccessRole === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex flex-col gap-2 rounded-xl border p-4 cursor-pointer transition-colors ${
                  selected
                    ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                } ${isManager ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  value={opt.value}
                  disabled={isManager}
                  {...register('accessRole')}
                  className="sr-only"
                />
                <span className="flex items-center gap-2">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      selected
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-slate-300 dark:border-slate-500'
                    }`}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{opt.label}</span>
                </span>
              </label>
            );
          })}
        </div>
        {isManager && !isEdit && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Your access role is Manager — new employees receive <strong>Staff</strong> portal access only.
          </p>
        )}
      </WizardSectionCard>
    </WizardStepStack>
  );
};
