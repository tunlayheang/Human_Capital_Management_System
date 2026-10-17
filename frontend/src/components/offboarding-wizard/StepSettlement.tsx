import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { toDateOnlyString } from '../../offboarding/employeeDates';
import { Loader2, LogOut } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { StatusLabel } from '../ui/StatusLabel';
import { inputClass } from '../../constants/designSystem';
import { EmployeeAvatar } from '../employee/EmployeeAvatar';
import {
  normalizeSettlementStatus,
  settlementStatusLabel,
} from '../../offboarding/offboardingWizardSteps';
import {
  formatDisplayDate,
  isSimplifiedOffboardingSettlement,
  SIMPLIFIED_PRE_PAYMENT_STATUSES,
  type SettlementRow,
} from '../../offboarding/settlementFormUtils';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';

type OffboardType = 'terminate' | 'resign';

type OffboardMeta = {
  offboardType: OffboardType;
  offboardReason: string;
  resignationSubmittedAt?: string;
  resignationApprovedAt?: string;
  offboardedBy?: string;
  source?: 'wizard';
};

type Props = {
  employee: {
    employee_id: string;
    first_name: string;
    last_name: string;
    avatar_url?: string | null;
    status?: string;
  };
  canPayroll: boolean;
  onSettlementChange: (row: SettlementRow | null) => void;
};

export type StepSettlementHandle = {
  save: () => Promise<boolean>;
};

export const StepSettlement = forwardRef<StepSettlementHandle, Props>(function StepSettlement(
  { employee, canPayroll, onSettlementChange },
  ref
) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settlement, setSettlement] = useState<SettlementRow | null>(null);
  const [offboardType, setOffboardType] = useState<OffboardType>('terminate');
  const [reason, setReason] = useState('');
  const [lastWorkingDate, setLastWorkingDate] = useState(() => todayYmdInCompanyTz());
  const [resignationSubmittedAt, setResignationSubmittedAt] = useState('');
  const [resignationApprovedAt, setResignationApprovedAt] = useState('');
  const [resignationFile, setResignationFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const status = normalizeSettlementStatus(settlement?.status);
  const readOnly = ['PAID', 'LOCKED', 'PENDING_PAYROLL_OFFBOARD'].includes(status);
  const fullName = `${employee.last_name} ${employee.first_name}`.trim();

  const loadSettlement = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await Api.payroll.listFinalSettlements({
        employeeId: employee.employee_id,
      })) as SettlementRow[];
      const list = Array.isArray(rows) ? rows : [];
      const row =
        list.find((r) => {
          const st = normalizeSettlementStatus(r.status);
          return (
            isSimplifiedOffboardingSettlement(r) && SIMPLIFIED_PRE_PAYMENT_STATUSES.has(st)
          );
        }) ??
        list.find((r) => normalizeSettlementStatus(r.status) === 'DRAFT') ??
        list.find((r) => normalizeSettlementStatus(r.status) !== 'REJECTED') ??
        list[0];
      if (row?.id) {
        const full = (await Api.payroll.getFinalSettlement(row.id)) as SettlementRow;
        setSettlement(full);
        onSettlementChange(full);
        const lwd = toDateOnlyString(full.lastWorkingDate);
        if (lwd) setLastWorkingDate(lwd);
        setNotes(full.notes ? String(full.notes) : '');
        const raw = full.clearanceJson;
        let parsed: Record<string, unknown> = {};
        try {
          parsed =
            typeof raw === 'string'
              ? (JSON.parse(raw) as Record<string, unknown>)
              : ((raw as Record<string, unknown>) ?? {});
        } catch {
          parsed = {};
        }
        const meta = parsed._offboardMeta as OffboardMeta | undefined;
        if (meta) {
          setOffboardType(meta.offboardType ?? 'terminate');
          setReason(meta.offboardReason ?? '');
          setResignationSubmittedAt(meta.resignationSubmittedAt ?? '');
          setResignationApprovedAt(meta.resignationApprovedAt ?? '');
        }
      } else {
        setSettlement(null);
        onSettlementChange(null);
      }
    } catch (e) {
      setSettlement(null);
      onSettlementChange(null);
      showToast(e instanceof Error ? e.message : 'Could not load settlement', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee.employee_id, onSettlementChange, showToast]);

  useEffect(() => {
    void loadSettlement();
  }, [loadSettlement]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!canPayroll) {
      showToast('Payroll permission is required to save offboarding settlement.', 'error');
      return false;
    }
    if (readOnly) return true;

    const lwd = toDateOnlyString(lastWorkingDate);
    if (!lwd) {
      showToast('Last working date is required', 'error');
      return false;
    }
    if (!reason.trim()) {
      showToast('Offboarding reason is required', 'error');
      return false;
    }
    if (offboardType === 'resign' && !resignationFile && !settlement?.id) {
      showToast('Upload resignation letter for resignations', 'error');
      return false;
    }

    setBusy(true);
    try {
      if (offboardType === 'resign' && resignationFile) {
        await Api.employees.uploadDocument(
          employee.employee_id,
          resignationFile,
          'Resignation Letter'
        );
      }
      const clearancePayload = {
        _offboardMeta: {
          offboardType,
          offboardReason: reason.trim(),
          resignationSubmittedAt: resignationSubmittedAt || undefined,
          resignationApprovedAt: resignationApprovedAt || undefined,
          offboardedBy: user?.id,
          source: 'wizard',
        } satisfies OffboardMeta,
      };
      const saved = (await Api.payroll.createSimplifiedOffboardingSettlement({
        employeeId: employee.employee_id,
        lastWorkingDate: lwd,
        clearance: clearancePayload,
        notes: notes.trim() || undefined,
      })) as SettlementRow;
      if (saved?.id) {
        const full = (await Api.payroll.getFinalSettlement(saved.id)) as SettlementRow;
        setSettlement(full);
        onSettlementChange(full);
      }
      showToast('Settlement saved', 'success');
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    canPayroll,
    readOnly,
    lastWorkingDate,
    reason,
    offboardType,
    resignationFile,
    settlement?.id,
    employee.employee_id,
    resignationSubmittedAt,
    resignationApprovedAt,
    user?.id,
    notes,
    onSettlementChange,
    showToast,
  ]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  if (!canPayroll) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
        Payroll permission is required to run offboarding settlement.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        Loading settlement…
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-4">
        <EmployeeAvatar
          avatarUrl={employee.avatar_url}
          firstName={employee.first_name}
          lastName={employee.last_name}
          className="w-12 h-12"
        />
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{fullName}</p>
          <p className="text-xs text-slate-500">{employee.employee_id}</p>
        </div>
        {settlement ? (
          <StatusLabel status={status} context="settlement" label={settlementStatusLabel(t, status)} />
        ) : (
          <StatusLabel status="NOT_STARTED" context="generic" label={t('offboarding.wizard.notStarted')} semantic="pending" />
        )}
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <LogOut className="w-4 h-4 text-slate-400" aria-hidden />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Exit details</h4>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Exit type</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['resign', 'terminate'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={readOnly || busy}
                  onClick={() => setOffboardType(type)}
                  className={`rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    offboardType === type
                      ? 'border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {type === 'resign' ? 'Resignation' : 'Termination'}
                </button>
              ))}
            </div>
          </div>
          <label className="text-sm sm:col-span-2">
            <span className="text-slate-500">Reason *</span>
            <textarea
              className={`${inputClass} mt-1 w-full min-h-[72px]`}
              value={reason}
              disabled={readOnly || busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-500">Last working date *</span>
            <DatePickerInput
              className={`${inputClass} mt-1 w-full`}
              value={lastWorkingDate}
              disabled={readOnly || busy}
              onChange={(e) => setLastWorkingDate(e.target.value)}
            />
          </label>
          {offboardType === 'resign' && !readOnly ? (
            <label className="text-sm sm:col-span-2">
              <span className="text-slate-500">Resignation letter</span>
              <input
                type="file"
                className={`${inputClass} mt-1 w-full`}
                disabled={busy}
                onChange={(e) => setResignationFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}
        </div>
      </section>

      <label className="text-sm block rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Notes (optional)</span>
        <textarea
          className={`${inputClass} mt-2 w-full min-h-[56px] border-0 bg-transparent p-0 focus:ring-0`}
          value={notes}
          disabled={readOnly || busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes for HR or payroll…"
        />
      </label>

      {readOnly ? (
        <p className="text-sm text-slate-600 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
          Settlement saved · LWD {formatDisplayDate(settlement?.lastWorkingDate)}.
        </p>
      ) : null}
    </div>
  );
});

export default StepSettlement;
