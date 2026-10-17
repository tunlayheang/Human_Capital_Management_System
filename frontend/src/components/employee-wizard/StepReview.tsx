import React, { useEffect, useState } from 'react';
import { BadgeCheck, FileText } from 'lucide-react';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { Api } from '../../services/api';
import { WizardReviewCard, WizardReviewRow, WizardStepStack } from './wizardLayout';
import { computeTaxDependents } from '../../utils/taxDependents';
import { formatEmployeeAge } from '../../utils/employeeAge';
import { formatProbationProfileLabel } from '../../utils/employeeProbation';
import { joinPersonNameParts } from '../../utils/personDisplayName';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { formatAccessRoleLabel } from '../../utils/accessRole';

interface StepReviewProps {
  watchAll: Record<string, any>;
  avatarPreview: string | null;
  departments: Array<{ id?: string; name?: string }>;
  managers: Array<{ id?: string; name?: string }>;
  positions: Array<{ id?: string; title?: string }>;
  jumpToStep: (index: number) => void;
  employeeDisplayId?: string;
}

function initials(first?: string, last?: string): string {
  return `${last?.[0] || ''}${first?.[0] || ''}`.toUpperCase() || '?';
}

export const StepReview: React.FC<StepReviewProps> = ({
  watchAll,
  avatarPreview,
  departments,
  managers,
  positions,
  jumpToStep,
  employeeDisplayId,
}) => {
  const [documentCount, setDocumentCount] = useState(0);
  const isMarried = watchAll.maritalStatus === 'married';
  const usesBankTransfer = watchAll.paymentMethod !== 'cash';

  const requiredLabel = (label: string) => (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span className="text-red-500 dark:text-red-400 font-semibold" aria-hidden="true">
        *
      </span>
    </span>
  );

  useEffect(() => {
    const key = employeeDisplayId?.trim();
    if (!key) {
      setDocumentCount(0);
      return;
    }
    let cancelled = false;
    void Api.employees
      .listDocuments(key)
      .then((rows) => {
        if (!cancelled) setDocumentCount(Array.isArray(rows) ? rows.length : 0);
      })
      .catch(() => {
        if (!cancelled) setDocumentCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeDisplayId]);

  const department = departments.find((item) => item.id === watchAll.departmentId);
  const positionLabel =
    positions.find((p) => p.id === watchAll.position)?.title || watchAll.position || 'Position';

  const portalOn = !!watchAll.allowLogin;
  const avatarSrc = resolveMediaUrl(avatarPreview);

  return (
    <WizardStepStack>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="shrink-0">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                className="w-[132px] h-[132px] rounded-full object-cover border-4 border-white dark:border-slate-700 shadow-md"
              />
            ) : (
              <div className="w-[132px] h-[132px] rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-4xl font-bold border-4 border-white dark:border-slate-700 shadow-md">
                {initials(watchAll.firstName, watchAll.lastName)}
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                {joinPersonNameParts(watchAll.firstName, watchAll.lastName)}
              </h3>
              {(watchAll.firstNameKh || watchAll.lastNameKh) && (
                <p className="text-lg font-khmer text-slate-600 dark:text-slate-300 w-full">
                  {joinPersonNameParts(watchAll.firstNameKh, watchAll.lastNameKh)}
                </p>
              )}
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 text-xs font-bold uppercase tracking-wide">
                <BadgeCheck className="w-3.5 h-3.5" />
                {positionLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-200/90 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {watchAll.id || '—'}
              </span>
              <span className="text-xs px-3 py-1 rounded-full bg-blue-600 text-white font-semibold">
                {department?.name || 'Department'}
              </span>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-slate-600 dark:text-slate-400">
              <span>
                <span className="font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase mr-2">Joined</span>
                {watchAll.joinDate ? formatDateOnlyDisplay(watchAll.joinDate) : '—'}
              </span>
              <span>
                <span className="font-semibold text-slate-500 dark:text-slate-400 text-xs uppercase mr-2">Employment</span>
                {watchAll.employmentType || '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <WizardReviewCard title="Identity & access" stepIndex={0} onEdit={jumpToStep}>
          <WizardReviewRow
            label={requiredLabel('Employee ID')}
            value={<span className="font-mono">{watchAll.id}</span>}
          />
          <WizardReviewRow label={requiredLabel('Work email')} value={watchAll.email || '—'} />
          <WizardReviewRow label={requiredLabel('Phone')} value={watchAll.phone || '—'} />
          <WizardReviewRow label="Telegram number" value={watchAll.telegramNumber || '—'} />
          <WizardReviewRow label={requiredLabel('First name')} value={watchAll.firstName || '—'} />
          <WizardReviewRow label={requiredLabel('Last name')} value={watchAll.lastName || '—'} />
          {(watchAll.firstNameKh || watchAll.lastNameKh) && (
            <WizardReviewRow
              label="Name (Khmer)"
              value={
                <span className="font-khmer">
                  {joinPersonNameParts(watchAll.firstNameKh, watchAll.lastNameKh) || '—'}
                </span>
              }
            />
          )}
          <WizardReviewRow
            label="Access role"
            value={formatAccessRoleLabel(watchAll.accessRole ?? watchAll.role)}
          />
          <WizardReviewRow
            label="Allow login to portal"
            value={
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  portalOn
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {portalOn ? 'Enabled' : 'Disabled'}
              </span>
            }
          />
        </WizardReviewCard>

        <WizardReviewCard title="Personal details" stepIndex={1} onEdit={jumpToStep}>
          <WizardReviewRow label="Gender" value={watchAll.gender} />
          <WizardReviewRow label="Date of birth" value={watchAll.birthDate} />
          <WizardReviewRow label="Age" value={formatEmployeeAge(watchAll.birthDate)} />
          <WizardReviewRow label="Nationality" value={watchAll.nationality} />
          <WizardReviewRow label="National ID" value={watchAll.nationalId || '—'} />
          <WizardReviewRow label="Passport" value={watchAll.passport || '—'} />
          <WizardReviewRow
            label="Birth certificate"
            value={watchAll.birthCertificate || '—'}
          />
        </WizardReviewCard>

        <WizardReviewCard title="Placement" stepIndex={2} onEdit={jumpToStep}>
          <WizardReviewRow label={requiredLabel('Department')} value={department?.name || '—'} />
          <WizardReviewRow label={requiredLabel('Job position')} value={positionLabel} />
          <WizardReviewRow label={requiredLabel('Join date')} value={watchAll.joinDate || '—'} />
          <WizardReviewRow label="Employment type" value={watchAll.employmentType || '—'} />
          <WizardReviewRow
            label={
              String(watchAll.employmentType) === 'Intern'
                ? 'Internship'
                : String(watchAll.employmentType) === 'Contract'
                  ? 'Contract'
                  : 'Probation'
            }
            value={
              watchAll.probationPeriodMonths === 0
                ? 'No probation'
                : watchAll.probationEnd
                  ? `${watchAll.probationPeriodMonths ?? 3} month(s) — ends ${watchAll.probationEnd}`
                  : formatProbationProfileLabel({
                      join_date: watchAll.joinDate,
                      employment_type: watchAll.employmentType,
                      probation_period_months: watchAll.probationPeriodMonths,
                      worker_type: watchAll.workerType,
                    })
            }
          />
        </WizardReviewCard>

        <WizardReviewCard title="Work schedule" stepIndex={3} onEdit={jumpToStep}>
          <WizardReviewRow
            label={requiredLabel('Time in / out')}
            value={`${watchAll.timeIn || '—'} – ${watchAll.timeOut || '—'}`}
          />
          <WizardReviewRow label="Break duration" value={watchAll.breakDurationMinutes ?? '—'} />
          <WizardReviewRow label="Hours / day" value={`${watchAll.workHours ?? '—'}h`} />
          <WizardReviewRow label={requiredLabel('Days / week')} value={watchAll.workDays ?? '—'} />
          <WizardReviewRow
            label={requiredLabel('Grace (min)')}
            value={watchAll.gracePeriodMinutes != null ? watchAll.gracePeriodMinutes : 'Org default'}
          />
        </WizardReviewCard>

        <WizardReviewCard title="Contact" stepIndex={4} onEdit={jumpToStep}>
          <WizardReviewRow label="Country" value={watchAll.country || 'Cambodia'} />
          <WizardReviewRow label="City / Province" value={watchAll.city || '—'} />
          {watchAll.cityKh ? (
            <WizardReviewRow
              label="City (Khmer)"
              value={<span className="font-khmer">{watchAll.cityKh}</span>}
            />
          ) : null}
          <WizardReviewRow label="Address" value={watchAll.address || '—'} />
          {watchAll.addressKh ? (
            <WizardReviewRow
              label="Address (Khmer)"
              value={<span className="font-khmer">{watchAll.addressKh}</span>}
            />
          ) : null}
        </WizardReviewCard>

        <WizardReviewCard title="Family" stepIndex={5} onEdit={jumpToStep}>
          <WizardReviewRow
            label={requiredLabel('Marital status')}
            value={watchAll.maritalStatus || 'single'}
          />
          {isMarried && (
            <>
              <WizardReviewRow label={requiredLabel('Spouse')} value={watchAll.spouseName || '—'} />
              {watchAll.spouseNameKh ? (
                <WizardReviewRow
                  label="Spouse (Khmer)"
                  value={<span className="font-khmer">{watchAll.spouseNameKh}</span>}
                />
              ) : null}
              <WizardReviewRow
                label={requiredLabel('Spouse has a job')}
                value={
                  watchAll.spouseHasWork === 'yes'
                    ? 'Yes'
                    : watchAll.spouseHasWork === 'no'
                      ? 'No'
                      : '—'
                }
              />
              <WizardReviewRow
                label={requiredLabel('Spouse phone')}
                value={watchAll.spousePhone || '—'}
              />
              <WizardReviewRow
                label="Children"
                value={
                  Array.isArray(watchAll.children) && watchAll.children.length
                    ? watchAll.children
                        .map((c, i) => {
                          const name = String(c?.name ?? '').trim();
                          const nameKh = String(c?.nameKh ?? '').trim();
                          const display =
                            [name, nameKh ? `(${nameKh})` : ''].filter(Boolean).join(' ') ||
                            `Child ${i + 1}`;
                          const job = c?.hasJob === 'yes' ? 'has job' : 'dependent';
                          return `${display} (${job})`;
                        })
                        .join('; ')
                    : '—'
                }
              />
              <WizardReviewRow
                label="Tax dependents"
                value={computeTaxDependents(
                  'married',
                  watchAll.children ?? [],
                  watchAll.spouseHasWork
                )}
              />
            </>
          )}
        </WizardReviewCard>

        <WizardReviewCard title="Compensation" stepIndex={6} onEdit={jumpToStep}>
          <WizardReviewRow
            label={requiredLabel('Base salary')}
            value={
              watchAll.basicSalary != null && Number(watchAll.basicSalary) > 0
                ? `$${Number(watchAll.basicSalary).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USD`
                : '—'
            }
          />
          <WizardReviewRow label="Currency" value="USD" />
          <WizardReviewRow
            label="NSSF enrolled"
            value={
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  watchAll.nssfEnrolled !== false
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {watchAll.nssfEnrolled !== false ? 'Yes' : 'No'}
              </span>
            }
          />
          <WizardReviewRow
            label={requiredLabel('Payment method')}
            value={
              watchAll.paymentMethod === 'cash'
                ? 'Cash'
                : watchAll.paymentMethod === 'bank'
                  ? 'Bank transfer'
                  : '—'
            }
          />
          {usesBankTransfer ? (
            <>
              <WizardReviewRow
                label={requiredLabel('Bank name')}
                value={watchAll.bankName || '—'}
              />
              <WizardReviewRow
                label={requiredLabel('Account #')}
                value={<span className="font-mono text-xs">{watchAll.bankAccount || '—'}</span>}
              />
            </>
          ) : null}
        </WizardReviewCard>

        <WizardReviewCard title="Emergency" stepIndex={7} onEdit={jumpToStep}>
          <WizardReviewRow label="Name" value={watchAll.emergencyName || '—'} />
          {watchAll.emergencyNameKh ? (
            <WizardReviewRow
              label="Name (Khmer)"
              value={<span className="font-khmer">{watchAll.emergencyNameKh}</span>}
            />
          ) : null}
          <WizardReviewRow label="Relationship" value={watchAll.emergencyRelation || '—'} />
          {watchAll.emergencyRelationKh ? (
            <WizardReviewRow
              label="Relationship (Khmer)"
              value={<span className="font-khmer">{watchAll.emergencyRelationKh}</span>}
            />
          ) : null}
          <WizardReviewRow label="Phone" value={watchAll.emergencyPhone || '—'} />
        </WizardReviewCard>

        <WizardReviewCard title="Documents" stepIndex={8} onEdit={jumpToStep}>
          <WizardReviewRow
            label="Uploaded files"
            value={
              <span className="inline-flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-primary-500" />
                {documentCount}
              </span>
            }
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
            {documentCount > 0
              ? 'Contracts, IDs, and certificates are stored with this employee.'
              : 'Optional — add ID, contract, or certificates on the Documents step.'}
          </p>
        </WizardReviewCard>
      </div>
    </WizardStepStack>
  );
};
