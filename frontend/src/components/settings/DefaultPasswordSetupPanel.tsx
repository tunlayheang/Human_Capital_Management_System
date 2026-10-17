import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { InfoDetailsButton } from '../ui/InfoDetailsButton';
import { PasswordFormAutofillTrap, PasswordInput } from '../ui/PasswordInput';
import { PasswordRequirements } from '../ui/PasswordRequirements';
import { validatePortalPassword } from '../../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';

type DefaultPasswordStatus = {
  enabled?: boolean;
  isSet?: boolean;
  source?: 'settings' | 'env' | 'fallback';
  /** Resolved plaintext from API — masked in the UI until the eye toggle reveals it. */
  password?: string;
};

/** Match backend coerceDefaultPasswordEnabled — treat missing as enabled. */
export function coerceDefaultPasswordEnabled(raw: unknown): boolean {
  if (raw === false || raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'false' || s === 'off' || s === 'no' || s === '') return false;
  }
  if (raw == null) return true;
  return Boolean(raw);
}

function sourceLabel(source?: string): string {
  if (source === 'settings') return 'Configured in Settings';
  if (source === 'env') return 'Using server environment variable';
  return 'Using built-in fallback (change it below)';
}

export type DefaultPasswordSetupHandle = {
  /** Persist pending changes. Returns false on validation/API failure. */
  save: () => Promise<boolean>;
  /** Revert fields to last loaded status. */
  reset: () => void;
  isDirty: () => boolean;
};

type DefaultPasswordSetupPanelProps = {
  /** When false, fields are view-only until Security footer Edit is clicked. */
  editing?: boolean;
  /** Notifies parent so the sticky Save Changes bar can enable/disable. */
  onDirtyChange?: (dirty: boolean) => void;
};

export const DefaultPasswordSetupPanel = forwardRef<
  DefaultPasswordSetupHandle,
  DefaultPasswordSetupPanelProps
>(function DefaultPasswordSetupPanel({ editing = false, onDirtyChange }, ref) {
  const { showToast } = useToast();
  usePortalPasswordPolicy();
  const [status, setStatus] = useState<DefaultPasswordStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const savedEnabled = coerceDefaultPasswordEnabled(status?.enabled);

  const applyStatusToFields = (data: DefaultPasswordStatus | null | undefined) => {
    const current = String(data?.password ?? '').trim();
    setPassword(current);
    setConfirmPassword(current);
    setEnabled(coerceDefaultPasswordEnabled(data?.enabled));
  };

  const computeDirty = useCallback(
    (
      nextEnabled: boolean,
      nextPassword: string,
      nextConfirm: string,
      data: DefaultPasswordStatus | null
    ) => {
      const original = String(data?.password ?? '').trim();
      const enabledChanged = nextEnabled !== coerceDefaultPasswordEnabled(data?.enabled);
      const passwordChanged = nextPassword.trim() !== original;
      return enabledChanged || passwordChanged;
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await Api.system.getDefaultPassword()) as DefaultPasswordStatus;
      setStatus({
        ...data,
        enabled: coerceDefaultPasswordEnabled(data?.enabled),
      });
      applyStatusToFields(data);
      setError(null);
      onDirtyChange?.(false);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'Unable to load default password status';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [onDirtyChange, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) {
      applyStatusToFields(status);
      setError(null);
      onDirtyChange?.(false);
    }
  }, [editing, status, onDirtyChange]);

  useEffect(() => {
    if (!editing) {
      onDirtyChange?.(false);
      return;
    }
    onDirtyChange?.(computeDirty(enabled, password, confirmPassword, status));
  }, [editing, enabled, password, confirmPassword, status, computeDirty, onDirtyChange]);

  const reset = useCallback(() => {
    applyStatusToFields(status);
    setError(null);
    onDirtyChange?.(false);
  }, [status, onDirtyChange]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!editing) return true;
    setError(null);

    const next = password.trim();
    const original = String(status?.password ?? '').trim();
    const passwordChanged = next !== original;
    const enabledChanged = enabled !== coerceDefaultPasswordEnabled(status?.enabled);

    if (!passwordChanged && !enabledChanged) {
      return true;
    }

    if (enabled && passwordChanged) {
      if (!next) {
        setError('Default password is required when the feature is enabled.');
        return false;
      }
      const check = validatePortalPassword(next);
      if (!check.valid) {
        setError(check.message);
        return false;
      }
      if (next !== confirmPassword.trim()) {
        setError('Password and confirmation do not match.');
        return false;
      }
    } else if (enabled && !original && !next) {
      setError('Set a default password before enabling this feature.');
      return false;
    } else if (passwordChanged && next) {
      const check = validatePortalPassword(next);
      if (!check.valid) {
        setError(check.message);
        return false;
      }
      if (next !== confirmPassword.trim()) {
        setError('Password and confirmation do not match.');
        return false;
      }
    }

    try {
      // Always send `enabled` so toggle-only saves persist correctly (including `false`).
      const result = (await Api.system.saveDefaultPassword({
        enabled,
        ...(passwordChanged && next
          ? { password: next, confirmPassword: confirmPassword.trim() }
          : {}),
      })) as DefaultPasswordStatus & { success?: boolean; enabled?: boolean };

      const persistedEnabled = coerceDefaultPasswordEnabled(
        result?.enabled !== undefined ? result.enabled : enabled
      );
      if (persistedEnabled !== enabled) {
        setError(
          `Server did not ${enabled ? 'enable' : 'disable'} the default password. Please try again.`
        );
        showToast('Default password toggle did not save. Please try again.', 'error');
        await load();
        return false;
      }

      showToast(
        enabled
          ? 'Default password enabled for new accounts only. Existing users are unchanged.'
          : 'Default password disabled. New accounts will require an explicit password.',
        'success'
      );
      await load();
      return true;
    } catch (err: unknown) {
      let msg = 'Failed to save default password';
      if (err && typeof err === 'object' && 'response' in err) {
        const apiMsg = (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message;
        if (apiMsg) msg = apiMsg;
      } else if (err instanceof Error && err.message) {
        msg = err.message;
      }
      setError(msg);
      showToast(msg, 'error');
      return false;
    }
  }, [confirmPassword, editing, enabled, load, password, showToast, status]);

  useImperativeHandle(
    ref,
    () => ({
      save,
      reset,
      isDirty: () => computeDirty(enabled, password, confirmPassword, status),
    }),
    [save, reset, computeDirty, enabled, password, confirmPassword, status]
  );

  if (loading && !status) {
    return (
      <section className="hcms-settings-section flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading default password…
      </section>
    );
  }

  const fieldsLocked = !editing;
  const togglePending = editing && enabled !== savedEnabled;

  return (
    <section className="hcms-settings-section" aria-label="Default portal password">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Default Password
          </h3>
          <InfoDetailsButton
            title="Default portal password"
            summary="Optional temporary password assigned only when a new portal account is created without a custom password. Updating this value does not change any existing user's password. New staff must still change their password on first login."
            tips={[
              'Use Edit, then the Enable toggle, then Save Changes on the bar below.',
              'When disabled, admins must set a temporary password for each new portal account.',
              'Existing accounts are never reset when you change this setting.',
              'Password policy rules (length and complexity) still apply when enabled.',
            ]}
            ariaLabel="Default password guidelines"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          icon={<RefreshCw className="w-4 h-4" />}
        >
          Refresh
        </Button>
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3 ${
          enabled ? 'mb-4' : ''
        }`}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Enable default password
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Optional. When off, admins must set a password when creating each new portal account.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-xs font-semibold tabular-nums ${
              enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {enabled ? 'On' : 'Off'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-controls="default-password-details"
            aria-expanded={enabled}
            aria-label={enabled ? 'Disable default password' : 'Enable default password'}
            disabled={!editing}
            onClick={() => {
              if (!editing) return;
              setEnabled((v) => !v);
              setError(null);
            }}
            className={`relative inline-flex h-8 w-14 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
              enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                enabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {!enabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <XCircle className="w-4 h-4" />
            Default password is disabled
          </span>
          {togglePending ? (
            <span className="text-amber-700 dark:text-amber-400 text-xs font-medium">
              · Unsaved — use Save Changes
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          enabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden" aria-hidden={!enabled}>
          <div id="default-password-details" className="pt-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {status?.isSet ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Default password is enabled
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  Enabled — set a password below
                </span>
              )}
              <span className="text-slate-500 dark:text-slate-400">
                · {sourceLabel(status?.source)}
              </span>
              {togglePending ? (
                <span className="text-amber-700 dark:text-amber-400 text-xs font-medium">
                  · Unsaved — use Save Changes
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
              Applies to new portal accounts only. Existing users keep their current password. New
              staff must change their password on first login whether you use the default or set a
              custom one.
            </p>

            <div className="relative space-y-4 max-w-md">
              <PasswordFormAutofillTrap />
              <PasswordInput
                purpose="new"
                label="New default password"
                value={password}
                readOnly={fieldsLocked}
                onChange={(e) => {
                  if (fieldsLocked) return;
                  setPassword(e.target.value);
                }}
                showToggle
                placeholder="Set or change the default password"
              />
              <PasswordInput
                purpose="confirm"
                label="Confirm default password"
                value={confirmPassword}
                readOnly={fieldsLocked}
                onChange={(e) => {
                  if (fieldsLocked) return;
                  setConfirmPassword(e.target.value);
                }}
                showToggle
                placeholder="Re-enter the default password"
              />
              {editing ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5">
                  <PasswordRequirements password={password} />
                </div>
              ) : null}
              {error ? (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
