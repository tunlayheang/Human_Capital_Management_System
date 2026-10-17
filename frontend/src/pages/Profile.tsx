import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { Api } from '../services/api';
import { User, Role } from '../types';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import {
  Briefcase,
  CreditCard,
  User as UserIcon,
  Save,
  Heart,
  Loader,
} from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUrl';
import { applyInputFilter } from '../utils/formInputFilters';
import { SelectWithOther } from '../components/ui/SelectWithOther';
import { PageShell } from '../components/ui/page';
import { ProfileSectionCard } from '../components/profile/ProfileSectionCard';
import { ProfileHero } from '../components/profile/ProfileHero';
import { ProfileField, ProfileReadOnly } from '../components/profile/ProfileField';
import { inputClass } from '../constants/designSystem';
import { userDisplayEmployeeCode, isSystemPortalAccount, userNameParts } from '../utils/userProfile';
import { usePersonDisplayName } from '../hooks/usePersonDisplayName';
import { isAdminRole } from '../utils/adminNavScope';
import { formatAccessRoleLabel } from '../utils/accessRole';
import { useStickyActionBarActive } from '../hooks/useStickyActionBarActive';
import { ensureWizardFooterRoot } from '../utils/overlayPortal';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';

const fieldInputClass = `${inputClass} rounded-xl bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-600/80 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500`;
const fieldGridClass = 'grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3';

interface ProfileFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  birthDate: string;
  gender: string;
  nationalId: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  taxId: string;
  workLocation: string;
  employmentType: string;
  avatarUrl: string;
}

function normalizeGender(raw?: string): string {
  const g = String(raw || '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'Male';
  if (g === 'female' || g === 'f') return 'Female';
  return raw?.trim() || '';
}

function normalizeEmploymentType(raw?: string): string {
  const s = String(raw || '').trim();
  const map: Record<string, string> = {
    'full-time': 'Full-Time',
    'part-time': 'Part-Time',
    contract: 'Contract',
    intern: 'Intern',
    internship: 'Intern',
    Fulltime: 'Full-Time',
    'full time': 'Full-Time',
  };
  if (map[s]) return map[s];
  if (['Full-Time', 'Part-Time', 'Contract', 'Intern'].includes(s)) return s;
  return '';
}

type UserWithEmployee = User & {
  employee?: { avatar_url?: string | null; email?: string | null } | null;
};

/** Prefer linked Employee photo (canonical) over User.avatarUrl. */
function avatarFromUser(u: UserWithEmployee): string {
  const empUrl = u.employee?.avatar_url;
  if (empUrl && String(empUrl).trim()) return String(empUrl).trim();
  return u.avatarUrl || '';
}

function userToFormData(u: UserWithEmployee, systemAccount = false): ProfileFormData {
  if (systemAccount) {
    const { firstName, lastName } = userNameParts(u);
    return {
      firstName,
      lastName,
      email: String(u.email || '').trim(),
      phone: u.phone || '',
      address: '',
      birthDate: '',
      gender: '',
      nationalId: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelation: '',
      bankName: '',
      bankAccountName: '',
      bankAccountNumber: '',
      taxId: '',
      workLocation: '',
      employmentType: 'Full-Time',
      avatarUrl: u.avatarUrl || '',
    };
  }
  const parts = userNameParts(u);
  const fn = u.firstName?.trim() || parts.firstName;
  const ln = u.lastName?.trim() || parts.lastName;
  return {
    firstName: fn,
    lastName: ln,
    email: String(u.employee?.email || u.email || '').trim(),
    phone: u.phone || '',
    address: u.address || '',
    birthDate: u.birthDate || '',
    gender: normalizeGender(u.gender),
    nationalId: u.nationalId || '',
    emergencyContactName: u.emergencyContactName || '',
    emergencyContactPhone: u.emergencyContactPhone || '',
    emergencyContactRelation: u.emergencyContactRelation || '',
    bankName: u.bankName || '',
    bankAccountName: u.bankAccountName || '',
    bankAccountNumber: u.bankAccountNumber || '',
    taxId: u.taxId || '',
    workLocation: u.workLocation || '',
    employmentType: normalizeEmploymentType(u.employmentType) || 'Full-Time',
    avatarUrl: avatarFromUser(u),
  };
}

function roleBadgeClasses(role: Role): string {
  switch (role) {
    case Role.ADMIN:
      return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800/50';
    case Role.HR:
      return 'bg-primary-50 text-primary-700 ring-1 ring-primary-200/80 dark:bg-primary-950/40 dark:text-primary-200 dark:ring-primary-800/50';
    case Role.MANAGER:
      return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800/50';
    default:
      return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-700/50 dark:text-slate-200 dark:ring-slate-600/50';
  }
}

function apiErrMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (typeof msg === 'string') return msg;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

const Profile: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const displayName = usePersonDisplayName();
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const [formData, setFormData] = useState<ProfileFormData>(() =>
    user ? userToFormData(user, isSystemPortalAccount(user)) : ({} as ProfileFormData)
  );

  const syncFormFromUser = useCallback((u: UserWithEmployee) => {
    setFormData(userToFormData(u, isSystemPortalAccount(u)));
  }, []);

  useEffect(() => {
    if (user) syncFormFromUser(user as UserWithEmployee);
  }, [user?.id, user?.name, user?.email, user?.avatarUrl, syncFormFromUser]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [formData.avatarUrl, user?.avatarUrl, (user as UserWithEmployee)?.employee?.avatar_url]);

  // Load enriched user (with linked Employee avatar) on first visit.
  useEffect(() => {
    void refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await Api.departments.getAll();
        if (!cancelled && Array.isArray(list)) {
          setDepartments(list.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
        }
      } catch {
        if (!cancelled) setDepartments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const departmentName = useMemo(() => {
    if (!user?.departmentId) return '';
    return departments.find((d) => d.id === user.departmentId)?.name || '';
  }, [user?.departmentId, departments]);

  const isSystemAdmin = isSystemPortalAccount(user);
  const isAdmin = isAdminRole(user.role);
  /** HR/Manager/Employee always see own profile sections; Admin uses movement-focused profile instead. */
  const showEmployeeProfileSections = !isAdmin && !isSystemAdmin;
  const canPersonal = isSystemAdmin || showEmployeeProfileSections;
  const canEmergency = showEmployeeProfileSections;
  const canFinancial = showEmployeeProfileSections;
  const canWork = showEmployeeProfileSections;
  const employeeCode = userDisplayEmployeeCode(user as UserWithEmployee);
  const isEmployeeSelf = user?.role === Role.EMPLOYEE;
  /** Most profile fields are HR-managed; photo is self-service. */
  const canEditFields = false;
  const canEditAvatar = true;
  const profilePhotoHint =
    t('profile.photoOnlyHint') ||
    'You can update your profile photo here. Contact HR to change other details.';
  const savedAvatarUrl = user ? avatarFromUser(user as UserWithEmployee) : '';
  const avatarDirty = Boolean(formData.avatarUrl && formData.avatarUrl !== savedAvatarUrl);
  const profileDirty = avatarDirty;
  const [useFixedSaveBar, setUseFixedSaveBar] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(null);
  const saveBarRef = useStickyActionBarActive(profileDirty && useFixedSaveBar);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setUseFixedSaveBar(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    if (!profileDirty || !useFixedSaveBar) {
      setFooterRoot(null);
      return;
    }
    setFooterRoot(ensureWizardFooterRoot());
  }, [profileDirty, useFixedSaveBar]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name } = e.target;
    let value = e.target.value;
    if (name === 'phone' || name === 'emergencyContactPhone') {
      value = applyInputFilter('phone', value, { maxLength: 11 });
    } else if (name === 'firstName' || name === 'lastName' || name === 'emergencyContactName') {
      value = applyInputFilter('name', value);
    } else if (name === 'nationalId') {
      value = applyInputFilter('digits', value, { maxLength: 15 });
    } else if (name === 'bankAccountNumber' || name === 'taxId') {
      value = applyInputFilter('alphanumeric', value, { maxLength: 32 });
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
  const AVATAR_MIN_BYTES = 2 * 1024;
  const AVATAR_MIN_DIM = 100;
  const AVATAR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

  const validateImageFile = (file: File): Promise<string | null> =>
    new Promise((resolve) => {
      if (!AVATAR_ALLOWED_MIME.includes(file.type)) {
        return resolve('Only JPG, PNG, or WebP images are allowed.');
      }
      if (file.size > AVATAR_MAX_BYTES) {
        return resolve(`Image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum allowed is 5 MB.`);
      }
      if (file.size < AVATAR_MIN_BYTES) {
        return resolve('Image looks too small to be a valid photo.');
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth < AVATAR_MIN_DIM || img.naturalHeight < AVATAR_MIN_DIM) {
          resolve(`Image must be at least ${AVATAR_MIN_DIM}×${AVATAR_MIN_DIM}px.`);
        } else {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('That file does not look like a readable image.');
      };
      img.src = url;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = await validateImageFile(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    try {
      const { url } = await Api.uploads.avatar(file);
      setFormData((prev) => ({ ...prev, avatarUrl: url }));
      showToast(t('profile.photoUploaded'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('profile.invalidImageFile'), 'error');
    }
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user || !profileDirty) return;
    setIsSavingProfile(true);
    setMessage(null);
    try {
      const payload: { id: string; avatarUrl?: string } = { id: user.id };
      if (avatarDirty) payload.avatarUrl = formData.avatarUrl;
      await Api.users.update(payload);
      await refreshUser();
      const okMsg = t('profile.photoSaved') || t('profile.profileUpdated');
      setMessage({ text: okMsg, type: 'success' });
      showToast(okMsg, 'success');
    } catch (err) {
      const msg = apiErrMessage(err) || t('profile.updateFailed');
      setMessage({ text: msg, type: 'error' });
      showToast(msg, 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (!user) return null;

  const resolvedAvatar =
    resolveMediaUrl(formData.avatarUrl || avatarFromUser(user as UserWithEmployee)) || null;
  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0078C1&color=fff&size=256`;
  const avatarSrc = !resolvedAvatar || avatarBroken ? fallbackAvatar : resolvedAvatar;
  const dash = t('profile.readOnlyDash');

  const renderSystemPersonal = () => (
    <dl className={fieldGridClass}>
      <ProfileField label={t('form.lastName')}>
        {canEditFields ? (
          <input
            type="text"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.lastName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.firstName')}>
        {canEditFields ? (
          <input
            type="text"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.firstName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.email')} hint={t('profile.emailReadOnlyHint')}>
        <ProfileReadOnly value={formData.email} emptyLabel={dash} />
      </ProfileField>
      <ProfileField label={t('form.phone')}>
        {canEditFields ? (
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.phone} emptyLabel={dash} />
        )}
      </ProfileField>
    </dl>
  );

  const renderPersonal = () => (
    <dl className={fieldGridClass}>
      <ProfileField label={t('form.lastName')}>
        {canEditFields ? (
          <input
            type="text"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.lastName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.firstName')}>
        {canEditFields ? (
          <input
            type="text"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.firstName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.email')} hint={canEditFields ? t('profile.emailReadOnlyHint') : undefined}>
        <ProfileReadOnly value={formData.email} emptyLabel={dash} />
      </ProfileField>
      <ProfileField label={t('form.phone')}>
        {canEditFields ? (
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.phone} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.address')} className="sm:col-span-2">
        {canEditFields ? (
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.address} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.dob')}>
        {canEditFields ? (
          <DatePickerInput
            name="birthDate"
            value={formData.birthDate}
            onChange={handleChange}
            className={fieldInputClass}
            disableFuture
          />
        ) : (
          <ProfileReadOnly value={formData.birthDate} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('form.gender')}>
        {canEditFields ? (
          <select
            name="gender"
            value={formData.gender}
            onChange={handleChange}
            className={fieldInputClass}
          >
            <option value="" disabled hidden>—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        ) : (
          <ProfileReadOnly value={formData.gender} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.nationalId')}>
        {canEditFields ? (
          <input
            type="text"
            name="nationalId"
            value={formData.nationalId}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.nationalId} emptyLabel={dash} />
        )}
      </ProfileField>
    </dl>
  );

  const renderEmergency = () => (
    <dl className={fieldGridClass}>
      <ProfileField label={t('profile.emergencyContactName')} className="sm:col-span-2">
        {canEditFields ? (
          <input
            type="text"
            name="emergencyContactName"
            value={formData.emergencyContactName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.emergencyContactName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.emergencyContactPhone')}>
        {canEditFields ? (
          <input
            type="tel"
            name="emergencyContactPhone"
            value={formData.emergencyContactPhone}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.emergencyContactPhone} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.emergencyContactRelation')}>
        {canEditFields ? (
          <SelectWithOther
            value={formData.emergencyContactRelation}
            onChange={(v) =>
              setFormData((prev) => ({ ...prev, emergencyContactRelation: v }))
            }
            options={[
              { value: 'Spouse', label: 'Spouse' },
              { value: 'Parent', label: 'Parent' },
              { value: 'Sibling', label: 'Sibling' },
              { value: 'Child', label: 'Child' },
              { value: 'Friend', label: 'Friend' },
              { value: 'Other', label: 'Other' },
            ]}
            selectClassName={fieldInputClass}
            inputClassName={fieldInputClass}
            emptyOption={{ value: '', label: 'Select relationship' }}
            otherPlaceholder="e.g. Cousin, Guardian…"
            otherLabel="Specify relationship"
          />
        ) : (
          <ProfileReadOnly value={formData.emergencyContactRelation} emptyLabel={dash} />
        )}
      </ProfileField>
    </dl>
  );

  const renderFinancial = () => (
    <dl className={fieldGridClass}>
      <ProfileField label={t('profile.bankName')}>
        {canEditFields ? (
          <input
            type="text"
            name="bankName"
            value={formData.bankName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.bankName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.bankAccountName')}>
        {canEditFields ? (
          <input
            type="text"
            name="bankAccountName"
            value={formData.bankAccountName}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.bankAccountName} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.bankAccountNumber')}>
        {canEditFields ? (
          <input
            type="text"
            name="bankAccountNumber"
            value={formData.bankAccountNumber}
            onChange={handleChange}
            className={`${fieldInputClass} font-mono tracking-wide`}
          />
        ) : (
          <ProfileReadOnly value={formData.bankAccountNumber} emptyLabel={dash} mono />
        )}
      </ProfileField>
      <ProfileField label={t('profile.taxId')}>
        {canEditFields ? (
          <input
            type="text"
            name="taxId"
            value={formData.taxId}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.taxId} emptyLabel={dash} />
        )}
      </ProfileField>
    </dl>
  );

  const renderWork = () => (
    <dl className={fieldGridClass}>
      <ProfileField label={t('leaves.department') || 'Department'}>
        <ProfileReadOnly value={departmentName || dash} emptyLabel={dash} />
      </ProfileField>
      <ProfileField label={t('profile.position')}>
        <ProfileReadOnly value={user.position || dash} emptyLabel={dash} />
      </ProfileField>
      <ProfileField label={t('profile.workLocation')}>
        {canEditFields ? (
          <input
            type="text"
            name="workLocation"
            value={formData.workLocation}
            onChange={handleChange}
            className={fieldInputClass}
          />
        ) : (
          <ProfileReadOnly value={formData.workLocation} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.role') || 'Role'}>
        <ProfileReadOnly value={formatAccessRoleLabel(user.role) || dash} emptyLabel={dash} />
      </ProfileField>
      <ProfileField label={t('profile.employmentType')}>
        {canEditFields ? (
          <select
            name="employmentType"
            value={formData.employmentType}
            onChange={handleChange}
            className={fieldInputClass}
          >
            <option value="Full-Time">Full-Time</option>
            <option value="Part-Time">Part-Time</option>
            <option value="Contract">Contract</option>
            <option value="Intern">Intern</option>
          </select>
        ) : (
          <ProfileReadOnly value={formData.employmentType} emptyLabel={dash} />
        )}
      </ProfileField>
      <ProfileField label={t('profile.joinDate')}>
        <ProfileReadOnly
          value={user.joinDate ? formatDateOnlyDisplay(user.joinDate) : dash}
          emptyLabel={dash}
        />
      </ProfileField>
    </dl>
  );

  const saveBar = (() => {
    if (!profileDirty) return null;
    const saveLabel = t('profile.savePhoto');
    const actions = (
      <div className="pointer-events-auto flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 p-3.5 sm:p-4 [&>button]:shrink-0 [&>button]:min-h-11">
        <Button
          type="button"
          variant="outline"
          className="flex-1 sm:flex-none"
          onClick={() => {
            if (user) syncFormFromUser(user);
          }}
        >
          {t('profile.cancelEdit')}
        </Button>
        <Button
          type="button"
          className="flex-1 sm:flex-none sm:min-w-[180px]"
          disabled={isSavingProfile}
          onClick={() => {
            void handleSaveProfile();
          }}
        >
          {isSavingProfile ? (
            <Loader className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          {saveLabel}
        </Button>
      </div>
    );

    if (useFixedSaveBar) {
      const fixed = (
        <div
          ref={saveBarRef}
          className="hcms-action-sticky-footer hcms-sticky-footer rounded-t-2xl pointer-events-none"
        >
          {actions}
        </div>
      );
      return footerRoot ? createPortal(fixed, footerRoot) : fixed;
    }

    return (
      <div
        ref={saveBarRef}
        className="mt-5 rounded-2xl border border-slate-200/80 dark:border-slate-600/80 bg-white/95 dark:bg-slate-800/95 pointer-events-none"
      >
        {actions}
      </div>
    );
  })();

  return (
    <PageShell className="w-full min-w-0 pb-28 lg:pb-12">
      {message && (
        <div
          className={`mb-4 p-4 rounded-xl border text-sm font-medium flex items-start gap-3 ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
          }`}
          role="status"
        >
          {message.text}
        </div>
      )}

      <header className="mb-4 sm:mb-5">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('profile.title') || 'Profile'}
        </h1>
      </header>

      <ProfileHero
        name={displayName}
        position={isSystemAdmin ? undefined : user.position}
        role={formatAccessRoleLabel(user.role)}
        employeeCode={employeeCode}
        departmentLabel={departmentName || user.departmentId || dash}
        email={formData.email || user.email}
        phone={formData.phone || user.phone || ''}
        avatarSrc={avatarSrc}
        onAvatarError={() => setAvatarBroken(true)}
        canEditAvatar={canEditAvatar}
        onPhotoClick={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
        onFileChange={handleFileChange}
        isEditing={false}
        canEditProfile={false}
        onToggleEdit={() => undefined}
        isEmployeeSelf={isEmployeeSelf}
        photoHint={profilePhotoHint}
        roleBadgeClass={roleBadgeClasses(user.role)}
        showDepartment={!isSystemAdmin}
        labels={{
          uploadPhoto: t('profile.uploadPhoto') || 'Upload profile photo',
          changePhoto: t('profile.changePhoto') || 'Change photo',
          editProfile: t('profile.editProfile'),
          doneEditing: t('profile.doneEditing'),
          noPhone: dash,
          department: t('leaves.department') || 'Department',
          email: t('form.email'),
          phone: t('form.phone'),
          editingMode: undefined,
        }}
      />

      <form id="profile-self-save-form" onSubmit={handleSaveProfile} className="mt-5 lg:mt-6">
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(canPersonal || isSystemAdmin) && (
              <ProfileSectionCard
                title={t('profile.personalInformation') || t('profile.personal') || 'Personal information'}
                icon={UserIcon}
              >
                {isSystemAdmin ? renderSystemPersonal() : renderPersonal()}
              </ProfileSectionCard>
            )}

            {canWork && (
              <ProfileSectionCard
                title={t('profile.employment') || t('profile.workTab') || 'Employment'}
                icon={Briefcase}
              >
                {renderWork()}
              </ProfileSectionCard>
            )}

            {canEmergency && (
              <ProfileSectionCard
                title={t('profile.emergency') || 'Emergency contact'}
                icon={Heart}
              >
                {renderEmergency()}
              </ProfileSectionCard>
            )}

            {canFinancial && (
              <ProfileSectionCard
                title={t('profile.financial') || 'Financial'}
                icon={CreditCard}
              >
                {renderFinancial()}
              </ProfileSectionCard>
            )}
          </div>

          {saveBar}
        </div>
      </form>
    </PageShell>
  );
};

export default Profile;
