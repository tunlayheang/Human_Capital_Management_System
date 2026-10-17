import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Pencil } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import {
  PAYROLL_BASIS_DAY_OPTIONS,
  PAYROLL_WORK_DAY_METHOD_OPTIONS,
  normalizePayrollBasisDays,
  type PayrollWorkDayMethod,
} from '../../constants/payrollBasisDays';
import { SectionEditToolbar } from '../../pages/payroll/SectionEditToolbar';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { promptPolicySaveEffectiveDate } from '../../utils/policyEffectiveDate';
import { PayrollPolicyVersionMetaLine } from '../payroll/PayrollPolicyVersionMetaLine';
import { LoadingState } from '../common/LoadingState';

type Props = { canEdit: boolean; compact?: boolean };

const sectionHeaderClass =
  'flex flex-row flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

const inputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm w-full max-w-md';

export const PayrollWorkDayPolicySection: React.FC<Props> = ({ canEdit, compact = false }) => {
  const { showToast } = useToast();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [method, setMethod] = useState<PayrollWorkDayMethod>('fixed_employee_basis');
  const [companyBasisDays, setCompanyBasisDays] = useState<number>(26);
  const [savedMethod, setSavedMethod] = useState<PayrollWorkDayMethod>('fixed_employee_basis');
  const [savedCompanyBasisDays, setSavedCompanyBasisDays] = useState<number>(26);
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [scheduledEffectiveFrom, setScheduledEffectiveFrom] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await Api.payroll.getWorkDayPolicy();
      const nextMethod = (data.method as PayrollWorkDayMethod) ?? 'fixed_employee_basis';
      const nextDays = normalizePayrollBasisDays(data.companyBasisDays);
      setMethod(nextMethod);
      setCompanyBasisDays(nextDays);
      setSavedMethod(nextMethod);
      setSavedCompanyBasisDays(nextDays);
      setEffectiveFrom(data.effectiveFrom ?? null);
      setScheduledEffectiveFrom(data.scheduledEffectiveFrom ?? null);
      setLastUpdatedAt(data.lastUpdatedAt ?? null);
    } catch {
      showToast('Could not load payroll work-day policy.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const policyEffectiveFrom = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: 'Save work-day policy?',
      description:
        'Choose when this payroll work-day basis takes effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: 'Save policy',
      defaultEffectiveDate: scheduledEffectiveFrom ?? effectiveFrom ?? undefined,
    });
    if (!policyEffectiveFrom) return;
    setSaving(true);
    try {
      const saved = await Api.payroll.updateWorkDayPolicy({
        method,
        companyBasisDays,
        effectiveFrom: policyEffectiveFrom,
      });
      setEffectiveFrom(saved.effectiveFrom ?? policyEffectiveFrom);
      setScheduledEffectiveFrom(saved.scheduledEffectiveFrom ?? null);
      setLastUpdatedAt(saved.lastUpdatedAt ?? null);
      setSavedMethod(method);
      setSavedCompanyBasisDays(companyBasisDays);
      showToast('Payroll work-day policy scheduled.', 'success');
      setIsEditing(false);
    } catch {
      showToast('Could not save payroll work-day policy.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selected = PAYROLL_WORK_DAY_METHOD_OPTIONS.find((o) => o.value === method);
  const showEditableCue = canEdit && !isEditing;
  const isDirty =
    isEditing && (method !== savedMethod || companyBasisDays !== savedCompanyBasisDays);
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty,
    confirm,
  });

  return (
    <Card
      help="payroll.workDayMethod"
      className={`overflow-hidden h-full shadow-sm ${
        isEditing
          ? 'border border-primary-300 dark:border-primary-700 ring-2 ring-primary-500/20'
          : showEditableCue
            ? 'border-2 border-primary-300/80 dark:border-primary-700/80 ring-1 ring-primary-500/15'
            : 'border border-slate-200/80 dark:border-slate-700'
      }`}
    >
      <ConfirmDialogHost />
      <div
        className={`${sectionHeaderClass} ${compact ? 'px-4 py-2.5' : ''} ${
          showEditableCue
            ? 'bg-primary-50/70 dark:bg-primary-950/30 border-b-primary-100 dark:border-b-primary-900/50'
            : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              showEditableCue || isEditing
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {compact ? 'Work day method' : 'Payroll Work Day Method'}
              </h3>
              {showEditableCue && (
                <Badge variant="info" className="text-[10px] uppercase tracking-wide">
                  Editable
                </Badge>
              )}
              {isEditing && (
                <Badge variant="warning" className="text-[10px] uppercase tracking-wide">
                  Editing
                </Badge>
              )}
            </div>
          </div>
        </div>
        {canEdit && (
          <SectionEditToolbar
            canEdit={canEdit}
            isEditing={isEditing}
            onEdit={() => setIsEditing(true)}
            onCancel={async () => {
              if (!(await confirmDiscardIfDirty())) return;
              setMethod(savedMethod);
              setCompanyBasisDays(savedCompanyBasisDays);
              setIsEditing(false);
              void load();
            }}
            onSave={() => void save()}
            saving={saving}
            editVariant="primary"
          />
        )}
      </div>

      <div className={`${compact ? 'p-4' : 'p-5'} space-y-4`}>
        {loading ? (
          <LoadingState variant="panel" layout="form" rows={2} label="Loading…" className="py-1" />
        ) : isEditing && canEdit ? (
          <>
            <fieldset className="space-y-3">
              <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Method
              </legend>
              {PAYROLL_WORK_DAY_METHOD_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                    method === opt.value
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="payrollWorkDayMethod"
                    checked={method === opt.value}
                    onChange={() => setMethod(opt.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {opt.label}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {method === 'fixed_company_basis' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Company payroll basis days
                </label>
                <select
                  className={inputClass}
                  value={companyBasisDays}
                  onChange={(e) => setCompanyBasisDays(Number(e.target.value))}
                >
                  {PAYROLL_BASIS_DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} Days
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3 text-sm">
            {showEditableCue && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="w-full text-left rounded-xl border border-dashed border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-950/20 px-3 py-2.5 hover:bg-primary-50 dark:hover:bg-primary-950/35 transition-colors"
              >
                <p className="text-xs font-medium text-primary-800 dark:text-primary-200 flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5 shrink-0" />
                  This setting can be updated
                </p>
                <p className="text-[11px] text-primary-700/80 dark:text-primary-300/80 mt-0.5">
                  Click here or Edit to change employee vs company basis days.
                </p>
              </button>
            )}

            <div
              className={`rounded-xl border p-3 space-y-2 ${
                showEditableCue
                  ? 'border-primary-200/80 dark:border-primary-800/60 bg-white dark:bg-slate-900/40'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <p>
                <span className="text-slate-500">Method:</span>{' '}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {selected?.label ?? method}
                </span>
              </p>
              {method === 'fixed_company_basis' && (
                <p>
                  <span className="text-slate-500">Company basis:</span>{' '}
                  <span className="font-medium tabular-nums">{companyBasisDays} days</span>
                </p>
              )}
            </div>

            <PayrollPolicyVersionMetaLine
              className="text-[11px] text-slate-400 pt-1"
              lastUpdatedAt={lastUpdatedAt}
              effectiveFrom={effectiveFrom}
              scheduledEffectiveFrom={scheduledEffectiveFrom}
            />
          </div>
        )}
      </div>
    </Card>
  );
};
