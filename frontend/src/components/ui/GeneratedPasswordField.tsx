import React, { useCallback, useState } from 'react';
import { Copy, Check, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { Button } from './Button';
import { useToast } from '../../context/ToastContext';
import { generatePortalPassword } from '../../utils/generatePortalPassword';
import { PasswordRequirements } from './PasswordRequirements';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';

const EXISTING_PASSWORD_MASK = '••••••••••••••';

/** Masked display — one bullet per character (never pad/truncate). */
function maskForDisplay(password: string, showExistingMask: boolean): string {
  if (password.length > 0) {
    return '•'.repeat(password.length);
  }
  if (showExistingMask) return EXISTING_PASSWORD_MASK;
  return '';
}

function copyTextFallback(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export type GeneratedPasswordFieldProps = {
  password: string;
  onPasswordChange: (password: string) => void;
  /** When true, show masked dots if no new password was generated yet (existing account password). */
  showExistingPasswordMask?: boolean;
  minLength?: number;
  optional?: boolean;
  error?: string;
  generateLabel?: string;
  fieldLabel?: string;
  existingHint?: string;
  generatedHint?: string;
  showRequirements?: boolean;
};

export const GeneratedPasswordField: React.FC<GeneratedPasswordFieldProps> = ({
  password,
  onPasswordChange,
  showExistingPasswordMask = false,
  minLength: minLengthProp,
  optional = false,
  error,
  showRequirements = true,
  generateLabel = 'Generate password',
  fieldLabel,
  existingHint = 'A password is already set on this account. Generate a new one to reset it.',
  generatedHint = 'Copy this password before saving. It is shown as dots for security.',
}) => {
  const { showToast } = useToast();
  const { policy } = usePortalPasswordPolicy();
  const minLength = minLengthProp ?? policy.minLength;
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const pwdTrim = password.trim();
  const canCopy = pwdTrim.length >= minLength;
  const showMaskField = canCopy || showExistingPasswordMask;
  const displayMask = maskForDisplay(password, showExistingPasswordMask && !canCopy);
  const canRevealGenerated = canCopy;
  /** Prefer explicit bullets so the visible count always equals the password length. */
  const inputValue = canRevealGenerated && revealed ? password : displayMask;

  const handleGenerate = useCallback(() => {
    const pwd = generatePortalPassword(undefined, policy);
    onPasswordChange(pwd);
    setCopied(false);
    showToast('Password generated.', 'success');
  }, [onPasswordChange, policy, showToast]);

  const handleCopy = useCallback(async () => {
    const pwd = password.trim();
    if (pwd.length < minLength) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pwd);
      } else if (!copyTextFallback(pwd)) {
        throw new Error('Clipboard unavailable');
      }
      setCopied(true);
      showToast('Password copied to clipboard.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy. Try again.', 'error');
    }
  }, [password, minLength, showToast]);

  const toggleReveal = useCallback(() => {
    if (!canRevealGenerated) return;
    setRevealed((v) => !v);
  }, [canRevealGenerated]);

  const hint =
    canCopy
      ? generatedHint
      : showExistingPasswordMask
        ? existingHint
        : optional
          ? 'Leave blank to keep the current password.'
          : 'Generate a password to continue.';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          icon={<RefreshCw className="w-4 h-4" />}
        >
          {generateLabel}
        </Button>
        {canCopy && (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            New password ready — save to apply
          </span>
        )}
      </div>

      {showMaskField && (
        <div>
          {fieldLabel && (
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {fieldLabel}
              {!optional && !showExistingPasswordMask && canCopy && (
                <span className="text-red-500 ml-0.5" aria-hidden>
                  *
                </span>
              )}
            </label>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              tabIndex={-1}
              autoComplete="off"
              spellCheck={false}
              value={inputValue}
              aria-readonly="true"
              aria-label={
                canCopy
                  ? revealed
                    ? 'Generated password'
                    : 'Generated password (masked)'
                  : 'Existing password is set (masked)'
              }
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 font-mono tracking-wide cursor-default select-none"
            />
            <button
              type="button"
              onClick={toggleReveal}
              disabled={!canRevealGenerated}
              title={canRevealGenerated ? (revealed ? 'Hide password' : 'Show password') : 'Generate a password first'}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              className="shrink-0 inline-flex items-center justify-center h-[42px] w-[42px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {revealed ? (
                <EyeOff className="w-4 h-4" aria-hidden />
              ) : (
                <Eye className="w-4 h-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!canCopy}
              title={canCopy ? 'Copy password' : 'Generate a password first'}
              aria-label="Copy password"
              className="shrink-0 inline-flex items-center justify-center h-[42px] w-[42px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-600" aria-hidden />
              ) : (
                <Copy className="w-4 h-4" aria-hidden />
              )}
            </button>
          </div>
        </div>
      )}

      {showRequirements && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5">
          <PasswordRequirements password={pwdTrim} policy={policy} />
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};
