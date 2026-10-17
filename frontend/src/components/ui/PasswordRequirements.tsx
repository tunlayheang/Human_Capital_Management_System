import React from 'react';
import { Check, X } from 'lucide-react';
import {
  getActivePasswordRequirementKeys,
  getPasswordRequirementChecks,
  type PasswordRequirementKey,
  type PortalPasswordPolicy,
} from '../../utils/passwordPolicy';
import { useLanguage } from '../../context/LanguageContext';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';

type Props = {
  password: string;
  className?: string;
  /** Optional override; defaults to org policy loaded from the API. */
  policy?: Partial<PortalPasswordPolicy>;
};

export const PasswordRequirements: React.FC<Props> = ({ password, className = '', policy: policyProp }) => {
  const { t } = useLanguage();
  const { policy: loadedPolicy } = usePortalPasswordPolicy();
  const policy = policyProp ? { ...loadedPolicy, ...policyProp } : loadedPolicy;
  const checks = getPasswordRequirementChecks(password, policy);
  const keys = getActivePasswordRequirementKeys(policy);

  const labels: Record<PasswordRequirementKey, string> = {
    length:
      t('security.passwordReqLength', { min: String(policy.minLength) }) ||
      `At least ${policy.minLength} characters`,
    lower: t('security.passwordReqLower') || 'One lowercase letter (a–z)',
    upper: t('security.passwordReqUpper') || 'One uppercase letter (A–Z)',
    digit: t('security.passwordReqDigit') || 'One number (0–9)',
    special:
      t('security.passwordReqSpecial') || 'One special character (!@#$%&*?+-=)',
  };

  return (
    <ul
      className={`text-xs space-y-1.5 text-left ${className}`}
      aria-label={t('security.passwordRequirementsTitle') || 'Password requirements'}
    >
      {keys.map((key) => {
        const ok = checks[key];
        return (
          <li
            key={key}
            className={`flex items-start gap-2 ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}
          >
            {ok ? (
              <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
            ) : (
              <X className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" aria-hidden />
            )}
            <span>{labels[key]}</span>
          </li>
        );
      })}
    </ul>
  );
};
