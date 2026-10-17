import React, { useCallback, useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronRight,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Shield,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { GeneratedPasswordField } from '../ui/GeneratedPasswordField';
import { assertPortalPasswordZod } from '../../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../../hooks/usePortalPasswordPolicy';
import { joinPersonNameParts } from '../../utils/personDisplayName';
import { normalizePhone } from '../../utils/phone';
import { PHONE_FORMAT_HINT, registerFilteredInput } from '../../utils/formInputFilters';

const schema = z
  .object({
    firstName: z.string().min(2, 'First name is required'),
    lastName: z.string().min(2, 'Last name is required'),
    email: z.string().email('Valid email is required'),
    phone: z
      .string()
      .min(1, 'Phone number is required')
      .refine((v) => {
        const digits = String(v ?? '').replace(/\D/g, '');
        return /^\d+$/.test(digits) && digits.length >= 8 && digits.length <= 11;
      }, {
        message: `Numbers only — use format ${PHONE_FORMAT_HINT}`,
      }),
    password: z
      .string()
      .min(1, 'Password is required')
      .superRefine((val, ctx) => assertPortalPasswordZod(val, ctx)),
    confirmPassword: z.string().min(1, 'Confirm the password'),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

type SystemAdminRow = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  loginId?: string | null;
  displayEmployeeId?: string | null;
  isActive?: boolean;
  status?: string;
  role?: string;
};

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-base';

const LABEL_CLASS = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5';

function adminLoginCode(row: SystemAdminRow): string {
  return String(row.loginId || row.displayEmployeeId || '')
    .trim()
    .toUpperCase();
}

function isAdminActive(row: SystemAdminRow): boolean {
  if (row.isActive === false) return false;
  const status = String(row.status || '').toUpperCase();
  if (status === 'INACTIVE' || status === 'FROZEN' || status === 'DISABLED') return false;
  return true;
}

export type CreateAdminTabProps = {
  /** Called after the form is cleared — e.g. leave the Create Admin settings tab. */
  onCancel?: () => void;
};

export const CreateAdminTab: React.FC<CreateAdminTabProps> = ({ onCancel }) => {
  const { showToast } = useToast();
  usePortalPasswordPolicy();
  const [previewLoginId, setPreviewLoginId] = useState<string>('');
  const [loadingLoginId, setLoadingLoginId] = useState(true);
  const [admins, setAdmins] = useState<SystemAdminRow[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      isActive: true,
    },
  });

  const phoneField = registerFilteredInput(register, 'phone', 'phone', { maxLength: 11 });

  const handleCancel = () => {
    reset({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      isActive: true,
    });
    clearErrors();
    onCancel?.();
  };

  const loadNextLoginId = useCallback(async () => {
    setLoadingLoginId(true);
    try {
      const res = await Api.users.getNextAdminLoginId();
      setPreviewLoginId(String(res?.loginId || '').toUpperCase());
    } catch {
      setPreviewLoginId('');
    } finally {
      setLoadingLoginId(false);
    }
  }, []);

  const loadAdmins = useCallback(async () => {
    setLoadingAdmins(true);
    try {
      const rows = await Api.users.listSystemAdmins();
      setAdmins(Array.isArray(rows) ? (rows as SystemAdminRow[]) : []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load administrators', 'error');
      setAdmins([]);
    } finally {
      setLoadingAdmins(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadNextLoginId();
    void loadAdmins();
  }, [loadNextLoginId, loadAdmins]);

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    try {
      const displayName = joinPersonNameParts(values.firstName, values.lastName);
      const created = await Api.users.createSystemAdmin({
        displayName,
        email: values.email.trim(),
        phone: normalizePhone(values.phone),
        password: values.password,
        isActive: values.isActive,
        loginId: previewLoginId || undefined,
      });
      const assigned =
        String((created as any)?.loginId || (created as any)?.displayEmployeeId || previewLoginId || '')
          .trim()
          .toUpperCase();
      showToast(
        assigned
          ? `System administrator created. AdminID for login: ${assigned}. They must change this password on first sign-in.`
          : 'System administrator created. They must change their password on first sign-in.',
        'success'
      );
      reset({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
        isActive: true,
      });
      await Promise.all([loadNextLoginId(), loadAdmins()]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create administrator', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-5 xl:gap-6 items-start w-full min-w-0">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white inline-flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-primary-600 dark:text-primary-400">Create new</span>
              <ChevronRight
                className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0"
                aria-hidden
              />
              <span>Create administrator</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Portal login only — no employee HR record. They must change the temporary password on
              first sign-in.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            <Shield className="w-3 h-3" aria-hidden />
            Admin
          </span>
        </div>

        <div className="p-5 space-y-6">
          <section className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Identity
            </p>
            <div>
              <label className={LABEL_CLASS}>AdminID</label>
              <input
                type="text"
                readOnly
                value={loadingLoginId ? 'Loading…' : previewLoginId || '—'}
                className={`${INPUT_CLASS} font-mono tracking-wide bg-slate-100/90 dark:bg-slate-800/70 cursor-default text-slate-700 dark:text-slate-200`}
              />
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Auto-assigned. Sign in with this code and password (not phone).
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Profile
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Last name</label>
                <input
                  {...register('lastName')}
                  placeholder="e.g. Doe"
                  autoComplete="family-name"
                  className={INPUT_CLASS}
                />
                {errors.lastName ? (
                  <p className="mt-1 text-xs text-red-600">{errors.lastName.message}</p>
                ) : null}
              </div>
              <div>
                <label className={LABEL_CLASS}>First name</label>
                <input
                  {...register('firstName')}
                  placeholder="e.g. John"
                  autoComplete="given-name"
                  className={INPUT_CLASS}
                />
                {errors.firstName ? (
                  <p className="mt-1 text-xs text-red-600">{errors.firstName.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" aria-hidden />
                    Login email
                  </span>
                </label>
                <input
                  type="email"
                  autoComplete="off"
                  {...register('email')}
                  placeholder="admin@company.com"
                  className={INPUT_CLASS}
                />
                {errors.email ? (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                ) : null}
              </div>
              <div>
                <label className={LABEL_CLASS}>
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" aria-hidden />
                    Phone number
                  </span>
                </label>
                <input
                  {...phoneField}
                  placeholder={PHONE_FORMAT_HINT}
                  className={`${INPUT_CLASS} font-mono`}
                />
                {errors.phone ? (
                  <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Digits only · {PHONE_FORMAT_HINT}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Security
            </p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 p-4">
              <input type="hidden" {...register('password')} />
              <input type="hidden" {...register('confirmPassword')} />
              <GeneratedPasswordField
                password={watch('password') || ''}
                onPasswordChange={(pwd) => {
                  setValue('password', pwd, { shouldValidate: true, shouldDirty: true });
                  setValue('confirmPassword', pwd, { shouldValidate: true, shouldDirty: true });
                }}
                error={errors.password?.message || errors.confirmPassword?.message}
                fieldLabel="Temporary password"
                generateLabel="Generate password"
                generatedHint="Copy this password before creating the account. The admin must change it on first sign-in."
                showRequirements
              />
            </div>

            <label className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <input
                type="checkbox"
                {...register('isActive')}
                className="rounded border-slate-300 text-primary-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                  Account active
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Inactive accounts cannot sign in
                </span>
              </span>
            </label>
          </section>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            icon={<X className="w-4 h-4" />}
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting} icon={<UserPlus className="w-4 h-4" />}>
            Create
          </Button>
        </div>
      </form>

      <aside className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden xl:sticky xl:top-4">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
              Created administrators
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Portal-only accounts · {admins.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAdmins()}
            disabled={loadingAdmins}
            className="inline-flex items-center gap-1.5 shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-primary-600 disabled:opacity-50"
          >
            {loadingAdmins ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh
          </button>
        </div>

        <div className="max-h-[min(36rem,70vh)] overflow-y-auto">
          {loadingAdmins && admins.length === 0 ? (
            <div className="p-10 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : admins.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                No administrators yet
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Create one with the form on the left.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/80">
              {admins.map((admin) => {
                const code = adminLoginCode(admin);
                const active = isAdminActive(admin);
                return (
                  <li
                    key={admin.id}
                    className="px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {admin.name || 'System Administrator'}
                        </p>
                        <p className="font-mono text-xs font-medium text-primary-700 dark:text-primary-300 tracking-wide">
                          {code || '—'}
                        </p>
                        <div className="pt-0.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                          <p className="truncate">{admin.email || '—'}</p>
                          {admin.phone ? <p className="truncate">{admin.phone}</p> : null}
                        </div>
                      </div>
                      <Badge variant={active ? 'success' : 'neutral'}>
                        {active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
};

export default CreateAdminTab;
