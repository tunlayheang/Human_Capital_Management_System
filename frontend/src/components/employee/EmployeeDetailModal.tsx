import React, { useEffect, useState } from 'react';
import {
  User,
  Briefcase,
  Phone,
  DollarSign,
  Heart,
  Users,
  Pencil,
  Mail,
  MapPin,
  Shield,
  Clock,
  ArrowRightLeft,
} from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { formatProbationProfileLabel } from '../../utils/employeeProbation';
import { Modal } from '../ui/Modal';
import { StatusLabel } from '../ui/StatusLabel';
import { Button } from '../ui/Button';
import { EmployeeAvatar } from './EmployeeAvatar';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { exportEmployeeProfileDocument } from '../../utils/exportEmployeePdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { formatEmployeeAge } from '../../utils/employeeAge';
import { EmployeeMovementHistoryTable } from './EmployeeMovementHistoryTable';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { PERM } from '../../constants/permissionKeys';
import {
  resolveEmployeeRecordDisplayName,
  type PersonNameFields,
} from '../../utils/personDisplayName';
import {
  resolveBilingualText,
  resolveDepartmentRowName,
  resolvePositionRowTitle,
} from '../../utils/localizedEntityLabel';
import {
  resolveEmergencyRelationLabel,
  resolveNationalityLabel,
  resolveReligionLabel,
} from '../../constants/khmerPersonalChoices';
import { resolveCityLabel } from '../../constants/cambodiaLocations';
import { parseSpouseHasWork } from '../../utils/taxDependents';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { normalizeEmployeeDisplayId } from '../../utils';

type EmployeeDetail = Record<string, unknown>;

function formatDate(raw: unknown): string {
  if (raw == null || raw === '') return '—';
  return formatDateOnlyDisplay(String(raw));
}

function display(val: unknown): string {
  if (val == null || val === '') return '—';
  return String(val);
}

function formatTime(raw: unknown): string {
  if (raw == null || raw === '') return '—';
  const s = String(raw).trim().slice(0, 5);
  return s || '—';
}

function formatSalary(amount: unknown, currency: unknown): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  const cur = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toLocaleString()} ${cur}`;
  }
}

function statusBadge(status: string) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const labelMap: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    pending_approval: 'Pending',
    terminated: 'Inactive',
    resigned: 'Inactive',
    draft: 'Draft',
    profile_incomplete: 'Draft',
  };
  const code = normalized.toUpperCase();
  const label = labelMap[normalized] ?? (status || 'Unknown');

  return <StatusLabel status={code} context="employee" label={label} size="sm" />;
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`mt-0.5 text-sm text-slate-900 dark:text-white break-words ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h4>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3 p-4">{children}</dl>
    </section>
  );
}

export interface EmployeeDetailModalProps {
  employeeId: string | null;
  onClose: () => void;
  roleLabelFromApi: (name: string) => string;
  canEdit?: boolean;
  onEdit?: (employeeId: string) => void;
}

export const EmployeeDetailModal: React.FC<EmployeeDetailModalProps> = ({
  employeeId,
  onClose,
  roleLabelFromApi,
  canEdit,
  onEdit,
}) => {
  const { showToast } = useToast();
  const { language } = useLanguage();
  const { hasPermission } = useAuth();
  const canCancelMovement =
    hasPermission(PERM.EMPLOYEE_EDIT_WORK) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_CREATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);

  useEffect(() => {
    if (!employeeId) {
      setEmployee(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await Api.employees.getById(employeeId);
        if (cancelled) return;
        if (!data || typeof data !== 'object') {
          setError('Employee not found.');
          setEmployee(null);
          return;
        }
        setEmployee(data as EmployeeDetail);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load employee details.');
          setEmployee(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const isOpen = Boolean(employeeId);
  const dept = employee?.department as
    | { name?: string; name_kh?: string; nameKh?: string; officeLocationName?: string }
    | undefined;
  const pos = employee?.position as
    | { title?: string; title_kh?: string; titleKh?: string }
    | undefined;
  const dependents = Array.isArray(employee?.dependents)
    ? (employee!.dependents as Record<string, unknown>[])
    : [];
  const children = Array.isArray(employee?.children)
    ? (employee!.children as Record<string, unknown>[])
    : [];
  const familyRows =
    children.length > 0
      ? children.map((c) => ({
          id: c.id,
          name: c.name,
          nameKh: c.nameKh ?? c.name_kh,
          relationship: 'child',
          age: c.age,
          gender: c.gender,
          occupation: c.occupation,
          hasJob: c.hasJob ?? c.has_job,
        }))
      : dependents;
  const fullName = employee
    ? resolveEmployeeRecordDisplayName(employee as PersonNameFields, language)
    : '';
  const alternateName = employee
    ? resolveEmployeeRecordDisplayName(
        employee as PersonNameFields,
        language === 'km' ? 'en' : 'km'
      )
    : '';
  const showAlternateName =
    Boolean(alternateName) && alternateName !== '—' && alternateName !== fullName;
  const spouseHasWork = parseSpouseHasWork(employee?.spouse_occupation);
  const departmentLabel = dept
    ? resolveDepartmentRowName(
        { name: dept.name, nameKh: dept.nameKh ?? dept.name_kh },
        language
      )
    : display(employee?.department_id);
  const positionLabel = pos
    ? resolvePositionRowTitle(
        { title: pos.title, titleKh: pos.titleKh ?? pos.title_kh },
        language
      )
    : display(employee?.position_id);

  const roleLabel = employee?.role
    ? roleLabelFromApi(String(employee.role))
    : '—';

  const handleExport = async (format: ExportFileExt) => {
    if (!employee) return;
    try {
      await exportEmployeeProfileDocument(format, { employee, roleLabel }, language);
      showToast(`Employee profile exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      showToast(msg, 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Employee profile"
      size="wide"
      contentClassName="px-4 py-4 sm:px-5 sm:py-5"
    >
      {loading && <ContentSkeleton layout="form" rows={1} label="Loading employee details…" />}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && employee && (
        <div className="space-y-5 -mt-2">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 text-white p-5 sm:p-6">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
              <EmployeeAvatar
                avatarUrl={employee.avatar_url as string | null | undefined}
                firstName={String(employee.first_name ?? '')}
                lastName={String(employee.last_name ?? '')}
                className="h-16 w-16 sm:h-20 sm:w-20 ring-4 ring-white/20 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {statusBadge(String(employee.status ?? ''))}
                  {employee.allow_login === true && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200 bg-white/10 px-2.5 py-0.5 rounded-full">
                      <Shield className="w-3 h-3" />
                      Portal access
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{fullName}</h2>
                {showAlternateName ? (
                  <p className="text-sm text-slate-300 truncate mt-0.5">{alternateName}</p>
                ) : null}
                <p className="text-sm text-slate-300 font-mono mt-0.5">{normalizeEmployeeDisplayId(employee.employee_id) || '—'}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-slate-300">
                  {employee.email ? (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{display(employee.email)}</span>
                    </span>
                  ) : null}
                  {employee.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      {display(employee.phone)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Overview: Personal · Employment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailSection title="Personal information" icon={User}>
              <DetailField label="Gender" value={display(employee.gender)} />
              <DetailField label="Date of birth" value={formatDate(employee.birth_date)} />
              <DetailField
                label="Age"
                value={formatEmployeeAge(employee.birth_date as string | Date | undefined)}
              />
              <DetailField
                label="Nationality"
                value={resolveNationalityLabel(
                  String(employee.nationality || employee.ethnicity || ''),
                  language
                )}
              />
              <DetailField
                label="Religion"
                value={resolveReligionLabel(String(employee.religion ?? ''), language)}
              />
              <DetailField label="National ID" value={display(employee.national_id)} mono />
              <DetailField label="Passport" value={display(employee.passport_number)} mono />
              <DetailField
                label="Birth certificate"
                value={display(employee.birth_certificate_number)}
                mono
              />
              <DetailField label="Marital status" value={display(employee.marital_status)} />
            </DetailSection>

            <DetailSection title="Employment" icon={Briefcase}>
              <DetailField label="Department" value={departmentLabel} />
              <DetailField
                label="Office location"
                value={display(
                  employee.officeLocationName ??
                    dept?.officeLocationName ??
                    employee.work_location
                )}
              />
              <DetailField label="Position" value={positionLabel} />
              <DetailField label="Role" value={roleLabel} />
              <DetailField label="Employment type" value={display(employee.employment_type)} />
              <DetailField
                label="Contract type"
                value={display(employee.contract_type ?? employee.contractType)}
              />
              <DetailField
                label="Employment status"
                value={display(
                  employee.employment_status ??
                    employee.employmentStatus ??
                    employee.status
                )}
              />
              <DetailField label="Join date" value={formatDate(employee.join_date)} />
              <DetailField
                label="Probation"
                value={formatProbationProfileLabel({
                  join_date: String(employee.join_date ?? ''),
                  probation_period_months: Number(employee.probation_period_months ?? 0),
                  probation_confirmed_at:
                    employee.probation_confirmed_at != null
                      ? String(employee.probation_confirmed_at)
                      : undefined,
                  worker_type: String(employee.worker_type ?? ''),
                })}
              />
            </DetailSection>
          </div>

          {/* Work schedule · Compensation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailSection title="Work schedule" icon={Clock}>
              <DetailField
                label="Time in / out"
                value={
                  employee.time_in || employee.time_out
                    ? `${formatTime(employee.time_in)} – ${formatTime(employee.time_out)}`
                    : '—'
                }
              />
              <DetailField
                label="Working hours / day"
                value={
                  employee.work_hours != null && employee.work_hours !== ''
                    ? `${display(employee.work_hours)}h`
                    : '—'
                }
              />
              <DetailField label="Days per week" value={display(employee.work_days)} />
              <DetailField
                label="Break duration"
                value={
                  employee.break_duration_minutes != null
                    ? `${display(employee.break_duration_minutes)} min`
                    : '—'
                }
              />
              <DetailField
                label="Grace period"
                value={
                  employee.grace_period_minutes != null && employee.grace_period_minutes !== ''
                    ? `${display(employee.grace_period_minutes)} min`
                    : 'Org default'
                }
              />
            </DetailSection>

            <DetailSection title="Compensation" icon={DollarSign}>
              <DetailField label="Base salary" value={formatSalary(employee.base_salary, employee.currency)} />
              <DetailField
                label="Payroll basis days"
                value={
                  employee.payroll_basis_days != null
                    ? `${employee.payroll_basis_days} days`
                    : '—'
                }
              />
              <DetailField label="Salary type" value={display(employee.salary_type)} />
              <DetailField label="Currency" value={display(employee.currency)} />
              <DetailField label="Payment day" value={display(employee.payment_day)} />
              <DetailField
                label="Payment method"
                value={
                  String(employee.payment_method ?? '').toLowerCase() === 'cash'
                    ? 'Cash'
                    : 'Bank transfer'
                }
              />
              {String(employee.payment_method ?? 'bank').toLowerCase() !== 'cash' ? (
                <>
                  <DetailField label="Bank" value={display(employee.bank_name)} />
                  <DetailField
                    label="Account number"
                    value={display(employee.bank_account_number)}
                    mono
                  />
                </>
              ) : null}
              <DetailField
                label={
                  employee.tax_id != null && /^\d+(\.\d+)?$/.test(String(employee.tax_id).trim())
                    ? 'Tax rate'
                    : 'Tax ID'
                }
                value={
                  employee.tax_id != null && /^\d+(\.\d+)?$/.test(String(employee.tax_id).trim())
                    ? `${employee.tax_id}%`
                    : display(employee.tax_id)
                }
                mono
              />
            </DetailSection>
          </div>

          {/* Contact · Emergency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailSection title="Contact & address" icon={MapPin}>
              <DetailField label="Mobile" value={display(employee.phone)} />
              <DetailField
                label="Telegram number"
                value={display(employee.telegram_number ?? employee.telegramNumber)}
              />
              {employee.work_phone ? (
                <DetailField label="Work phone" value={display(employee.work_phone)} />
              ) : null}
              <DetailField
                label="Street"
                value={resolveBilingualText(
                  employee.street_address as string | null | undefined,
                  employee.street_address_kh as string | null | undefined,
                  language
                )}
              />
              {employee.street_address &&
              employee.street_address_kh &&
              String(employee.street_address) !== String(employee.street_address_kh) ? (
                <DetailField
                  label={language === 'km' ? 'Street (EN)' : 'Street (KH)'}
                  value={display(
                    language === 'km' ? employee.street_address : employee.street_address_kh
                  )}
                />
              ) : null}
              <DetailField
                label="City"
                value={resolveCityLabel(
                  employee.city as string | null | undefined,
                  language,
                  employee.city_kh as string | null | undefined
                )}
              />
              {employee.state_province ? (
                <DetailField label="Province" value={display(employee.state_province)} />
              ) : null}
              {employee.postal_code ? (
                <DetailField label="Postal code" value={display(employee.postal_code)} />
              ) : null}
              <DetailField label="Country" value={display(employee.country)} />
            </DetailSection>

            <DetailSection title="Emergency contact" icon={Heart}>
              <DetailField
                label="Name"
                value={resolveBilingualText(
                  employee.emergency_contact_name as string | null | undefined,
                  employee.emergency_contact_name_kh as string | null | undefined,
                  language
                )}
              />
              <DetailField
                label="Relationship"
                value={resolveEmergencyRelationLabel(
                  String(employee.emergency_contact_relationship ?? ''),
                  language,
                  employee.emergency_contact_relationship_kh as string | null | undefined
                )}
              />
              <DetailField label="Phone" value={display(employee.emergency_contact_phone)} />
            </DetailSection>
          </div>

          {(familyRows.length > 0 ||
            employee.spouse_name ||
            employee.spouse_name_kh ||
            employee.termination_reason) && (
            <div className="grid grid-cols-1 gap-4">
              <DetailSection title="Additional" icon={Users}>
                {employee.spouse_name || employee.spouse_name_kh ? (
                  <DetailField
                    label="Spouse"
                    value={resolveBilingualText(
                      employee.spouse_name as string | null | undefined,
                      employee.spouse_name_kh as string | null | undefined,
                      language
                    )}
                  />
                ) : null}
                {spouseHasWork ? (
                  <DetailField
                    label="Spouse has work"
                    value={spouseHasWork === 'yes' ? 'Yes' : 'No'}
                  />
                ) : null}
                {employee.spouse_phone ? (
                  <DetailField label="Spouse phone" value={display(employee.spouse_phone)} />
                ) : null}
                {employee.termination_reason ? (
                  <DetailField label="Termination reason" value={display(employee.termination_reason)} />
                ) : null}
                {employee.terminated_at ? (
                  <DetailField label="Terminated on" value={formatDate(employee.terminated_at)} />
                ) : null}
                {familyRows.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                      Children / dependents ({familyRows.length})
                    </dt>
                    <ul className="space-y-2">
                      {familyRows.map((dep, i) => {
                        const bits = [
                          dep.relationship ? display(dep.relationship) : null,
                          dep.age != null && dep.age !== '' ? `Age ${display(dep.age)}` : null,
                          dep.gender ? display(dep.gender) : null,
                          dep.hasJob === 'yes' || dep.hasJob === true
                            ? 'Has work'
                            : dep.hasJob === 'no' || dep.hasJob === false
                              ? 'No work'
                              : null,
                          dep.occupation ? display(dep.occupation) : null,
                        ].filter(Boolean);
                        return (
                          <li
                            key={String(dep.id ?? i)}
                            className="text-sm text-slate-800 dark:text-slate-200 rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2 border border-slate-100 dark:border-slate-700"
                          >
                            <span className="font-medium">
                              {resolveBilingualText(
                                (dep.full_name ?? dep.name) as string | null | undefined,
                                (dep.name_kh ?? dep.nameKh) as string | null | undefined,
                                language
                              )}
                            </span>
                            {bits.length ? (
                              <span className="text-slate-500 dark:text-slate-400">
                                {' '}
                                · {bits.join(' · ')}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </DetailSection>
            </div>
          )}

          {employeeId ? (
            <section className="rounded-2xl border border-slate-200/80 dark:border-slate-600/60 bg-slate-50/50 dark:bg-slate-900/30 p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300">
                  <ArrowRightLeft className="w-4 h-4 shrink-0" />
                </span>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Movement history
                </h4>
              </div>
              <EmployeeMovementHistoryTable
                employeeId={employeeId}
                canCancelScheduled={canCancelMovement}
                variant="compact"
              />
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" type="button" onClick={onClose}>
              Close
            </Button>
            <ExportFormatMenu variant="button" onExport={handleExport} />
            {canEdit && onEdit && employeeId && (
              <Button
                type="button"
                onClick={() => onEdit(employeeId)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit employee
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
