import React, { useMemo, useRef } from 'react';
import { Building2, GitBranch, UserCircle } from 'lucide-react';
import { Department, Role, User } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { NO_MANAGER_ASSIGNED_LABEL } from '../../utils/departmentDisplay';
import { WizardKhmerSubsection } from '../employee-wizard/wizardKhmerSection';
import { SearchableSelect } from '../ui/SearchableSelect';

export type DepartmentUnitFormValues = {
  name: string;
  nameKh: string;
  code: string;
  managerId: string;
  purpose: string;
};

export const EMPTY_DEPARTMENT_UNIT_FORM: DepartmentUnitFormValues = {
  name: '',
  nameKh: '',
  code: '',
  managerId: '',
  purpose: '',
};

export function suggestDepartmentUnitCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 6)
    .toUpperCase();
}

/** Payload for POST/PUT /departments from the unit form. */
export function buildDepartmentPayload(
  values: DepartmentUnitFormValues,
  existing?: Department
): Omit<Department, 'headCount' | 'managerName' | 'id'> & Partial<Pick<Department, 'id'>> {
  const managerId =
    values.managerId != null && String(values.managerId).trim() !== ''
      ? String(values.managerId).trim()
      : null;
  const code = values.code.trim().toUpperCase();
  return {
    ...(existing ? { id: existing.id } : {}),
    name: values.name.trim(),
    nameKh: values.nameKh.trim(),
    ...(code ? { code } : {}),
    managerId,
  };
}

type Props = {
  values: DepartmentUnitFormValues;
  onChange: (values: DepartmentUnitFormValues) => void;
  departments: Department[];
  users: User[];
  excludeDepartmentId?: string;
  requireManager?: boolean;
  /** Page layout uses lighter sections; modal keeps compact card sections. */
  variant?: 'modal' | 'page';
};

const inputClass =
  'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none transition-shadow';

const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5';

function FieldLabel({
  htmlFor,
  children,
  required,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelClass}>
        {children}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {hint ? <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 -mt-1">{hint}</p> : null}
    </div>
  );
}

function FormSection({
  title,
  icon: Icon,
  children,
  variant,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  variant: 'modal' | 'page';
}) {
  if (variant === 'page') {
    return (
      <section className="space-y-4 pb-8 border-b border-slate-100 dark:border-slate-800 last:border-0 last:pb-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
          {title}
        </h3>
        <div className="space-y-4">{children}</div>
      </section>
    );
  }

  return (
    <section className="hcms-modal-form-section">
      <div className="hcms-modal-section-title">
        <Icon className="w-4 h-4" />
        {title}
      </div>
      {children}
    </section>
  );
}

export function departmentValuesFromRecord(dept: Department): DepartmentUnitFormValues {
  const name = dept.name;
  const existingCode = String(dept.code ?? '').trim();
  return {
    name,
    nameKh: dept.nameKh ?? '',
    code: existingCode || suggestDepartmentUnitCode(name),
    managerId: dept.managerId ?? '',
    purpose: '',
  };
}

export function eligibleDepartmentManagers(
  users: User[],
  departments: Department[],
  currentDepartmentId?: string,
  currentManagerId?: string
): User[] {
  const list = users.filter((u) => {
    if (u.role !== Role.MANAGER) return false;
    const assigned = departments.find((d) => d.managerId === u.id);
    return !assigned || assigned.id === currentDepartmentId;
  });
  const keepId = currentManagerId?.trim();
  if (keepId && !list.some((u) => u.id === keepId)) {
    const current = users.find((u) => u.id === keepId);
    if (current?.role === Role.MANAGER) return [current, ...list];
  }
  return list;
}

export const DepartmentUnitForm: React.FC<Props> = ({
  values,
  onChange,
  departments,
  users,
  excludeDepartmentId,
  requireManager = false,
  variant = 'modal',
}) => {
  const { t } = useLanguage();
  /** Tracks the last auto-suggested code so manual edits are preserved when the name changes. */
  const lastAutoCode = useRef(suggestDepartmentUnitCode(values.name));

  const set = (patch: Partial<DepartmentUnitFormValues>) => onChange({ ...values, ...patch });

  const managers = useMemo(
    () =>
      eligibleDepartmentManagers(users, departments, excludeDepartmentId, values.managerId),
    [users, departments, excludeDepartmentId, values.managerId]
  );

  const managerOptions = useMemo(
    () =>
      managers.map((u) => ({
        value: u.id,
        label: u.name,
        description: u.email || u.position || undefined,
        searchText: `${u.email ?? ''} ${u.position ?? ''} ${u.role ?? ''}`,
      })),
    [managers]
  );

  const handleNameChange = (name: string) => {
    const nextAuto = suggestDepartmentUnitCode(name);
    if (!values.code.trim() || values.code === lastAutoCode.current) {
      lastAutoCode.current = nextAuto;
      set({ name, code: nextAuto });
      return;
    }
    set({ name });
  };

  const handleCodeChange = (code: string) => {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
    set({ code: normalized });
  };

  const khmerNameField = (
    <div>
      <FieldLabel htmlFor="dept-name-kh" required>
        {t('departments.khmer.departmentName')}
      </FieldLabel>
      <input
        id="dept-name-kh"
        required
        value={values.nameKh}
        onChange={(e) => set({ nameKh: e.target.value })}
        placeholder="ឧ. វិស្វករកម្មវិធី"
        className={`${inputClass} font-khmer`}
      />
    </div>
  );

  return (
    <div className={variant === 'page' ? 'space-y-8' : 'space-y-6'}>
      <FormSection title="Unit identity" icon={Building2} variant={variant}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="dept-name" required hint="Official name shown across the organization.">
              Department name
            </FieldLabel>
            <input
              id="dept-name"
              required
              value={values.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Human Resources"
              className={inputClass}
            />
          </div>

          <WizardKhmerSubsection
            titleKey="departments.khmer.sectionTitle"
            descriptionKey="departments.khmer.sectionDescription"
          >
            {khmerNameField}
          </WizardKhmerSubsection>

          <div>
            <FieldLabel htmlFor="dept-code" hint="Auto-filled from the department name; you can edit it.">
              Unit code
            </FieldLabel>
            <input
              id="dept-code"
              value={values.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="e.g. HR"
              maxLength={16}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="dept-purpose" hint="Short summary of this unit’s responsibility (optional).">
            Unit purpose
          </FieldLabel>
          <textarea
            id="dept-purpose"
            rows={3}
            value={values.purpose}
            onChange={(e) => set({ purpose: e.target.value })}
            placeholder="Describe the primary function of this business unit…"
            className={`${inputClass} resize-none`}
          />
        </div>
      </FormSection>

      <FormSection title="Leadership" icon={UserCircle} variant={variant}>
        <div className="max-w-xl">
          <FieldLabel
            htmlFor="dept-head"
            required={requireManager}
            hint="Optional. One manager can head only one department."
          >
            Department head
          </FieldLabel>
          <SearchableSelect
            id="dept-head"
            required={requireManager}
            value={values.managerId}
            onChange={(managerId) => set({ managerId })}
            options={managerOptions}
            className={inputClass}
            placeholder="Search manager…"
            emptyLabel={requireManager ? '— Select manager —' : NO_MANAGER_ASSIGNED_LABEL}
            clearOption={
              requireManager
                ? undefined
                : { value: '', label: NO_MANAGER_ASSIGNED_LABEL }
            }
          />
          {requireManager && !values.managerId && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
              Assign a department head before saving.
            </p>
          )}
        </div>
        {values.managerId ? (
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400 max-w-xl">
            <GitBranch className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary-600" aria-hidden />
            <span>
              Shown as <strong className="font-semibold text-slate-800 dark:text-slate-200">Department Head</strong>{' '}
              on directory cards and this module.
            </span>
          </div>
        ) : null}
      </FormSection>
    </div>
  );
};
