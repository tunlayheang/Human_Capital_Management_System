import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { Department, Position, Role } from '../../types';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { positionLevelLabel } from '../../constants/positionCatalog';
import { formatPositionSalaryRange, hasPositionSalaryRange } from '../../utils/positionSalary';
import {
  EMPLOYMENT_TYPE_OPTIONS,
  capPeriodMonthsForEmploymentType,
  defaultPeriodMonthsForEmploymentType,
  engagementEndDate,
  normalizeEmploymentType,
  periodFieldLabels,
  periodMonthOptionsForEmploymentType,
  resolveWorkerTypeForEmployment,
} from '../../utils/employmentPeriod';
import {
  WizardField,
  WizardFieldGrid,
  WizardMetaBar,
  WizardSectionCard,
  WizardStepStack,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { useLanguage } from '../../context/LanguageContext';
import {
  resolveDepartmentDisplayName,
  resolvePositionTitle,
} from '../../utils/localizedEntityLabel';
import { CreateDepartmentModal } from '../departments/CreateDepartmentModal';
import { CreatePositionModal } from '../departments/CreatePositionModal';

interface Option {
  id?: string;
  name?: string;
  nameKh?: string | null;
  title?: string;
  titleKh?: string | null;
  level?: string | null;
  salaryMin?: number;
  isActive?: boolean;
  salaryMax?: number;
  salary?: number;
  value?: string;
  label?: string;
}

interface StepJobProps {
  register: any;
  errors: Record<string, any>;
  departments: Option[];
  positions: Option[];
  isManager: boolean;
  watchAccessRole?: Role;
  watchDepartmentId?: string;
  watchJoinDate?: string;
  watchEmploymentType?: string;
  watchProbationPeriodMonths?: number;
  setValue?: (name: string, value: unknown, opts?: { shouldDirty?: boolean }) => void;
  onDepartmentCreated?: (department: Department) => void;
  onPositionCreated?: (position: Position) => void;
}

export const StepJob: React.FC<StepJobProps> = ({
  register,
  errors,
  departments,
  positions,
  isManager,
  watchAccessRole,
  watchDepartmentId,
  watchJoinDate,
  watchEmploymentType,
  watchProbationPeriodMonths,
  setValue,
  onDepartmentCreated,
  onPositionCreated,
}) => {
  const { language } = useLanguage();
  const [showCreateDepartment, setShowCreateDepartment] = useState(false);
  const [showCreatePosition, setShowCreatePosition] = useState(false);

  const employmentType = normalizeEmploymentType(watchEmploymentType);
  const labels = periodFieldLabels(employmentType);
  const monthOptions = useMemo(
    () => periodMonthOptionsForEmploymentType(employmentType),
    [employmentType]
  );
  const months = capPeriodMonthsForEmploymentType(
    Number(
      watchProbationPeriodMonths ?? defaultPeriodMonthsForEmploymentType(employmentType)
    ),
    employmentType
  );
  const computedEnd = useMemo(
    () => engagementEndDate(watchJoinDate, months),
    [watchJoinDate, months]
  );
  const previewEnd =
    months > 0 && watchJoinDate?.trim() ? (computedEnd ?? '') : '';

  const selectedDepartmentName = useMemo(() => {
    const dept = departments.find((d) => d.id === watchDepartmentId);
    if (!dept) return '';
    return resolveDepartmentDisplayName(
      { name: dept.name ?? '', nameKh: dept.nameKh ?? undefined },
      language
    );
  }, [departments, watchDepartmentId, language]);

  const syncPeriodEnd = useCallback(
    (joinDate: string | undefined, periodMonths: number) => {
      if (!setValue) return;
      const end = engagementEndDate(joinDate, periodMonths) ?? '';
      setValue('probationEnd', end, { shouldDirty: false });
      setValue(
        'workerType',
        resolveWorkerTypeForEmployment(employmentType, periodMonths),
        { shouldDirty: false }
      );
    },
    [employmentType, setValue]
  );

  useEffect(() => {
    if (!setValue) return;
    if (watchProbationPeriodMonths !== months) {
      setValue('probationPeriodMonths', months, { shouldDirty: true });
    }
    setValue(
      'workerType',
      resolveWorkerTypeForEmployment(employmentType, months),
      { shouldDirty: false }
    );
  }, [employmentType, months, setValue, watchProbationPeriodMonths]);

  useEffect(() => {
    syncPeriodEnd(watchJoinDate, months);
  }, [watchJoinDate, months, syncPeriodEnd]);

  const canCreateDepartment = !isManager && Boolean(onDepartmentCreated);
  const canCreatePosition =
    Boolean(onPositionCreated) && Boolean(String(watchDepartmentId || '').trim());

  return (
    <WizardStepStack>
      <WizardMetaBar
        label="Access role (from Identity)"
        value={formatAccessRoleLabel(watchAccessRole || Role.EMPLOYEE)}
      />

      <WizardSectionCard
        icon={Briefcase}
        title="Placement"
        description="Department, position, and employment dates."
      >
        <WizardFieldGrid>
          <WizardField label="Department" required error={errors.departmentId?.message}>
            <select
              {...register('departmentId')}
              disabled={isManager}
              className={`${WIZARD_SELECT_CLASS} disabled:opacity-70`}
            >
              <option value="">Select Department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {resolveDepartmentDisplayName(
                    { name: department.name ?? '', nameKh: department.nameKh ?? undefined },
                    language
                  )}
                </option>
              ))}
            </select>
            {canCreateDepartment ? (
              <button
                type="button"
                onClick={() => setShowCreateDepartment(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                Create department
              </button>
            ) : null}
          </WizardField>

          <WizardField label="Job position" required error={errors.position?.message}>
            <select {...register('position')} className={WIZARD_SELECT_CLASS}>
              <option value="" disabled hidden>Select job position</option>
              {positions.map((position) => {
                const level = positionLevelLabel(position.level);
                const range = hasPositionSalaryRange(position)
                  ? ` · ${formatPositionSalaryRange(position)}`
                  : '';
                const title = resolvePositionTitle(
                  { title: position.title ?? '', titleKh: position.titleKh ?? undefined },
                  language
                );
                const label = level ? `${title} — ${level}${range}` : `${title}${range}`;
                return (
                  <option key={position.id || position.title} value={position.id ?? position.title}>
                    {label}
                  </option>
                );
              })}
            </select>
            {canCreatePosition ? (
              <button
                type="button"
                onClick={() => setShowCreatePosition(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                Create position
              </button>
            ) : !String(watchDepartmentId || '').trim() && onPositionCreated ? (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Select a department to create a position.
              </p>
            ) : null}
          </WizardField>

          <WizardField label="Employment type">
            <select
              {...register('employmentType', {
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  if (!setValue) return;
                  const nextType = normalizeEmploymentType(e.target.value);
                  const nextMonths = defaultPeriodMonthsForEmploymentType(nextType);
                  setValue('probationPeriodMonths', nextMonths, { shouldDirty: true });
                  setValue(
                    'workerType',
                    resolveWorkerTypeForEmployment(nextType, nextMonths),
                    { shouldDirty: false }
                  );
                  syncPeriodEnd(watchJoinDate, nextMonths);
                },
              })}
              className={WIZARD_SELECT_CLASS}
            >
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </WizardField>

          <WizardField label="Join date" required error={errors.joinDate?.message}>
            <DatePickerInput
              {...register('joinDate', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  syncPeriodEnd(e.target.value, months);
                },
              })}
              value={watchJoinDate || ''}
              className={WIZARD_INPUT_CLASS}
            />
          </WizardField>

          <WizardField
            label={labels.lengthLabel}
            hint={labels.hint}
            error={errors.probationPeriodMonths?.message}
          >
            <select
              {...register('probationPeriodMonths', {
                valueAsNumber: true,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  const periodMonths = capPeriodMonthsForEmploymentType(
                    Number(e.target.value),
                    employmentType
                  );
                  syncPeriodEnd(watchJoinDate, periodMonths);
                },
              })}
              className={WIZARD_SELECT_CLASS}
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </WizardField>

          <WizardField label={labels.endLabel} hint={labels.endHint}>
            <DatePickerInput readOnly
              tabIndex={-1}
              className={`${WIZARD_INPUT_CLASS} bg-slate-50 text-slate-700 dark:bg-slate-800/60`}
              value={previewEnd}
            />
            <input type="hidden" {...register('probationEnd')} />
            <input type="hidden" {...register('workerType')} />
          </WizardField>
        </WizardFieldGrid>
      </WizardSectionCard>

      {canCreateDepartment ? (
        <CreateDepartmentModal
          isOpen={showCreateDepartment}
          onClose={() => setShowCreateDepartment(false)}
          departments={departments as Department[]}
          onCreated={(dept) => onDepartmentCreated?.(dept)}
        />
      ) : null}

      {onPositionCreated && watchDepartmentId ? (
        <CreatePositionModal
          isOpen={showCreatePosition}
          onClose={() => setShowCreatePosition(false)}
          departmentId={watchDepartmentId}
          departmentName={selectedDepartmentName}
          onCreated={(pos) => onPositionCreated(pos)}
        />
      ) : null}
    </WizardStepStack>
  );
};
