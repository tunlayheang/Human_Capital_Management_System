import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createWorkspaceShellCache,
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useRegisterPullToRefresh } from '../context/PullToRefreshContext';
import {
  Edit,
  FileText,
  Snowflake,
  Shield,
  Plus,
  Mail,
  Phone,
  UserCheck,
  UserX,
  KeyRound,
  Lock,
  Building,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  IdCard,
  AlertTriangle,
} from 'lucide-react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../components/ui/Button';
import { ResponsiveRowActions } from '../components/ui/ResponsiveRowActions';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { PageShell, ListSearchFilterBar, ContentSkeleton } from '../components/ui/page';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Api } from '../services/api';
import { User as UserType, Role, Department } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { EmployeeAvatar } from '../components/employee/EmployeeAvatar';
import {
  EmployeeListIdentityBlock,
  EmployeeListIdentityCell,
  EmployeeListIdentityCells,
  employeeListIdentityFromEmployeeRow,
  employeeListIdentityFromUser,
} from '../components/employee/EmployeeListIdentity';
import { GeneratedPasswordField } from '../components/ui/GeneratedPasswordField';
import { EMPLOYEE_LINKED_PORTAL_ROLES, normalizeAccessRole } from '../utils/accessRole';
import {
  effectiveUserIsActive,
  isEmployeeDraftStatus,
  isEmployeeInactiveForPortal,
} from '../utils/employeePortalStatus';
import { employeeSearchHaystack, matchesEmployeeSearch } from '../utils/employeeSearchText';
import { isPinMandatoryRole } from '../utils/pinSecurity';
import { userDisplayEmployeeCode, userDisplayName } from '../utils/userProfile';
import { resolveEmployeeRecordDisplayName } from '../utils/personDisplayName';
import { resolveLocalizedLabel } from '../utils/localizedEntityLabel';
import { AdminPinResetModal } from '../components/security/AdminPinResetModal';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import { countActiveFilters } from '../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../utils/dateRangeFilter';
import { ListPagination } from '../components/ui/ListPagination';
import { useClientPagination } from '../utils/useClientPagination';
import {
  getPortalPasswordPolicy,
  assertPortalPasswordIfProvidedZod,
  validatePortalPassword,
} from '../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../hooks/usePortalPasswordPolicy';
import { PasswordFormAutofillTrap, PasswordInput } from '../components/ui/PasswordInput';
import { PasswordRequirements } from '../components/ui/PasswordRequirements';
import {
  aoaToCsvLines,
  buildTabularMetadataAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvLines,
  exportFilename,
  type ExportFileExt,
} from '../utils/export/exportDocumentStandard';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../utils/listColumnSort';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'PENDING_ACCESS';
type RoleFilter = 'ALL' | Role | 'HR_MANAGER';

const ALL_ROLES: Role[] = [Role.ADMIN, Role.HR, Role.MANAGER, Role.EMPLOYEE];

const ROLE_BADGE: Record<
  Role,
  { variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }
> = {
  [Role.ADMIN]: { variant: 'danger', label: 'Admin' },
  [Role.HR]: { variant: 'warning', label: 'HR' },
  [Role.MANAGER]: { variant: 'info', label: 'Manager' },
  [Role.EMPLOYEE]: { variant: 'neutral', label: 'Staff' },
};

interface EmployeeProfile {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  full_name: string;
  full_name_kh?: string | null;
  email: string;
  phone: string;
  work_phone?: string | null;
  avatar_url: string | null;
  department_id: string;
  department_name: string | null;
  department_name_kh?: string | null;
  position_id: string;
  position_title: string | null;
  position_title_kh?: string | null;
  employment_type: string | null;
  work_location: string | null;
  join_date: string | null;
  status: string | null;
}

type EmployeeWithoutUser = EmployeeProfile;

// User record as returned by the backend after employee enrichment.
type EnrichedUser = UserType & {
  isActive?: boolean;
  employee?: EmployeeProfile | null;
};

type PendingPortalAccessRow = {
  kind: 'pending_access';
  employee: EmployeeWithoutUser;
};

type UserManagementRow =
  | { kind: 'user'; user: EnrichedUser }
  | PendingPortalAccessRow;

type SortableUserColumn = 'id' | 'name' | 'role' | 'department' | 'status';

// ----------------------------------------------------------------------------
// CREATE USER MODAL (from existing Employee)
// ----------------------------------------------------------------------------

const createSchemaBase = z.object({
  role: z.nativeEnum(Role),
  isActive: z.boolean().default(true),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
});

type CreateValues = z.infer<typeof createSchemaBase>;

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  initialEmployee?: EmployeeWithoutUser | null;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialEmployee = null,
}) => {
  const { showToast } = useToast();
  const { language } = useLanguage();
  usePortalPasswordPolicy();
  const [employees, setEmployees] = useState<EmployeeWithoutUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<EmployeeWithoutUser | null>(null);
  const [confirmGrantOpen, setConfirmGrantOpen] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [defaultPasswordEnabled, setDefaultPasswordEnabled] = useState(true);
  const defaultPasswordEnabledRef = useRef(true);
  const grantValuesRef = useRef<CreateValues | null>(null);

  useEffect(() => {
    defaultPasswordEnabledRef.current = defaultPasswordEnabled;
  }, [defaultPasswordEnabled]);

  const createSchema = useMemo(
    () =>
      createSchemaBase.superRefine((vals, ctx) => {
        if (defaultPasswordEnabledRef.current) return;
        const pwd = String(vals.password ?? '').trim();
        const check = validatePortalPassword(pwd);
        if (!check.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.message || 'Password is required.',
            path: ['password'],
          });
        }
        if (pwd !== String(vals.confirmPassword ?? '').trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Password and confirmation do not match.',
            path: ['confirmPassword'],
          });
        }
      }),
    []
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema) as any,
    defaultValues: {
      role: Role.EMPLOYEE,
      isActive: true,
      password: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    clearErrors(['password', 'confirmPassword']);
  }, [defaultPasswordEnabled, clearErrors]);

  const loadEmployees = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const list = (await Api.employees.getWithoutUser()) as EmployeeWithoutUser[];
      setEmployees(Array.isArray(list) ? list : []);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to load employees';
      const isNotFound = /not found|404/i.test(raw);
      const msg = isNotFound
        ? 'Endpoint /api/employees/without-user not found on the backend. Restart your backend so the new route is registered.'
        : raw;
      setLoadError(msg);
      setEmployees([]);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadDefaultPasswordStatus = useCallback(async () => {
    try {
      const status = await Api.system.getDefaultPassword();
      setDefaultPasswordEnabled(status?.enabled !== false);
    } catch {
      // Fail open so grant still works with server-side default when status is unavailable.
      setDefaultPasswordEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(initialEmployee ?? null);
    setSearch('');
    reset({
      role: Role.EMPLOYEE,
      isActive: true,
      password: '',
      confirmPassword: '',
    });
    void loadEmployees();
    void loadDefaultPasswordStatus();
  }, [isOpen, reset, loadEmployees, loadDefaultPasswordStatus, initialEmployee]);

  useEffect(() => {
    if (!isOpen || !initialEmployee || selected) return;
    const match = employees.find((e) => e.id === initialEmployee.id);
    if (match) setSelected(match);
  }, [isOpen, initialEmployee, selected, employees]);

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    return employees.filter((e) =>
      matchesEmployeeSearch(
        employeeSearchHaystack([
          e.employee_id,
          e.full_name,
          e.full_name_kh,
          e.first_name,
          e.last_name,
          e.first_name_kh,
          e.last_name_kh,
          e.email,
          e.phone,
          e.department_name,
          e.department_name_kh,
          e.position_title,
          e.position_title_kh,
        ]),
        search
      )
    );
  }, [employees, search]);

  const isActive = watch('isActive');
  const role = watch('role');

  const grantPortalAccess = async (values: CreateValues) => {
    if (!selected) {
      showToast('Please select an employee first.', 'warning');
      return;
    }
    setGrantBusy(true);
    try {
      const password = String(values.password ?? '').trim();
      await Api.users.create({
        employeeId: selected.id,
        employee_id: selected.employee_id,
        email: selected.email,
        phone: selected.phone || undefined,
        role: values.role,
        isActive: values.isActive,
        ...(password ? { password } : {}),
      } as any);
      showToast(
        `Account created for ${resolveEmployeeRecordDisplayName(selected, language)}. They must change their password on first login.`,
        'success'
      );
      setConfirmGrantOpen(false);
      grantValuesRef.current = null;
      await onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create user';
      showToast(msg, 'error');
    } finally {
      setGrantBusy(false);
    }
  };

  const passwordValue = watch('password') || '';

  const onSubmit: SubmitHandler<CreateValues> = (values) => {
    if (!selected) {
      showToast('Please select an employee first.', 'warning');
      return;
    }
    grantValuesRef.current = values;
    setConfirmGrantOpen(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        selected
          ? `Create user for ${resolveEmployeeRecordDisplayName(selected, language)}`
          : 'Create New User'
      }
      size="lg"
      description="Grant portal access and define security options for employee accounts."
    >
      {!selected ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Pick an employee who has been onboarded but doesn't have system access yet. Their
              details will autofill from the Employees table.
            </p>
          </div>

          <ListSearchFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by Employee ID, name, email, phone, department…"
          />

          <div className="max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
            {loading ? (
              <ContentSkeleton layout="list" rows={4} label="Loading employees…" />
            ) : loadError ? (
              <div className="py-10 px-4 text-center">
                <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
                <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Couldn't load employees
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {loadError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => void loadEmployees()}
                >
                  Retry
                </Button>
              </div>
            ) : employees.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Every active employee already has a user account.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Onboard a new employee first, then come back here to grant them access.
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  No employees match your search.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((emp) => (
                  <li key={emp.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(emp)}
                      className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 transition-all"
                    >
                      <EmployeeListIdentityBlock
                        data={employeeListIdentityFromEmployeeRow({
                          employee_id: emp.employee_id || emp.id,
                          first_name: emp.first_name,
                          last_name: emp.last_name,
                          first_name_kh: emp.first_name_kh,
                          last_name_kh: emp.last_name_kh,
                          full_name: emp.full_name,
                          full_name_kh: emp.full_name_kh,
                          email: emp.email,
                          phone: emp.phone,
                          avatar_url: emp.avatar_url,
                          position_title: emp.position_title,
                          position_title_kh: emp.position_title_kh,
                        })}
                        avatarClassName="h-11 w-11 shrink-0"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="hcms-modal-actions hcms-modal-actions--end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 sm:space-y-5 min-w-0 max-w-full">
          {/* Selected employee summary */}
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-900/10">
            <div className="flex items-start gap-4">
              <EmployeeAvatar
                avatarUrl={selected.avatar_url}
                firstName={selected.first_name}
                lastName={selected.last_name}
                className="w-14 h-14"
                alt={resolveEmployeeRecordDisplayName(selected, language)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-lg font-bold text-slate-900 dark:text-white">
                    {resolveEmployeeRecordDisplayName(selected, language)}
                  </p>
                  <span className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                    <IdCard className="w-3 h-3 mr-1" />
                    {selected.employee_id}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{selected.email}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selected.phone || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">
                      {resolveLocalizedLabel(
                        selected.department_name,
                        selected.department_name_kh,
                        language
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">
                      {resolveLocalizedLabel(
                        selected.position_title,
                        selected.position_title_kh,
                        language
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" /> Change
              </button>
            </div>
          </div>

          {/* Role + Active */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Access role <span className="text-red-500">*</span>
              </label>
              <select
                {...register('role')}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                {EMPLOYEE_LINKED_PORTAL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_BADGE[r].label}
                  </option>
                ))}
              </select>
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <span>Selected:</span>
                <Badge variant={ROLE_BADGE[role as Role]?.variant || 'neutral'}>
                  {ROLE_BADGE[role as Role]?.label || String(role)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                System administrators are created under Settings → Create Admin.
              </p>
            </div>

            <div className="flex items-end">
              <div className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => setValue('isActive', !isActive, { shouldDirty: true })}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
                      isActive ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    Account active
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Allow this user to sign in.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {defaultPasswordEnabled ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                The system default password will be assigned automatically.
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Share login instructions with the employee securely. They must change the password on
                first sign-in.
              </p>
            </div>
          ) : (
            <div className="relative space-y-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Default password is disabled. Set a temporary password for this new account.
              </p>
              <PasswordFormAutofillTrap />
              <PasswordInput
                purpose="new"
                label="Temporary password"
                value={passwordValue}
                onChange={(e) => setValue('password', e.target.value, { shouldValidate: true })}
                showToggle
                error={errors.password?.message}
              />
              <PasswordInput
                purpose="confirm"
                label="Confirm password"
                value={watch('confirmPassword') || ''}
                onChange={(e) =>
                  setValue('confirmPassword', e.target.value, { shouldValidate: true })
                }
                showToggle
                error={errors.confirmPassword?.message}
              />
              <PasswordRequirements password={passwordValue} />
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                They must change this password on first sign-in. Existing users are not affected.
              </p>
            </div>
          )}

          <div className="hcms-modal-actions hcms-modal-actions--end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting || grantBusy}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting} icon={<UserCheck className="w-4 h-4" />}>
              Grant access
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmGrantOpen}
        onClose={() => {
          if (grantBusy) return;
          setConfirmGrantOpen(false);
          grantValuesRef.current = null;
        }}
        title="Grant portal access?"
        description={
          selected
            ? defaultPasswordEnabled
              ? `Create a portal account for ${resolveEmployeeRecordDisplayName(selected, language)} (${selected.employee_id})? They will sign in with the system default password and must change it on first login.`
              : `Create a portal account for ${resolveEmployeeRecordDisplayName(selected, language)} (${selected.employee_id})? They will sign in with the temporary password you set and must change it on first login.`
            : ''
        }
        variant="success"
        confirmLabel="Grant access"
        confirmIcon={<UserCheck className="w-4 h-4" />}
        loading={grantBusy}
        onConfirm={async () => {
          const values = grantValuesRef.current;
          if (!values) return;
          await grantPortalAccess(values);
        }}
      />
    </Modal>
  );
};

// ----------------------------------------------------------------------------
// EDIT USER MODAL — profile, role, and Active/Inactive are read-only here.
// Admins only adjust password. Role shows in the detail summary.
// ----------------------------------------------------------------------------

const editSchema = z
  .object({
    password: z
      .string()
      .optional()
      .superRefine((val, ctx) => assertPortalPasswordIfProvidedZod(val, ctx)),
    confirmPassword: z.string().optional(),
  })
  .refine(
    (vals) => {
      if (!vals.password) return true;
      return vals.password === vals.confirmPassword;
    },
    { message: 'Passwords do not match', path: ['confirmPassword'] }
  );

type EditValues = z.infer<typeof editSchema>;

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  editingUser: EnrichedUser | null;
  viewOnly?: boolean;
}

const EditUserModal: React.FC<EditUserModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  editingUser,
  viewOnly = false,
}) => {
  const { showToast } = useToast();
  const { language } = useLanguage();
  usePortalPasswordPolicy();
  const employee = editingUser?.employee || null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema) as any,
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const accountInactive = !effectiveUserIsActive(
    editingUser?.isActive,
    employee?.status,
    editingUser?.status
  );
  const employeeInactive =
    isEmployeeInactiveForPortal(employee?.status) || isEmployeeDraftStatus(employee?.status);
  const readOnly = viewOnly;
  const displayRole = normalizeAccessRole(editingUser?.role) as Role;

  useEffect(() => {
    if (!isOpen || !editingUser) return;
    reset({
      password: '',
      confirmPassword: '',
    });
  }, [isOpen, editingUser, reset]);

  const passwordValue = watch('password') || '';

  const onSubmit: SubmitHandler<EditValues> = async (values) => {
    if (!editingUser) return;
    if (editingUser?.hasPassword === false && !String(values.password ?? '').trim()) {
      showToast('Generate a sign-in password before saving.', 'error');
      return;
    }
    if (!String(values.password ?? '').trim()) {
      showToast('Nothing to save. Generate a new password, or cancel.', 'error');
      return;
    }
    try {
      await Api.users.update({
        id: editingUser.id,
        password: values.password,
      } as any);
      showToast('User updated successfully.', 'success');
      await onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      showToast(msg, 'error');
    }
  };

  // Resolve display values — prefer Employee fields, fall back to User fields
  // for legacy accounts that have no linked Employee row (provisioned admin /
  // hr / manager / employee logins).
  const displayName = employee
    ? resolveEmployeeRecordDisplayName(employee, language)
    : userDisplayName(editingUser, language);
  const displayEmail = employee?.email || editingUser?.email || '';
  const displayPhone = employee?.phone || editingUser?.phone || '';
  const displayAvatar = employee?.avatar_url || editingUser?.avatarUrl || '';
  const displayDept = employee
    ? resolveLocalizedLabel(employee.department_name, employee.department_name_kh, language)
    : editingUser?.position || '—';
  const displayPosition = employee
    ? resolveLocalizedLabel(employee.position_title, employee.position_title_kh, language)
    : editingUser?.position || '—';
  const displayEmployeeId =
    employee?.employee_id ||
    userDisplayEmployeeCode(editingUser) ||
    null;
  const resolvedEmployeeId =
    displayEmployeeId && displayEmployeeId !== '—' ? displayEmployeeId : null;
  const isSystemAdmin =
    editingUser?.accountType === 'system' ||
    (editingUser?.role === Role.ADMIN && !editingUser?.employeeId && !employee);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        readOnly
          ? `View User — ${displayName}`
          : `Edit User — ${displayName}`
      }
      size="lg"
      description="View account details and manage sign-in password. Role and Active / Inactive are not changed here."
    >
      {accountInactive && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          <UserX className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" aria-hidden />
          <p>
            {employeeInactive ? (
              <>
                This account is <strong>Inactive</strong> because the employee is inactive or
                terminated. Restore the employee in <strong>Employees</strong> before activating
                sign-in from the list action.
              </>
            ) : (
              <>
                This account is <strong>Inactive</strong> and cannot sign in. Use the snowflake
                action on the user list to set status back to <strong>Active</strong>.
              </>
            )}
          </p>
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 sm:space-y-5 min-w-0 max-w-full">
        {/* Read-only employee summary */}
        <div className="p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 min-w-0">
          <div className="flex items-start gap-4">
            <EmployeeAvatar
              avatarUrl={displayAvatar}
              firstName={
                employee?.first_name ??
                editingUser?.firstName ??
                displayName.split(/\s+/).slice(1).join(' ')
              }
              lastName={
                employee?.last_name ??
                editingUser?.lastName ??
                displayName.split(/\s+/)[0]
              }
              className="w-14 h-14"
              alt={displayName}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-bold text-slate-900 dark:text-white">
                  {displayName}
                </p>
                {resolvedEmployeeId && (
                  <span
                    className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                    title={isSystemAdmin ? 'Admin ID' : 'Employee ID'}
                  >
                    <IdCard className="w-3 h-3 mr-1" />
                    {isSystemAdmin ? `Admin ID ${resolvedEmployeeId}` : resolvedEmployeeId}
                  </span>
                )}
                <Badge variant={ROLE_BADGE[displayRole]?.variant || 'neutral'}>
                  {ROLE_BADGE[displayRole]?.label || String(editingUser?.role || '—')}
                </Badge>
                <Badge
                  variant={accountInactive ? 'neutral' : 'success'}
                  className="inline-flex items-center"
                >
                  {accountInactive ? (
                    <>
                      <UserX className="w-3 h-3 mr-1" /> Inactive
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-3 h-3 mr-1" /> Active
                    </>
                  )}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{displayEmail || '—'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{displayPhone || '—'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{displayDept}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{displayPosition}</span>
                </div>
              </div>
              {isSystemAdmin ? (
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  System administrator — not an employee. Created in Settings → Create Admin.
                </p>
              ) : employee ? (
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Profile fields are sourced from the Employees module. Edit them in the
                  employee record to keep both views in sync.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {!readOnly && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-slate-500" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              {editingUser?.hasPassword === false ? 'Set sign-in password' : 'Reset password (optional)'}
            </h4>
          </div>
          {editingUser?.hasPassword === false && (
            <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-2">
              Portal login is enabled but no password is set yet. Generate a password below and save so this user can sign in with their phone number.
            </p>
          )}
          <input type="hidden" {...register('password')} />
          <input type="hidden" {...register('confirmPassword')} />
          <GeneratedPasswordField
            password={passwordValue}
            onPasswordChange={(pwd) => {
              setValue('password', pwd, { shouldValidate: true, shouldDirty: true });
              setValue('confirmPassword', pwd, { shouldValidate: true, shouldDirty: true });
            }}
            showExistingPasswordMask={editingUser?.hasPassword !== false}
            optional={editingUser?.hasPassword !== false}
            error={errors.password?.message || errors.confirmPassword?.message}
            fieldLabel={
              passwordValue.trim().length >= getPortalPasswordPolicy().minLength ? 'New password' : 'Password'
            }
            generateLabel={
              editingUser?.hasPassword === false ? 'Generate password' : 'Generate new password'
            }
            existingHint={
              editingUser?.hasPassword === false
                ? 'No sign-in password on this account yet. Generate one and save.'
                : 'A password is already set on this account. Generate a new one to reset it.'
            }
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Setting a new password invalidates this user&apos;s current sessions. They must sign in
            with the generated password and choose their own password before continuing.
          </p>
        </div>
        )}

        <div className="hcms-modal-actions hcms-modal-actions--end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" isLoading={isSubmitting}>
              Save changes
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
};

// ----------------------------------------------------------------------------
// MAIN PAGE
// ----------------------------------------------------------------------------

type UserManagementShell = {
  users: EnrichedUser[];
  employeesWithoutUser: EmployeeWithoutUser[];
  departments: Department[];
  searchQuery: string;
  roleFilter: RoleFilter;
  statusFilter: StatusFilter;
  joinDateRange: typeof EMPTY_DATE_RANGE;
};

const userManagementShellCache = createWorkspaceShellCache<UserManagementShell>();

export const UserManagement: React.FC = () => {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { user: currentUser } = useAuth();
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const shell = userManagementShellCache.get();
  const [users, setUsers] = useState<EnrichedUser[]>(() => shell?.users ?? []);
  const [employeesWithoutUser, setEmployeesWithoutUser] = useState<EmployeeWithoutUser[]>(
    () => shell?.employeesWithoutUser ?? []
  );
  const [departments, setDepartments] = useState<Department[]>(() => shell?.departments ?? []);
  const [loading, setLoading] = useState(() => !(shell?.users && shell.users.length > 0));
  const [searchQuery, setSearchQuery] = useState(() => shell?.searchQuery ?? '');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(() => shell?.roleFilter ?? 'ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const cached = String(shell?.statusFilter ?? 'ALL');
    // Legacy "Frozen" filter maps to Inactive.
    if (cached === 'FROZEN') return 'INACTIVE';
    if (cached === 'ACTIVE' || cached === 'INACTIVE' || cached === 'PENDING_ACCESS') {
      return cached;
    }
    return 'ALL';
  });
  const [joinDateRange, setJoinDateRange] = useState(
    () => shell?.joinDateRange ?? EMPTY_DATE_RANGE
  );
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortableUserColumn>();

  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialEmployee, setCreateInitialEmployee] = useState<EmployeeWithoutUser | null>(null);
  const [editingUser, setEditingUser] = useState<EnrichedUser | null>(null);
  const [viewOnlyUser, setViewOnlyUser] = useState(false);

  const [statusTarget, setStatusTarget] = useState<{
    user: EnrichedUser;
    action: 'deactivate' | 'activate';
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pinResetTarget, setPinResetTarget] = useState<EnrichedUser | null>(null);

  const canResetPinFor = useCallback(
    (u: EnrichedUser) =>
      isPinMandatoryRole(u.role) &&
      String(u.id) !== String(currentUser?.id ?? '') &&
      effectiveUserIsActive(u.isActive, u.employee?.status, u.status),
    [currentUser?.id]
  );

  /** Deactivate any other portal user; never your own account. */
  const canDeactivateUser = useCallback(
    (u: EnrichedUser) =>
      Boolean(currentUser?.id) &&
      String(u.id) !== String(currentUser?.id ?? '') &&
      effectiveUserIsActive(u.isActive, u.employee?.status, u.status),
    [currentUser?.id]
  );

  /** Activate Inactive accounts when the linked employee (if any) allows portal access. */
  const canActivateUser = useCallback(
    (u: EnrichedUser) => {
      if (!currentUser?.id || String(u.id) === String(currentUser.id)) return false;
      if (effectiveUserIsActive(u.isActive, u.employee?.status, u.status)) return false;
      if (
        isEmployeeInactiveForPortal(u.employee?.status) ||
        isEmployeeDraftStatus(u.employee?.status)
      ) {
        return false;
      }
      return true;
    },
    [currentUser?.id]
  );

  const tabCache = useWorkspaceTabCache<{
    users: EnrichedUser[];
    employeesWithoutUser: EmployeeWithoutUser[];
    departments: Department[];
    searchQuery: string;
    roleFilter: RoleFilter;
    statusFilter: StatusFilter;
    joinDateRange: typeof EMPTY_DATE_RANGE;
  }>({
    slot: 'user-management-v1',
    getSnapshot: () => ({
      users,
      employeesWithoutUser,
      departments,
      searchQuery,
      roleFilter,
      statusFilter,
      joinDateRange,
    }),
    applySnapshot: (cached) => {
      setUsers(cached.users);
      setEmployeesWithoutUser(cached.employeesWithoutUser);
      setDepartments(cached.departments);
      setSearchQuery(cached.searchQuery);
      setRoleFilter(cached.roleFilter);
      setStatusFilter(cached.statusFilter);
      setJoinDateRange(cached.joinDateRange);
      setLoading(false);
      userManagementShellCache.set(cached);
    },
    shouldPersist: (cached) => cached.users.length > 0,
    persistDeps: [
      users,
      employeesWithoutUser,
      departments,
      searchQuery,
      roleFilter,
      statusFilter,
      joinDateRange,
    ],
  });

  const loadAll = useCallback(async (opts?: WorkspaceLoadOptions) => {
    const hasRows = (userManagementShellCache.get()?.users.length ?? 0) > 0;
    const background = Boolean(opts?.background || hasRows);
    try {
      if (!background) setLoading(true);
      const [u, d] = await Promise.all([Api.users.getAll(), Api.departments.getAll()]);
      const nextUsers = Array.isArray(u) ? (u as EnrichedUser[]) : [];
      const nextDepartments = Array.isArray(d) ? (d as Department[]) : [];
      setUsers(nextUsers);
      setDepartments(nextDepartments);
      let nextWithout: EmployeeWithoutUser[] = [];
      try {
        const without = await Api.employees.getWithoutUser();
        nextWithout = Array.isArray(without) ? (without as EmployeeWithoutUser[]) : [];
        setEmployeesWithoutUser(nextWithout);
      } catch (withoutErr) {
        console.warn('Could not load employees without user accounts:', withoutErr);
        setEmployeesWithoutUser([]);
      }
      const prev = userManagementShellCache.get();
      userManagementShellCache.set({
        users: nextUsers,
        employeesWithoutUser: nextWithout,
        departments: nextDepartments,
        searchQuery: prev?.searchQuery ?? '',
        roleFilter: prev?.roleFilter ?? 'ALL',
        statusFilter: prev?.statusFilter ?? 'ALL',
        joinDateRange: prev?.joinDateRange ?? EMPTY_DATE_RANGE,
      });
    } catch (e) {
      if (!background) {
        const msg = e instanceof Error ? e.message : 'Failed to load users';
        showToastRef.current(msg, 'error');
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  // Keep shell filters in sync so remounts restore search/filter UI.
  useEffect(() => {
    const prev = userManagementShellCache.get();
    if (!prev?.users.length) return;
    userManagementShellCache.set({
      ...prev,
      searchQuery,
      roleFilter,
      statusFilter,
      joinDateRange,
    });
  }, [searchQuery, roleFilter, statusFilter, joinDateRange]);

  useWorkspaceTabMountLoad(loadAll, [loadAll], tabCache);

  useRegisterPullToRefresh(
    useCallback(() => loadAll({ background: true }), [loadAll])
  );


  const departmentName = useCallback(
    (id?: string) => {
      if (!id) return '—';
      const dept = departments.find((d) => d.id === id);
      if (!dept) return '—';
      return resolveLocalizedLabel(dept.name, dept.nameKh, language);
    },
    [departments, language]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const userRows: UserManagementRow[] = users.map((u) => ({ kind: 'user', user: u }));
    const pendingRows: UserManagementRow[] = employeesWithoutUser.map((employee) => ({
      kind: 'pending_access',
      employee,
    }));
    return [...userRows, ...pendingRows].filter((row) => {
      const joinDate =
        row.kind === 'user' ? row.user.employee?.join_date ?? null : row.employee.join_date;
      if (!recordMatchesDateRange(joinDate, joinDateRange)) return false;

      if (row.kind === 'pending_access') {
        if (statusFilter === 'PENDING_ACCESS') {
          /* show only pending-access rows */
        } else if (roleFilter !== 'ALL' || statusFilter !== 'ALL') {
          return false;
        }
        if (!q) return true;
        const emp = row.employee;
        return matchesEmployeeSearch(
          employeeSearchHaystack([
            emp.full_name,
            emp.full_name_kh,
            emp.first_name,
            emp.last_name,
            emp.first_name_kh,
            emp.last_name_kh,
            emp.email,
            emp.phone,
            emp.work_phone,
            emp.position_title,
            emp.position_title_kh,
            emp.department_name,
            emp.department_name_kh,
            emp.employee_id,
            'no portal access',
          ]),
          searchQuery
        );
      }

      if (statusFilter === 'PENDING_ACCESS') return false;

      const u = row.user;
      if (q) {
        const emp = u.employee;
        if (
          !matchesEmployeeSearch(
            employeeSearchHaystack([
              emp?.full_name,
              emp?.full_name_kh,
              emp?.first_name,
              emp?.last_name,
              emp?.first_name_kh,
              emp?.last_name_kh,
              emp?.email,
              emp?.phone,
              emp?.work_phone,
              emp?.position_title,
              emp?.position_title_kh,
              emp?.department_name,
              emp?.department_name_kh,
              emp?.employee_id,
              u.name,
              u.email,
              u.phone,
              u.position,
              u.employeeId,
              u.displayEmployeeId,
              u.loginId,
              userDisplayEmployeeCode(u),
            ]),
            searchQuery
          )
        ) {
          return false;
        }
      }
      if (roleFilter === 'HR_MANAGER') {
        const r = String(u.role || '').toUpperCase();
        if (r !== 'HR' && r !== 'MANAGER') return false;
      } else if (roleFilter !== 'ALL' && String(u.role).toUpperCase() !== roleFilter) {
        return false;
      }
      if (statusFilter !== 'ALL' && statusFilter !== 'PENDING_ACCESS') {
        const active = effectiveUserIsActive(u.isActive, u.employee?.status, u.status);
        if (statusFilter === 'ACTIVE' && !active) return false;
        if (statusFilter === 'INACTIVE' && active) return false;
      }
      return true;
    });
  }, [users, employeesWithoutUser, searchQuery, roleFilter, statusFilter, joinDateRange]);

  const rowSortValue = useCallback(
    (row: UserManagementRow, col: SortableUserColumn): string => {
      if (col === 'id') {
        if (row.kind === 'pending_access') {
          return String(row.employee.employee_id || row.employee.id || '').toLowerCase();
        }
        return userDisplayEmployeeCode(row.user).toLowerCase();
      }
      if (col === 'name') {
        if (row.kind === 'pending_access') {
          return resolveEmployeeRecordDisplayName(row.employee as any).toLowerCase();
        }
        return userDisplayName(row.user).toLowerCase();
      }
      if (col === 'role') {
        if (row.kind === 'pending_access') return 'not assigned';
        const key = normalizeAccessRole(row.user.role) as Role;
        return (ROLE_BADGE[key]?.label || String(row.user.role || '')).toLowerCase();
      }
      if (col === 'department') {
        if (row.kind === 'pending_access') {
          return resolveLocalizedLabel(
            row.employee.department_name,
            row.employee.department_name_kh,
            language
          ).toLowerCase();
        }
        const emp = row.user.employee;
        const name = emp
          ? resolveLocalizedLabel(emp.department_name, emp.department_name_kh, language)
          : departmentName(row.user.departmentId);
        return (name === '—' ? '' : name).toLowerCase();
      }
      if (col === 'status') {
        if (row.kind === 'pending_access') return 'no access';
        const active = effectiveUserIsActive(
          row.user.isActive,
          row.user.employee?.status,
          row.user.status
        );
        return active ? 'active' : 'inactive';
      }
      return '';
    },
    [departmentName, language]
  );

  const sortedFilteredRows = useMemo(
    () => sortRowsByColumn(filteredRows, sortBy, sortOrder, rowSortValue),
    [filteredRows, rowSortValue, sortBy, sortOrder]
  );

  const userTableThClass =
    'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider';

  const userListFilterKey = `${searchQuery}|${roleFilter}|${statusFilter}|${joinDateRange.from}|${joinDateRange.to}`;
  const {
    pageItems: pagedRows,
    currentPage,
    setCurrentPage,
    totalCount: filteredCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(sortedFilteredRows, undefined, userListFilterKey);

  const userFilterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: roleFilter, defaultValue: 'ALL' },
        { value: statusFilter, defaultValue: 'ALL' },
      ]) + countDateRangeFilters(joinDateRange),
    [roleFilter, statusFilter, joinDateRange]
  );

  const clearUserFilters = useCallback(() => {
    setSearchQuery('');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setJoinDateRange(EMPTY_DATE_RANGE);
    resetSort();
  }, []);

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      const rows = sortedFilteredRows.map((row) => {
        if (row.kind === 'pending_access') {
          return [
            row.employee.employee_id || row.employee.id,
            resolveEmployeeRecordDisplayName(row.employee as any),
            row.employee.email || '',
            row.employee.phone || row.employee.work_phone || '',
            departmentName(row.employee.department_id),
            resolveLocalizedLabel(
              row.employee.position_title,
              row.employee.position_title_kh,
              language
            ),
            'No portal access',
            'Pending access',
          ];
        }
        const active = effectiveUserIsActive(row.user.isActive, row.user.employee?.status, row.user.status);
        return [
          userDisplayEmployeeCode(row.user),
          userDisplayName(row.user),
          row.user.email || row.user.employee?.email || '',
          row.user.phone || row.user.employee?.phone || '',
          departmentName(row.user.employee?.department_id),
          resolveLocalizedLabel(
            row.user.employee?.position_title,
            row.user.employee?.position_title_kh,
            language
          ),
          ROLE_BADGE[normalizeAccessRole(row.user.role) as Role]?.label || String(row.user.role || ''),
          active ? 'Active' : 'Inactive',
        ];
      });
      const headers = ['Employee ID', 'User', 'Email', 'Phone', 'Department', 'Position', 'Role', 'Status'];
      const metadata = buildTabularMetadataAoa('User Management List', [
        { label: 'Visible rows', value: String(rows.length) },
        { label: 'Search', value: searchQuery || 'All users' },
      ]);
      const aoa = [...metadata, headers, ...rows];
      const filename = exportFilename('User_Management', [new Date().toISOString().slice(0, 10)], format);
      if (format === 'csv') {
        downloadCsvLines(aoaToCsvLines(aoa), filename);
        return;
      }
      await downloadBrandedWorkbookAsXlsx({
        filename,
        reportTitle: 'User Management List',
        fields: [
          { label: 'Document', value: 'User Management List' },
          { label: 'Visible rows', value: String(rows.length) },
          { label: 'Search', value: searchQuery || 'All users' },
          { label: 'Prepared by', value: '' },
        ],
        purpose: 'Portal user accounts visible under the current filters.',
        sheets: [
          {
            name: 'Users',
            aoa,
            headerRows: [metadata.length],
            columnWidths: [16, 24, 28, 16, 22, 22, 14, 14],
          },
        ],
      });
    },
    [departmentName, sortedFilteredRows, language, searchQuery]
  );

  const stats = useMemo(() => {
    const totals: Record<string, number> = {
      total: users.length,
      active: 0,
      admins: 0,
      hrManagers: 0,
      pendingAccess: employeesWithoutUser.length,
    };
    for (const u of users) {
      if (u.isActive !== false) totals.active++;
      const r = String(u.role || '').toUpperCase();
      if (r === 'ADMIN') totals.admins++;
      if (r === 'HR' || r === 'MANAGER') totals.hrManagers++;
    }
    return totals;
  }, [users, employeesWithoutUser]);

  const handleStatusChange = async () => {
    if (!statusTarget) return;
    const { user, action } = statusTarget;
    if (action === 'deactivate' && !canDeactivateUser(user)) {
      showToast("You can't deactivate your own account.", 'error');
      setStatusTarget(null);
      return;
    }
    if (action === 'activate' && !canActivateUser(user)) {
      showToast('This account cannot be activated from here.', 'error');
      setStatusTarget(null);
      return;
    }
    try {
      setStatusBusy(true);
      if (action === 'deactivate') {
        await Api.users.freeze(user.id);
        showToast(`${user.name} set to Inactive. They cannot sign in.`, 'success');
      } else {
        await Api.users.unfreeze(user.id);
        showToast(`${user.name} set to Active. They can sign in again.`, 'success');
      }
      setStatusTarget(null);
      await loadAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Status update failed';
      showToast(msg, 'error');
    } finally {
      setStatusBusy(false);
    }
  };

  const openEdit = (u: EnrichedUser) => {
    setViewOnlyUser(false);
    setEditingUser(u);
  };

  const openView = (u: EnrichedUser) => {
    setViewOnlyUser(true);
    setEditingUser(u);
  };

  const closeUserModal = () => {
    setEditingUser(null);
    setViewOnlyUser(false);
  };

  const renderRoleBadge = (role: Role | string) => {
    const key = normalizeAccessRole(role);
    const cfg = ROLE_BADGE[key] || ROLE_BADGE[Role.EMPLOYEE];
    return (
      <Badge variant={cfg.variant} className="shadow-sm">
        {cfg.variant === 'danger' && <Shield className="w-3 h-3 mr-1 inline" />}
        {cfg.label}
      </Badge>
    );
  };

  return (
    <PageShell>
      <CreateUserModal
        isOpen={createOpen}
        initialEmployee={createInitialEmployee}
        onClose={() => {
          setCreateOpen(false);
          setCreateInitialEmployee(null);
        }}
        onSaved={loadAll}
      />

      <AdminPinResetModal
        isOpen={!!pinResetTarget}
        targetUserId={pinResetTarget?.id ?? ''}
        targetName={
          pinResetTarget
            ? pinResetTarget.employee
              ? resolveEmployeeRecordDisplayName(pinResetTarget.employee, language)
              : userDisplayName(pinResetTarget, language)
            : 'User'
        }
        onClose={() => setPinResetTarget(null)}
        onSuccess={loadAll}
      />

      <EditUserModal
        isOpen={!!editingUser}
        onClose={closeUserModal}
        onSaved={loadAll}
        editingUser={editingUser}
        viewOnly={viewOnlyUser}
      />

      <ConfirmDialog
        open={!!statusTarget}
        onClose={() => !statusBusy && setStatusTarget(null)}
        title={statusTarget?.action === 'activate' ? 'Set Active' : 'Set Inactive'}
        description={
          statusTarget
            ? statusTarget.action === 'activate'
              ? `Set ${statusTarget.user.name} (${statusTarget.user.email}) to Active? They will be able to sign in again.`
              : `Set ${statusTarget.user.name} (${statusTarget.user.email}) to Inactive? They cannot sign in until activated again.`
            : ''
        }
        variant={statusTarget?.action === 'activate' ? 'success' : 'danger'}
        confirmLabel={statusTarget?.action === 'activate' ? 'Set Active' : 'Set Inactive'}
        loading={statusBusy}
        onConfirm={handleStatusChange}
      />

      <div className="flex flex-col xs:flex-row justify-between items-stretch xs:items-center gap-2.5 sm:gap-3">
        {/* Title lives in LayoutPageHeader — avoid duplicating it on phones. */}
        <div className="hidden lg:block min-w-0">
          <h1 className="text-2xl xl:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t('users.title') || 'User Management'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('users.subtitle') || 'Manage system access and user roles'}
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateInitialEmployee(null);
            setCreateOpen(true);
          }}
          icon={<Plus className="w-4 h-4" />}
          className="w-full xs:w-auto xs:ml-auto shrink-0"
        >
          {t('users.addUser') || 'Add User'}
        </Button>
      </div>

      <div className="stat-card-grid-5">
        {[
          {
            key: 'total',
            label: 'Total users',
            value: stats.total,
            valueClass: 'text-slate-900 dark:text-white',
            active: roleFilter === 'ALL' && statusFilter === 'ALL',
            onClick: () => {
              setRoleFilter('ALL');
              setStatusFilter('ALL');
            },
          },
          {
            key: 'active',
            label: 'Active',
            value: stats.active,
            valueClass: 'text-emerald-600 dark:text-emerald-400',
            active: statusFilter === 'ACTIVE' && roleFilter === 'ALL',
            onClick: () => {
              setRoleFilter('ALL');
              setStatusFilter((prev) => (prev === 'ACTIVE' ? 'ALL' : 'ACTIVE'));
            },
          },
          {
            key: 'admins',
            label: 'Admins',
            value: stats.admins,
            valueClass: 'text-red-600 dark:text-red-400',
            active: roleFilter === Role.ADMIN && statusFilter === 'ALL',
            onClick: () => {
              setStatusFilter('ALL');
              setRoleFilter((prev) => (prev === Role.ADMIN ? 'ALL' : Role.ADMIN));
            },
          },
          {
            key: 'hr',
            label: 'HR / Managers',
            value: stats.hrManagers,
            valueClass: 'text-amber-600 dark:text-amber-400',
            active: roleFilter === 'HR_MANAGER' && statusFilter === 'ALL',
            onClick: () => {
              setStatusFilter('ALL');
              setRoleFilter((prev) => (prev === 'HR_MANAGER' ? 'ALL' : 'HR_MANAGER'));
            },
          },
          {
            key: 'pending',
            label: 'No portal access',
            value: stats.pendingAccess,
            valueClass: 'text-blue-600 dark:text-blue-400',
            active: statusFilter === 'PENDING_ACCESS',
            onClick: () => {
              setRoleFilter('ALL');
              setStatusFilter((prev) => (prev === 'PENDING_ACCESS' ? 'ALL' : 'PENDING_ACCESS'));
            },
            span: true,
          },
        ].map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            aria-pressed={card.active}
            className={`rounded-xl sm:rounded-2xl bg-white dark:bg-slate-800 border p-3 sm:p-5 text-left transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              card.active
                ? 'border-primary-400/60 ring-2 ring-primary-500 shadow-md'
                : 'border-slate-200 dark:border-slate-700'
            } ${card.span ? 'max-sm:col-span-2' : ''}`}
          >
            <p className="text-[10px] sm:text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p className={`text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1 tabular-nums ${card.valueClass}`}>
              {card.value}
            </p>
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-3 sm:p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
          <ListSearchFilterBar
            leading={
              <ExportFormatMenu
                formats={['csv', 'xlsx']}
                disabled={loading || filteredCount === 0}
                onExport={handleExport}
              />
            }
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder={
              t('users.searchPlaceholder') ||
              'Search by Employee ID, Admin ID, name, email, phone…'
            }
            filter={
              <PageFilterMenu activeCount={userFilterActiveCount} onClear={clearUserFilters}>
            <FilterMenuDateRange
              from={joinDateRange.from}
              to={joinDateRange.to}
              onChange={setJoinDateRange}
              fromLabel="Joined from"
              toLabel="Joined to"
            />
            <FilterMenuSelect
              label="Role"
              value={roleFilter === 'HR_MANAGER' ? 'ALL' : roleFilter}
              onChange={(v) => setRoleFilter(v as RoleFilter)}
              options={[
                { value: 'ALL', label: 'All roles' },
                ...ALL_ROLES.map((r) => ({
                  value: r,
                  label: ROLE_BADGE[r].label,
                })),
              ]}
            />
            <FilterMenuSelect
              label="Status"
              value={statusFilter === 'PENDING_ACCESS' ? 'ALL' : statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          </PageFilterMenu>
            }
          />
        </div>

        {loading && users.length === 0 ? (
          <ContentSkeleton layout="list" label="Loading users…" />
        ) : filteredCount === 0 ? (
          <div className="hcms-empty-state">
            <p className="text-slate-700 dark:text-slate-300 font-medium">
                No users or pending-access employees match your filters.
            </p>
            <button
              type="button"
              onClick={clearUserFilters}
              className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
              {pagedRows.map((row) => {
                if (row.kind === 'pending_access') {
                  const emp = row.employee;
                  const identity = employeeListIdentityFromEmployeeRow({
                    employee_id: emp.employee_id || emp.id,
                    first_name: emp.first_name,
                    last_name: emp.last_name,
                    first_name_kh: emp.first_name_kh,
                    last_name_kh: emp.last_name_kh,
                    full_name: emp.full_name,
                    full_name_kh: emp.full_name_kh,
                    email: emp.email,
                    phone: emp.phone,
                    avatar_url: emp.avatar_url,
                    position_title: emp.position_title,
                    position_title_kh: emp.position_title_kh,
                  });
                  return (
                    <div key={`pending-${emp.id}`} className="p-3 space-y-2.5 bg-blue-50/50 dark:bg-blue-950/10">
                      <div className="flex items-start justify-between gap-2">
                        <EmployeeListIdentityBlock
                          className="flex-1 min-w-0"
                          data={identity}
                          compactOnMobile
                          showSubtitle
                        />
                        <ResponsiveRowActions
                          mode="menu"
                          menuLabel="User actions"
                          actions={[
                            {
                              key: 'create-access',
                              label: 'Create portal access',
                              icon: <Plus className="w-4 h-4" />,
                              onClick: () => {
                                setCreateInitialEmployee(emp);
                                setCreateOpen(true);
                              },
                            },
                          ]}
                        />
                      </div>
                      <Badge variant="info" className="text-[10px]">
                        No portal access
                      </Badge>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Role</dt>
                          <dd className="mt-0.5"><Badge variant="neutral">Not assigned</Badge></dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</dt>
                          <dd className="mt-0.5">
                            <Badge variant="warning" className="inline-flex items-center">
                              <UserX className="w-3 h-3 mr-1" /> No access
                            </Badge>
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Department</dt>
                          <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200">
                            {resolveLocalizedLabel(emp.department_name, emp.department_name_kh, language)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                }

                const u = row.user;
                const isCurrent = currentUser?.id === u.id;
                const emp = u.employee || null;
                const identity = employeeListIdentityFromUser(u);
                const isSystemAdmin = u.accountType === 'system';
                const displayDept = emp
                  ? resolveLocalizedLabel(emp.department_name, emp.department_name_kh, language)
                  : departmentName(u.departmentId);
                const active = effectiveUserIsActive(u.isActive, u.employee?.status, u.status);
                const employeeBlocked =
                  isEmployeeInactiveForPortal(u.employee?.status) ||
                  isEmployeeDraftStatus(u.employee?.status);
                return (
                  <div
                    key={u.id}
                    className={`p-3 space-y-2.5 ${
                      !active ? 'bg-slate-100/90 dark:bg-slate-900/70' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <EmployeeListIdentityBlock
                        className="flex-1 min-w-0"
                        data={identity}
                        compactOnMobile
                        showSubtitle
                        nameExtra={
                          <>
                            {isSystemAdmin && (
                              <Badge variant="danger" className="text-[10px]">
                                System
                              </Badge>
                            )}
                            {isCurrent && (
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                                (you)
                              </span>
                            )}
                          </>
                        }
                      />
                      <ResponsiveRowActions
                        mode="menu"
                        menuLabel="User actions"
                        actions={[
                          {
                            key: 'edit',
                            label: 'Edit user',
                            icon: <Edit className="w-4 h-4" />,
                            onClick: () => openEdit(u),
                          },
                          ...(employeeBlocked
                            ? [
                                {
                                  key: 'view',
                                  label: 'View inactive account',
                                  icon: <FileText className="w-4 h-4" />,
                                  onClick: () => openView(u),
                                },
                              ]
                            : []),
                          ...(canResetPinFor(u)
                            ? [
                                {
                                  key: 'reset-pin',
                                  label: 'Reset security PIN',
                                  icon: <Lock className="w-4 h-4" />,
                                  onClick: () => setPinResetTarget(u),
                                },
                              ]
                            : []),
                          ...(canDeactivateUser(u)
                            ? [
                                {
                                  key: 'deactivate',
                                  label: 'Set Inactive',
                                  icon: <Snowflake className="w-4 h-4" />,
                                  onClick: () =>
                                    setStatusTarget({ user: u, action: 'deactivate' }),
                                },
                              ]
                            : []),
                          ...(canActivateUser(u)
                            ? [
                                {
                                  key: 'activate',
                                  label: 'Set Active',
                                  icon: <Snowflake className="w-4 h-4" />,
                                  onClick: () =>
                                    setStatusTarget({ user: u, action: 'activate' }),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                    {active && u.hasPassword === false ? (
                      <Badge variant="warning" className="text-[10px]">
                        Password required
                      </Badge>
                    ) : null}
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">ID</dt>
                        <dd className="mt-0.5 font-mono text-slate-700 dark:text-slate-200 break-all">{identity.employeeId}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Role</dt>
                        <dd className="mt-0.5">{renderRoleBadge(u.role)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</dt>
                        <dd className="mt-0.5">
                          <Badge
                            variant={active ? 'success' : 'neutral'}
                            className="inline-flex items-center"
                          >
                            {active ? (
                              <><UserCheck className="w-3 h-3 mr-1" /> Active</>
                            ) : (
                              <><UserX className="w-3 h-3 mr-1" /> Inactive</>
                            )}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Department</dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200">{displayDept}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

          <div className="hidden lg:block hcms-table-scroll">
            <table className="w-full text-sm text-left">
              <thead className="text-xs font-semibold text-slate-500 uppercase bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <SortableTableHeader
                    label={t('users.table.id') || 'Employee / Admin ID'}
                    column="id"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={userTableThClass}
                  />
                  <SortableTableHeader
                    label={t('users.table.user') || 'Employee'}
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={userTableThClass}
                  />
                  <SortableTableHeader
                    label="Role"
                    column="role"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={userTableThClass}
                  />
                  <SortableTableHeader
                    label="Department"
                    column="department"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={userTableThClass}
                  />
                  <SortableTableHeader
                    label="Status"
                    column="status"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={userTableThClass}
                  />
                  <th className={`${userTableThClass} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedRows.map((row) => {
                  if (row.kind === 'pending_access') {
                    const emp = row.employee;
                    return (
                      <tr
                        key={`pending-${emp.id}`}
                        className="bg-blue-50/50 dark:bg-blue-950/10 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                      >
                        <EmployeeListIdentityCells
                          data={employeeListIdentityFromEmployeeRow({
                            employee_id: emp.employee_id || emp.id,
                            first_name: emp.first_name,
                            last_name: emp.last_name,
                            first_name_kh: emp.first_name_kh,
                            last_name_kh: emp.last_name_kh,
                            full_name: emp.full_name,
                            full_name_kh: emp.full_name_kh,
                            email: emp.email,
                            phone: emp.phone,
                            avatar_url: emp.avatar_url,
                            position_title: emp.position_title,
                            position_title_kh: emp.position_title_kh,
                          })}
                          idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2"
                          nameExtra={
                            <Badge variant="info" className="text-[10px]">
                              No portal access
                            </Badge>
                          }
                          showSubtitle
                        />
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <Badge variant="neutral">Not assigned</Badge>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <div className="flex items-center text-slate-600 dark:text-slate-300 text-xs">
                            <Building className="w-3.5 h-3.5 mr-2 text-slate-400" />
                            {resolveLocalizedLabel(
                              emp.department_name,
                              emp.department_name_kh,
                              language
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <Badge variant="warning" className="inline-flex items-center">
                            <UserX className="w-3 h-3 mr-1" /> No access
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                          <ResponsiveRowActions
                            menuLabel="User actions"
                            actions={[
                              {
                                key: 'create-access',
                                label: 'Create portal access',
                                icon: <Plus className="w-4 h-4" />,
                                onClick: () => {
                                  setCreateInitialEmployee(emp);
                                  setCreateOpen(true);
                                },
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  }

                  const u = row.user;
                  const isCurrent = currentUser?.id === u.id;
                  const emp = u.employee || null;
                  const identity = employeeListIdentityFromUser(u);
                  const isSystemAdmin = u.accountType === 'system';
                  const displayDept = emp
                    ? resolveLocalizedLabel(
                        emp.department_name,
                        emp.department_name_kh,
                        language
                      )
                    : departmentName(u.departmentId);
                  const active = effectiveUserIsActive(
                    u.isActive,
                    u.employee?.status,
                    u.status
                  );
                  const employeeBlocked =
                    isEmployeeInactiveForPortal(u.employee?.status) ||
                    isEmployeeDraftStatus(u.employee?.status);
                  return (
                    <tr
                      key={u.id}
                      className={
                        !active
                          ? 'bg-slate-100/90 dark:bg-slate-900/70 text-slate-500 dark:text-slate-400'
                          : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group'
                      }
                    >
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        <span className="block truncate" title={identity.employeeId}>
                          {identity.employeeId}
                        </span>
                        {isSystemAdmin && identity.employeeId !== '—' ? (
                          <span className="mt-0.5 block text-[10px] font-sans font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                            Admin ID
                          </span>
                        ) : null}
                      </td>
                      <EmployeeListIdentityCell
                        data={identity}
                        className="px-2 py-1.5 sm:px-3 sm:py-2"
                        nameExtra={
                          <>
                            {isSystemAdmin && (
                              <Badge variant="danger" className="text-[10px]">
                                System
                              </Badge>
                            )}
                            {isCurrent && (
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                                (you)
                              </span>
                            )}
                            {active && u.hasPassword === false && (
                              <Badge variant="warning" className="text-[10px]">
                                Password required
                              </Badge>
                            )}
                          </>
                        }
                        showSubtitle
                      />
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        {renderRoleBadge(u.role)}
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        <div className="flex items-center text-slate-600 dark:text-slate-300 text-xs">
                          <Building className="w-3.5 h-3.5 mr-2 text-slate-400" />
                          {displayDept}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                        <Badge
                          variant={active ? 'success' : 'neutral'}
                          className="inline-flex items-center"
                        >
                          {active ? (
                            <>
                              <UserCheck className="w-3 h-3 mr-1" /> Active
                            </>
                          ) : (
                            <>
                              <UserX className="w-3 h-3 mr-1" /> Inactive
                            </>
                          )}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                        <ResponsiveRowActions
                          menuLabel="User actions"
                          actions={[
                            {
                              key: 'edit',
                              label: 'Edit user',
                              icon: <Edit className="w-4 h-4" />,
                              onClick: () => openEdit(u),
                            },
                            ...(employeeBlocked
                              ? [
                                  {
                                    key: 'view',
                                    label: 'View inactive account',
                                    icon: <FileText className="w-4 h-4" />,
                                    onClick: () => openView(u),
                                  },
                                ]
                              : []),
                            ...(canResetPinFor(u)
                              ? [
                                  {
                                    key: 'reset-pin',
                                    label: 'Reset security PIN',
                                    icon: <Lock className="w-4 h-4" />,
                                    onClick: () => setPinResetTarget(u),
                                  },
                                ]
                              : []),
                            ...(canDeactivateUser(u)
                              ? [
                                  {
                                    key: 'deactivate',
                                    label: 'Set Inactive',
                                    icon: <Snowflake className="w-4 h-4" />,
                                    onClick: () =>
                                      setStatusTarget({ user: u, action: 'deactivate' }),
                                  },
                                ]
                              : []),
                            ...(canActivateUser(u)
                              ? [
                                  {
                                    key: 'activate',
                                    label: 'Set Active',
                                    icon: <Snowflake className="w-4 h-4" />,
                                    onClick: () =>
                                      setStatusTarget({ user: u, action: 'activate' }),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {!loading && (
          <ListPagination
            from={showingFrom}
            to={showingTo}
            total={filteredCount}
            itemLabel="users"
            currentPage={currentPage}
            totalPages={totalPages}
            pagesWindow={pagesWindow}
            onPageChange={setCurrentPage}
            className="bg-slate-50/50 dark:bg-slate-900/50"
          />
        )}
      </div>
    </PageShell>
  );
};

export default UserManagement;
