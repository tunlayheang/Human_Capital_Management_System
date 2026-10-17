import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ListPagination } from '../../components/ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import {
  SortableTableHeader,
  SortIcon,
  getSortIconState,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';
import { Check, Lock, Pencil, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
  EmployeeListIdentityCells,
  employeeListIdentityFromPayrollProfile,
} from '../../components/employee/EmployeeListIdentity';
import type { Payslip } from '../../types';
import {
  buildPayrollItemRow,
  hours,
  money,
  signedMoney,
  deductionMoney,
  sumPayrollRows,
  type PayrollItemRow,
} from './payrollItemRows';
import {
  getPayrollEmployeeProfile,
  type PayrollEmployeeProfile,
} from './payrollEmployeeDisplay';
import { resolveDeductionsFromBreakdown } from './payrollDeductionResolve';
import { formatDependentAllowanceUsd } from '../../utils/payrollTaxRate';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { PayrollSimpleRegisterTable } from './PayrollSimpleRegisterTable';
import type { PayrollReviewViewMode } from './payrollReviewFilters';
import {
  formatAttendanceReviewSummary,
  getAttendanceReviewStatusEntries,
} from './payrollAttendanceReviewDisplay';
import type { SalaryBreakdown } from '../../types';

function AttendanceReviewStatusCell({
  breakdown,
  isTotal,
}: {
  breakdown?: SalaryBreakdown;
  isTotal?: boolean;
}) {
  if (isTotal) return null;
  const entries = getAttendanceReviewStatusEntries(breakdown);
  if (!entries.length) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }
  return (
    <div
      className="flex flex-wrap gap-1 max-w-[11rem]"
      title={formatAttendanceReviewSummary(entries)}
    >
      {entries.map((entry) => (
        <StatusLabel
          key={entry.status}
          status={entry.status}
          context="attendance"
          label={`${entry.label} ${entry.count}`}
          size="sm"
        />
      ))}
    </div>
  );
}

function absenceDeductionTooltip(item: Payslip | undefined, row: PayrollItemRow): string | undefined {
  if (!item?.breakdown || row.absences <= 0) return undefined;
  const ded = resolveDeductionsFromBreakdown(item.breakdown);
  const parts: string[] = [];
  if (ded.unpaidLeave > 0) parts.push(`unpaid leave $${ded.unpaidLeave.toFixed(2)}`);
  if (ded.latePenalty > 0) parts.push(`late penalty $${ded.latePenalty.toFixed(2)}`);
  if (parts.length) {
    return `Attendance deductions: ${parts.join(' + ')}. Absent days reduce base pay via proration (not deducted here).`;
  }
  return `Attendance deductions $${row.absences.toFixed(2)}`;
}

type Props = {
  items: Payslip[];
  employeeProfiles: Record<string, PayrollEmployeeProfile>;
  onDownloadPayslip?: (item: Payslip) => void;
  /** Run detail vs dashboard pre-run (shows estimated net, no download). */
  variant?: 'run' | 'preview';
  /**
   * Attendance period is still OPEN — attendance activity (present/absent/leave days,
   * worked hours, review status) and pay outcomes (gross, deductions, net) are NOT final
   * yet, so they are withheld. Contract/schedule reference inputs (basis days, standard
   * hours, hourly/daily rate, contract base, allowances) still show.
   */
  pendingFinalization?: boolean;
  viewMode?: PayrollReviewViewMode;
  showReviewerNotes?: boolean;
  readOnly?: boolean;
  onSaveReviewerNote?: (item: Payslip, note: string) => void;
  /** Preview only: sales keyed by HR employee code (ROC…). */
  salesByEmployeeId?: Record<string, number>;
  onSaveSales?: (item: Payslip, salesAmount: number) => void;
};

const PENDING = <span className="text-slate-400 dark:text-slate-500">—</span>;

const th =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap';
/** Layout-only cell chrome — keep color classes separate so Tailwind utilities do not fight. */
const tdLayout = 'px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm';
const td = `${tdLayout} text-slate-700 dark:text-slate-300`;
const tdNum = `${td} tabular-nums`;
const tdPos = `${tdLayout} tabular-nums text-emerald-600 dark:text-emerald-400`;
const tdNeg = `${tdLayout} tabular-nums text-red-600 dark:text-red-400`;
/** Red styling for nonzero deduction amounts (displayed without a leading minus). */
const tdDed = tdNeg;

/**
 * Sticky ID / Employee widths come from `.hcms-payroll-register-scroll` CSS vars
 * (narrower on phones so the rest of the register stays reachable while scrolling).
 */
const ID_COL =
  'w-[var(--hcms-payroll-id-col,7.5rem)] min-w-[var(--hcms-payroll-id-col,7.5rem)] max-w-[var(--hcms-payroll-id-col,7.5rem)]';
const EMP_COL =
  'w-[var(--hcms-payroll-emp-col,17rem)] min-w-[var(--hcms-payroll-emp-col,17rem)] max-w-[var(--hcms-payroll-emp-col,17rem)]';

const STICKY_ID = `sticky left-0 z-20 box-border overflow-hidden ${ID_COL} px-2 py-1.5 sm:px-3 sm:py-2 border-r border-slate-100 dark:border-slate-700 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]`;
const STICKY_EMPLOYEE = `sticky left-[var(--hcms-payroll-id-col,7.5rem)] z-[21] box-border overflow-hidden ${EMP_COL} px-2 py-1.5 sm:px-3 sm:py-2 border-r border-slate-100 dark:border-slate-700 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]`;
const STICKY_TH_ID = `sticky left-0 hcms-payroll-sticky-corner box-border overflow-hidden ${ID_COL} bg-slate-100 dark:bg-slate-900`;
const STICKY_TH_EMP = `sticky left-[var(--hcms-payroll-id-col,7.5rem)] hcms-payroll-sticky-corner box-border overflow-hidden ${EMP_COL} bg-slate-100 dark:bg-slate-900`;

/** Visual separator between payroll column categories (must match colSpan counts). */
const GROUP_START =
  'border-l-2 border-slate-300/90 dark:border-slate-500/80';

const ATTENDANCE_COLS = 10;
/** Base, transport, meal, attendance, pos, commission, indemnity, back pay, dependents, dep. relief, total. +1 when Sales Target is shown. */
const EARNINGS_COLS = 11;
const OVERTIME_COLS = 4;
const DEDUCTION_COLS = 6;

function groupTh(extra = '') {
  return `${th} ${extra}`.trim();
}

function groupTd(extra = '') {
  return `${extra}`.trim();
}

type PayrollItemsSortCol =
  | 'employeeId'
  | 'employeeName'
  | 'reviewStatus'
  | 'basisDays'
  | 'paidLeave'
  | 'unpaidLeave'
  | 'presentDays'
  | 'absentDays'
  | 'workHrs'
  | 'stdHrs'
  | 'hourlyRate'
  | 'dailyRate'
  | 'base'
  | 'transport'
  | 'meal'
  | 'attendanceBonus'
  | 'position'
  | 'salesTarget'
  | 'commission'
  | 'seniority'
  | 'backPay'
  | 'dependents'
  | 'depRelief'
  | 'allowanceTotal'
  | 'otHrs150'
  | 'otAmt150'
  | 'otHrs200'
  | 'otAmt200'
  | 'gross'
  | 'taxableBase'
  | 'taxRate'
  | 'nssf'
  | 'tax'
  | 'absences'
  | 'deductionsTotal'
  | 'bank'
  | 'reviewerNote'
  | 'net';

function getPayrollItemsSortValue(
  item: Payslip,
  row: PayrollItemRow,
  profile: PayrollEmployeeProfile,
  column: PayrollItemsSortCol,
  salesAmount = 0
): string | number {
  switch (column) {
    case 'employeeId':
      return profile.employeeId || item.employeeId || '';
    case 'employeeName':
      return profile.displayName || row.employeeName;
    case 'reviewStatus':
      return formatAttendanceReviewSummary(getAttendanceReviewStatusEntries(item?.breakdown));
    case 'basisDays':
      return row.payrollBasisDays;
    case 'paidLeave':
      return row.paidLeaveDays;
    case 'unpaidLeave':
      return row.unpaidLeaveDays;
    case 'presentDays':
      return row.presentDays;
    case 'absentDays':
      return row.absentDays;
    case 'workHrs':
      return row.totalWorkHours;
    case 'stdHrs':
      return row.standardHoursPerDay;
    case 'hourlyRate':
      return row.hourlyRate;
    case 'dailyRate':
      return row.dailyRate;
    case 'base':
      return row.base;
    case 'transport':
      return row.transport;
    case 'meal':
      return row.meal;
    case 'attendanceBonus':
      return row.attendanceBonus;
    case 'position':
      return row.position;
    case 'salesTarget':
      return salesAmount;
    case 'commission':
      return row.commission;
    case 'seniority':
      return row.seniorityIndemnity;
    case 'backPay':
      return row.backPayment;
    case 'dependents':
      return row.dependents;
    case 'depRelief':
      return row.dependentRelief;
    case 'allowanceTotal':
      return row.allowanceTotal;
    case 'otHrs150':
      return row.otHours150;
    case 'otAmt150':
      return row.otAmount150;
    case 'otHrs200':
      return row.otHours200;
    case 'otAmt200':
      return row.otAmount200;
    case 'gross':
      return row.gross;
    case 'taxableBase':
      return row.taxableBase;
    case 'taxRate':
      return row.taxRatePct;
    case 'nssf':
      return row.nssf;
    case 'tax':
      return row.tax;
    case 'absences':
      return row.absences;
    case 'deductionsTotal':
      return row.deductionsTotal;
    case 'bank':
      return row.bankDisplay;
    case 'reviewerNote':
      return item.reviewerNote ?? '';
    case 'net':
      return row.net;
    default:
      return '';
  }
}

function sortableLeafTh(extra = '') {
  return groupTh(extra);
}

/** Cell color for signedMoney earnings (+) or signed back-payment adjustments. */
function signedTd(n: number, sign: '+' | '-' | '', extra = ''): string {
  if (n === 0) return groupTd(`${tdNum} ${extra}`);
  if (sign === '+') return groupTd(`${tdPos} ${extra}`);
  if (sign === '-') return groupTd(`${tdNeg} ${extra}`);
  if (n < 0) return groupTd(`${tdNeg} ${extra}`);
  return groupTd(`${tdPos} ${extra}`);
}

function deductionTd(n: number, extra = ''): string {
  if (n === 0) return groupTd(`${tdNum} ${extra}`);
  return groupTd(`${tdDed} ${extra}`);
}

function HeaderGroup({
  label,
  colSpan,
  className = '',
}: {
  label: string;
  colSpan: number;
  className?: string;
}) {
  return (
    <th
      colSpan={colSpan}
      className={`px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-600 ${className}`}
    >
      {label}
    </th>
  );
}

function EmployeeIdentityCells({
  profile,
  isTotal,
  stickyBg,
}: {
  profile: PayrollEmployeeProfile;
  isTotal?: boolean;
  stickyBg: string;
}) {
  const base = employeeListIdentityFromPayrollProfile(profile);
  const job =
    profile.positionTitle && profile.positionTitle !== '—'
      ? profile.positionTitle.trim()
      : '';
  const dept =
    profile.departmentName && profile.departmentName !== '—'
      ? profile.departmentName.trim()
      : '';
  const subtitle = [job, dept].filter(Boolean).join(' · ') || undefined;
  const data = { ...base, subtitle };
  return (
    <EmployeeListIdentityCells
      data={data}
      isTotal={isTotal}
      avatarOnlyOnMobile
      showEmail={false}
      showPhone={false}
      idCellClassName={`${STICKY_ID} ${stickyBg}`}
      identityCellClassName={`${STICKY_EMPLOYEE} ${stickyBg}`}
    />
  );
}

function SalesAmountCell({
  item,
  value,
  onSave,
  readOnly,
}: {
  item: Payslip;
  value: number;
  onSave?: (item: Payslip, salesAmount: number) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(value || ''));
  React.useEffect(() => {
    setDraft(value > 0 ? String(value) : '');
  }, [item.id, item.employeeId, value]);

  if (readOnly || !onSave) {
    return <span className="tabular-nums">{value > 0 ? money(value) : '—'}</span>;
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Number(String(draft).replace(/,/g, ''));
        const normalized = Number.isFinite(next) && next > 0 ? Math.round(next * 100) / 100 : 0;
        if (normalized !== value) onSave(item, normalized);
        setDraft(normalized > 0 ? String(normalized) : '');
      }}
      placeholder="0"
      title="Monthly sales target (USD) for commission rules. $0 or blank = no commission (below threshold)."
      className="w-24 max-w-[6.5rem] rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-base tabular-nums"
      aria-label={`Sales target for ${item.employeeId ?? item.userId}`}
    />
  );
}

function ReviewerNoteCell({
  item,
  readOnly,
  onSave,
}: {
  item: Payslip;
  readOnly?: boolean;
  onSave?: (item: Payslip, note: string) => void;
}) {
  const [draft, setDraft] = React.useState(item.reviewerNote ?? '');
  React.useEffect(() => {
    setDraft(item.reviewerNote ?? '');
  }, [item.id, item.reviewerNote]);

  if (readOnly) {
    return <span className="text-xs text-slate-600 dark:text-slate-400">{draft || '—'}</span>;
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (item.reviewerNote ?? '') && onSave) onSave(item, draft);
      }}
      placeholder="Add review note…"
      className="w-full min-w-[12rem] rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
    />
  );
}

function DataRow({
  row,
  item,
  profile,
  onDownload,
  isTotal,
  showNet,
  showReviewerNotes,
  readOnly,
  onSaveReviewerNote,
  pendingFinalization,
  salesAmount,
  onSaveSales,
  showSales,
  salesEditing,
}: {
  row: PayrollItemRow;
  item?: Payslip;
  profile: PayrollEmployeeProfile;
  onDownload?: () => void;
  isTotal?: boolean;
  showNet?: boolean;
  showReviewerNotes?: boolean;
  readOnly?: boolean;
  onSaveReviewerNote?: (item: Payslip, note: string) => void;
  pendingFinalization?: boolean;
  salesAmount?: number;
  onSaveSales?: (item: Payslip, salesAmount: number) => void;
  showSales?: boolean;
  salesEditing?: boolean;
}) {
  const stickyBg = isTotal
    ? 'bg-slate-100 dark:bg-slate-900'
    : 'bg-white dark:bg-slate-800';
  const attBg = isTotal ? stickyBg : 'bg-blue-50/30 dark:bg-blue-950/15';
      const earnBg = isTotal ? stickyBg : 'bg-emerald-50/40 dark:bg-emerald-950/15';
  const salesBg = isTotal ? stickyBg : 'bg-teal-100/90 dark:bg-teal-950/40';
  const otBg = isTotal ? stickyBg : 'bg-indigo-50/35 dark:bg-indigo-950/15';
  const grossBg = isTotal ? stickyBg : 'bg-slate-100/80 dark:bg-slate-800/80';
  const dedBg = isTotal ? stickyBg : 'bg-red-50/35 dark:bg-red-950/15';
  const stickyCorner = isTotal ? 'hcms-payroll-sticky-footer-corner' : '';

  return (
    <tr
      className={
        isTotal
          ? 'bg-slate-100 dark:bg-slate-900 font-semibold border-t-2 border-slate-200 dark:border-slate-600'
          : 'hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors'
      }
    >
      <EmployeeIdentityCells
        profile={profile}
        isTotal={isTotal}
        stickyBg={`${stickyBg} ${stickyCorner}`}
      />
      <td
        className={groupTd(`${td} ${GROUP_START} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : (() => {
                const entries = getAttendanceReviewStatusEntries(item?.breakdown);
                return entries.length ? formatAttendanceReviewSummary(entries) : undefined;
              })()
        }
      >
        {pendingFinalization && !isTotal ? (
          PENDING
        ) : (
          <AttendanceReviewStatusCell breakdown={item?.breakdown} isTotal={isTotal} />
        )}
      </td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.payrollBasisDays} payroll basis day(s) — salary divisor (independent from roster planning)`
        }
      >
        {isTotal ? '' : row.payrollBasisDays}
      </td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.paidLeaveDays} approved paid leave day(s) (PAID_LEAVE)`
        }
      >
        {isTotal ? '' : pendingFinalization ? PENDING : row.paidLeaveDays}
      </td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.unpaidLeaveDays} approved unpaid leave day(s) (UNPAID_LEAVE)`
        }
      >
        {isTotal ? '' : pendingFinalization ? PENDING : row.unpaidLeaveDays}
      </td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : row.presentDays > 0
              ? `${row.presentDays} present day(s) with clock-in (Attendance module status)`
              : 'No present days recorded in attendance'
        }
      >
        {isTotal ? '' : pendingFinalization ? PENDING : row.presentDays}
      </td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.absentDays} unexcused absent day(s) from Attendance module status (through payroll attendance cutoff)`
        }
      >
        {isTotal ? '' : pendingFinalization ? PENDING : row.absentDays}
      </td>
      <td className={groupTd(`${tdNum} ${attBg}`)}>
        {isTotal ? '' : pendingFinalization ? PENDING : hours(row.totalWorkHours)}
      </td>
      <td className={groupTd(`${tdNum} ${attBg}`)}>
        {isTotal ? '' : hours(row.standardHoursPerDay)}
      </td>
      <td className={groupTd(`${tdNum} ${attBg}`)}>{isTotal ? '' : money(row.hourlyRate)}</td>
      <td
        className={groupTd(`${tdNum} ${attBg}`)}
        title={
          isTotal
            ? undefined
            : row.dailyRate > 0
              ? `Daily rate $${row.dailyRate.toFixed(2)} = contract base ÷ ${row.payrollBasisDays} payroll basis days (hourly $${row.hourlyRate.toFixed(2)} × ${row.standardHoursPerDay}h). Attendance source: Attendance module.`
              : 'Daily rate unavailable — set contract base and payroll basis days'
        }
      >
        {isTotal ? '' : money(row.dailyRate)}
      </td>
      <td
        className={groupTd(`${tdNum} font-medium ${GROUP_START} ${earnBg}`)}
        title={
          isTotal
            ? undefined
            : row.proratedPay > 0 && Math.abs(row.proratedPay - row.base) > 0.02
              ? `Contract base $${row.base.toLocaleString()} (Employee Pay). Prorated pay this period: $${row.proratedPay.toLocaleString()} (${row.totalPaidDays} paid days).`
              : `Monthly contract base from employee salary (Employee Pay step)`
        }
      >
        {money(row.base)}
      </td>
      <td className={signedTd(row.transport, '+', earnBg)}>{signedMoney(row.transport, '+')}</td>
      <td className={signedTd(row.meal, '+', earnBg)}>{signedMoney(row.meal, '+')}</td>
      <td className={signedTd(row.attendanceBonus, '+', earnBg)}>
        {signedMoney(row.attendanceBonus, '+')}
      </td>
      <td className={signedTd(row.position, '+', earnBg)}>{signedMoney(row.position, '+')}</td>
      {showSales ? (
        <td className={groupTd(`${tdNum} ${salesBg}`)}>
          {isTotal || !item ? (
            ''
          ) : (
            <SalesAmountCell
              item={item}
              value={salesAmount ?? 0}
              onSave={onSaveSales}
              readOnly={readOnly || !salesEditing}
            />
          )}
        </td>
      ) : null}
      <td className={signedTd(row.commission, '+', earnBg)}>{signedMoney(row.commission, '+')}</td>
      <td
        className={signedTd(row.seniorityIndemnity, '+', earnBg)}
        title={
          isTotal
            ? undefined
            : (() => {
                const snap = item?.breakdown?.seniorityIndemnitySnapshot as
                  | { formula?: string; paymentKind?: string; ineligibleReason?: string }
                  | undefined;
                if (row.seniorityIndemnity > 0 && snap?.formula) return snap.formula;
                if (snap?.ineligibleReason === 'disabled' || snap?.ineligibleReason === 'no_active_policy') {
                  return 'No active siniority policy — configure and activate under Payroll → Rules → Siniority';
                }
                if (snap?.ineligibleReason === 'not_payout_month') {
                  return 'Legal siniority is paid in June and December only (Payroll → Rules → Siniority)';
                }
                if (snap?.ineligibleReason) return snap.ineligibleReason;
                return 'Semi-annual siniority from an active policy (Payroll → Rules → Siniority)';
              })()
        }
      >
        {row.seniorityIndemnity > 0 ? signedMoney(row.seniorityIndemnity, '+') : money(0)}
      </td>
      <td
        className={signedTd(
          row.backPayment,
          row.backPayment > 0 ? '+' : row.backPayment < 0 ? '-' : '',
          earnBg
        )}
      >
        {row.backPayment !== 0 ? signedMoney(row.backPayment, row.backPayment > 0 ? '+' : '') : money(0)}
      </td>
      <td
        className={groupTd(`${tdNum} ${earnBg}`)}
        title={
          isTotal
            ? undefined
            : row.dependents > 0
              ? `${row.dependents} GDT tax dependent(s) — reduces salary tax (spouse without work + children without paid work, married only)`
              : 'No GDT tax dependents — set Family & dependents on the employee profile (married + children/spouse without paid work)'
        }
      >
        {isTotal ? '' : row.dependents}
      </td>
      <td
        className={
          row.dependentRelief > 0
            ? groupTd(`${tdPos} ${earnBg}`)
            : groupTd(`${tdNum} ${earnBg}`)
        }
        title={
          isTotal
            ? undefined
            : row.dependentRelief > 0
              ? `GDT taxable-base relief: ${row.dependents} × ${formatDependentAllowanceUsd(row.exchangeRate)} = ${money(row.dependentRelief)} off gross before tax (taxable base ${money(row.taxableBase)}) — same as Employee Pay step`
              : row.dependents > 0
                ? 'Dependents recorded but no relief (single employees have 0 GDT dependents)'
                : 'No dependent relief — set Family & dependents on employee profile'
        }
      >
        {/* Display-only: relief reduces taxable base (not an editable earning). Green − shows reduction. */}
        {row.dependentRelief > 0 ? signedMoney(row.dependentRelief, '-') : money(0)}
      </td>
      <td
        className={signedTd(row.allowanceTotal, '+', `font-medium ${earnBg}`)}
        title={
          isTotal
            ? 'Sum of transport, meal, attendance, position allowance, commission, siniority, and back pay (approved prior adjustments)'
            : 'Roll-up of all fixed allowances this period (excludes base salary and overtime)'
        }
      >
        {signedMoney(row.allowanceTotal, '+')}
      </td>
      <td
        className={groupTd(`${tdNum} ${GROUP_START} ${otBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.otHours150} approved hour(s) at 1.5× (weekday / daytime requests)`
        }
      >
        {isTotal ? '' : hours(row.otHours150)}
      </td>
      <td
        className={signedTd(row.otAmount150, '+', otBg)}
        title={
          isTotal
            ? undefined
            : row.otHours150 > 0
              ? `1.5× × $${row.hourlyRate.toFixed(2)}/hr × ${row.otHours150}h`
              : 'No 1.5× pay'
        }
      >
        {signedMoney(row.otAmount150, '+')}
      </td>
      <td
        className={groupTd(`${tdNum} ${otBg}`)}
        title={
          isTotal
            ? undefined
            : `${row.otHours200} approved hour(s) at 2.0× (rest day, holiday, or night requests)`
        }
      >
        {isTotal ? '' : hours(row.otHours200)}
      </td>
      <td
        className={signedTd(row.otAmount200, '+', otBg)}
        title={
          isTotal
            ? undefined
            : row.otHours200 > 0
              ? `2.0× × $${row.hourlyRate.toFixed(2)}/hr × ${row.otHours200}h`
              : 'No 2.0× pay'
        }
      >
        {signedMoney(row.otAmount200, '+')}
      </td>
      <td
        className={groupTd(
          `${tdNum} font-semibold text-slate-900 dark:text-white ${GROUP_START} ${grossBg}`
        )}
      >
        {pendingFinalization ? PENDING : money(row.gross)}
      </td>
      <td
        className={groupTd(`${tdNum} ${GROUP_START} ${dedBg}`)}
        title={
          isTotal
            ? undefined
            : `Gross ${money(row.gross)}${row.dependentRelief > 0 ? ` − relief ${money(row.dependentRelief)}` : ''}`
        }
      >
        {pendingFinalization ? PENDING : money(row.taxableBase)}
      </td>
      <td
        className={groupTd(`${tdNum} ${dedBg}`)}
        title={isTotal ? undefined : `Marginal GDT bracket for taxable base ${money(row.taxableBase)}`}
      >
        {isTotal ? '' : `${row.taxRatePct}%`}
      </td>
      <td
        className={deductionTd(row.nssf, dedBg)}
        title={
          isTotal
            ? undefined
            : row.nssf > 0
              ? 'Employee NSSF (occupational risk + healthcare + pension) on gross × exchange rate, from Payroll Rules'
              : 'No employee NSSF (not enrolled or zero contributory wage)'
        }
      >
        {deductionMoney(row.nssf)}
      </td>
      <td
        className={deductionTd(row.tax, dedBg)}
        title={
          isTotal
            ? undefined
            : row.tax > 0
              ? `GDT ToS on taxable base ${money(row.taxableBase)} (gross ${money(row.gross)}${row.dependentRelief > 0 ? ` − relief ${money(row.dependentRelief)}` : ''})${row.dependents > 0 ? ` · ${row.dependents} dependent(s)` : ''}`
              : 'No salary tax this period'
        }
      >
        {deductionMoney(row.tax)}
      </td>
      <td
        className={deductionTd(row.absences, dedBg)}
        title={isTotal ? undefined : absenceDeductionTooltip(item, row)}
      >
        {deductionMoney(row.absences)}
      </td>
      <td className={deductionTd(row.deductionsTotal, dedBg)}>
        {deductionMoney(row.deductionsTotal)}
      </td>
      {showNet !== false && (
        <td
          className={groupTd(`${td} max-w-[12rem] truncate ${GROUP_START} ${stickyBg}`)}
          title={isTotal ? undefined : row.bankDisplay}
        >
          {isTotal ? '' : row.bankDisplay}
        </td>
      )}
      {showReviewerNotes && (
        <td className={groupTd(`${td} max-w-[14rem] ${GROUP_START} ${stickyBg}`)}>
          {isTotal || !item ? (
            ''
          ) : (
            <ReviewerNoteCell
              item={item}
              readOnly={readOnly}
              onSave={onSaveReviewerNote}
            />
          )}
        </td>
      )}
      {showNet !== false && (
        <td className={`${tdNum} ${stickyBg}`}>
          {pendingFinalization ? (
            isTotal ? (
              PENDING
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                <Lock className="w-3 h-3" /> Pending
              </span>
            )
          ) : (
            <>
              <p className="font-bold text-slate-900 dark:text-white">{money(row.net)}</p>
              {!isTotal && (
                <p className="text-[10px] text-slate-500">~{row.netKhr.toLocaleString()} KHR</p>
              )}
            </>
          )}
        </td>
      )}
      {showNet !== false && (
        <td
          className={`px-3 py-2 w-12 sticky right-0 z-10 border-l border-slate-100 dark:border-slate-700 ${stickyBg} ${stickyCorner}`}
        >
          {!isTotal && item && onDownload && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Download payslip ${profile.employeeId}`}
              onClick={onDownload}
            >
              <Upload className="w-4 h-4" />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

export const PayrollItemsTable: React.FC<Props> = ({
  items,
  employeeProfiles,
  onDownloadPayslip,
  variant = 'run',
  pendingFinalization = false,
  viewMode = 'detailed',
  showReviewerNotes = false,
  readOnly = false,
  onSaveReviewerNote,
  salesByEmployeeId,
  onSaveSales,
}) => {
  const showSales = variant === 'preview' && (onSaveSales != null || salesByEmployeeId != null);
  const [salesEditing, setSalesEditing] = useState(false);
  const canEditSales = showSales && !readOnly && onSaveSales != null;
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<PayrollItemsSortCol>();
  const earningsColSpan = EARNINGS_COLS + (showSales ? 1 : 0);
  const isPreview = variant === 'preview';
  const isPending = isPreview && pendingFinalization;
  const headRow1Ref = useRef<HTMLTableRowElement>(null);
  const [headRow1Height, setHeadRow1Height] = useState(40);
  const isSimple = viewMode === 'simple';

  const sortedItems = useMemo(
    () =>
      isSimple
        ? items
        : sortRowsByColumn(items, sortBy, sortOrder, (item, column) => {
            const profile = getPayrollEmployeeProfile(
              item.userId,
              employeeProfiles,
              item.employeeId,
              item.breakdown?.reviewSnapshot
            );
            const row = buildPayrollItemRow(item, profile);
            const sales = item.employeeId ? salesByEmployeeId?.[item.employeeId] ?? 0 : 0;
            return getPayrollItemsSortValue(item, row, profile, column, sales);
          }),
    [isSimple, items, sortBy, sortOrder, employeeProfiles, salesByEmployeeId]
  );

  const {
    pageItems: pagedItems,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sortedItems,
    undefined,
    `${sortedItems.length}-${sortBy ?? ''}-${sortOrder}`
  );

  const rows = useMemo(
    () =>
      isSimple
        ? []
        : items.map((item) =>
            buildPayrollItemRow(
              item,
              getPayrollEmployeeProfile(
                item.userId,
                employeeProfiles,
                item.employeeId,
                item.breakdown?.reviewSnapshot
              )
            )
          ),
    [isSimple, items, employeeProfiles]
  );
  const totals = useMemo(() => sumPayrollRows(rows), [rows]);

  useLayoutEffect(() => {
    if (isSimple) return;
    const el = headRow1Ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setHeadRow1Height(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isSimple, showSales, showReviewerNotes, isPreview, earningsColSpan]);

  if (isSimple) {
    return (
      <PayrollSimpleRegisterTable
        items={items}
        employeeProfiles={employeeProfiles}
        pendingFinalization={pendingFinalization}
        showReviewerNotes={showReviewerNotes}
        readOnly={readOnly}
        onSaveReviewerNote={onSaveReviewerNote}
        salesByEmployeeId={salesByEmployeeId}
        onSaveSales={onSaveSales}
      />
    );
  }

  if (items.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-slate-500">No payroll items for this run.</p>
    );
  }

  const totalsProfile: PayrollEmployeeProfile = {
    userId: '',
    employeeId: '',
    firstName: 'TOTALS',
    lastName: '',
    email: '',
    phone: '',
    displayName: 'TOTALS',
    positionTitle: '',
    bankName: null,
    bankAccountNumber: null,
    paymentMethod: 'bank',
    departmentId: '',
    departmentName: '',
    taxId: '',
    nssfId: '',
  };

  return (
    <>
      {isPending && (
        <div className="px-5 py-3 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/20">
          <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold">Pending attendance finalization.</span>{' '}
              Attendance data (present, absent, leave days, worked hours) and gross/estimated
              net pay are withheld until attendance for this period is finalized. Contract
              reference values (basis days, rates, allowances) and current deduction estimates
              are still shown; figures may change after finalization.
            </p>
          </div>
        </div>
      )}
      <div
        className="hcms-table-scroll hcms-payroll-register-scroll custom-scrollbar"
        style={
          {
            ['--hcms-payroll-thead-row1' as string]: `${headRow1Height}px`,
          } as React.CSSProperties
        }
      >
        <table className="min-w-[1860px] w-full text-sm border-separate border-spacing-0">
          <colgroup>
            <col style={{ width: 'var(--hcms-payroll-id-col, 7.5rem)' }} />
            <col style={{ width: 'var(--hcms-payroll-emp-col, 17rem)' }} />
          </colgroup>
          <thead>
            <tr ref={headRow1Ref} className="bg-slate-100 dark:bg-slate-900">
              <SortableTableHeader
                label="ID"
                column="employeeId"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                rowSpan={2}
                className={`${th} ${STICKY_TH_ID}`}
              />
              <SortableTableHeader
                label="Employee"
                column="employeeName"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                rowSpan={2}
                className={`${th} ${STICKY_TH_EMP}`}
              />
              <HeaderGroup
                label="Attendance (period)"
                colSpan={ATTENDANCE_COLS}
                className={`${GROUP_START} text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950`}
              />
              <HeaderGroup
                label="Earnings (USD)"
                colSpan={earningsColSpan}
                className={`${GROUP_START} text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950`}
              />
              <HeaderGroup
                label="Overtime"
                colSpan={OVERTIME_COLS}
                className={`${GROUP_START} text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950`}
              />
              <SortableTableHeader
                label="Gross"
                column="gross"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                rowSpan={2}
                className={`${th} ${GROUP_START} text-slate-800 dark:text-slate-100 bg-slate-200 dark:bg-slate-800`}
              />
              <HeaderGroup
                label="Deductions (USD)"
                colSpan={DEDUCTION_COLS}
                className={`${GROUP_START} text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950`}
              />
              <SortableTableHeader
                label="Bank / payment"
                column="bank"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                rowSpan={2}
                className={`${th} ${GROUP_START} text-slate-800 dark:text-slate-100 bg-slate-200 dark:bg-slate-800`}
              />
              {showReviewerNotes && (
                <SortableTableHeader
                  label="Reviewer note"
                  column="reviewerNote"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  rowSpan={2}
                  className={`${th} ${GROUP_START} text-violet-800 dark:text-violet-200 bg-violet-50 dark:bg-violet-950`}
                />
              )}
              <SortableTableHeader
                label={isPreview ? 'Est. net pay' : 'Net pay'}
                column="net"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                rowSpan={2}
                className={`${th} ${GROUP_START} text-slate-800 dark:text-slate-100 bg-slate-200 dark:bg-slate-800`}
              />
              {!isPreview && (
                <th
                  rowSpan={2}
                  className={`${th} sticky right-0 hcms-payroll-sticky-corner bg-slate-100 dark:bg-slate-900 w-12`}
                />
              )}
            </tr>
            <tr className="bg-slate-50 dark:bg-slate-900">
              <SortableTableHeader
                label="Review status"
                column="reviewStatus"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh(`${GROUP_START} bg-blue-50 dark:bg-blue-950`)}
                title="Attendance module statuses for review: day off, late, leave, awaiting clock-in (excludes present and unexcused absent)"
              />
              <SortableTableHeader
                label="Basis days"
                column="basisDays"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="Contractual payroll basis days used as salary divisor (22, 24, or 26)"
              />
              <SortableTableHeader
                label="Paid leave"
                column="paidLeave"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="Approved paid leave (PAID_LEAVE status)"
              />
              <SortableTableHeader
                label="Unpaid leave"
                column="unpaidLeave"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="Approved unpaid leave (UNPAID_LEAVE status)"
              />
              <SortableTableHeader
                label="Present days"
                column="presentDays"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="PRESENT/LATE with clock-in only (excludes leave statuses)"
              />
              <SortableTableHeader
                label="Absent days"
                column="absentDays"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="Unexcused ABSENT only (excludes unpaid leave days)"
              />
              <SortableTableHeader
                label="Work hrs"
                column="workHrs"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
              />
              <SortableTableHeader
                label="Std hrs/day"
                column="stdHrs"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
              />
              <SortableTableHeader
                label="Hourly rate"
                column="hourlyRate"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
              />
              <SortableTableHeader
                label="Daily rate"
                column="dailyRate"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-blue-50 dark:bg-blue-950')}
                title="Contract monthly base ÷ scheduled work days — reference daily rate (absent days reduce pay via proration)"
              />
              <SortableTableHeader
                label="Base"
                column="base"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh(`${GROUP_START} bg-emerald-50 dark:bg-emerald-950`)}
              />
              <SortableTableHeader
                label="Transport"
                column="transport"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
              />
              <SortableTableHeader
                label="Meal"
                column="meal"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
              />
              <SortableTableHeader
                label="Attendance"
                column="attendanceBonus"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
              />
              <SortableTableHeader
                label="Pos. allow."
                column="position"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
              />
              {showSales ? (
                <th
                  className={groupTh('bg-teal-100 dark:bg-teal-950')}
                  title="Monthly sales target (USD) for commission rules. $0 or blank = no commission."
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('salesTarget')}
                    className="inline-flex items-center max-w-full font-semibold hover:text-primary-600 dark:hover:text-primary-400 normal-case tracking-normal"
                  >
                    <div className="flex items-center gap-1">
                      {canEditSales ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSalesEditing((v) => !v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              setSalesEditing((v) => !v);
                            }
                          }}
                          title={salesEditing ? 'Done editing' : 'Edit sales targets'}
                          aria-label={
                            salesEditing ? 'Done editing sales targets' : 'Edit sales targets'
                          }
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-teal-400/90 bg-white text-teal-800 hover:bg-teal-50 dark:border-teal-600 dark:bg-slate-900/70 dark:text-teal-200 dark:hover:bg-teal-950/60"
                        >
                          {salesEditing ? (
                            <Check className="h-3 w-3" aria-hidden />
                          ) : (
                            <Pencil className="h-3 w-3" aria-hidden />
                          )}
                        </span>
                      ) : null}
                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        Sales Target
                      </span>
                    </div>
                    <SortIcon state={getSortIconState(sortBy, sortOrder, 'salesTarget')} />
                  </button>
                </th>
              ) : null}
              <SortableTableHeader
                label="Commission"
                column="commission"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
              />
              <SortableTableHeader
                label="Siniority"
                column="seniority"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
                title="Semi-annual siniority (Art. 89) — pays in June and December only when an active policy exists under Payroll → Rules → Siniority. Other months stay $0."
              />
              <SortableTableHeader
                label="Back pay"
                column="backPay"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
                title="Approved payroll adjustments from prior locked months (month earlier than this preview), not yet applied. Same-month adjustments and OT after cutoff do not appear here."
              />
              <SortableTableHeader
                label="Dependents"
                column="dependents"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
                title="GDT tax dependents (married + non-working spouse/children)"
              />
              <SortableTableHeader
                label="Dep. relief"
                column="depRelief"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950')}
                title="150,000 KHR per dependent ÷ FX — reduces taxable salary before ToS (Employee Pay step)"
              />
              <SortableTableHeader
                label="Total Allowance and Relief"
                column="allowanceTotal"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-emerald-50 dark:bg-emerald-950 font-semibold')}
                title="Roll-up of transport, meal, attendance, position allowance, commission, siniority, and back pay"
              />
              <SortableTableHeader
                label="Hrs 1.5×"
                column="otHrs150"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh(`${GROUP_START} bg-indigo-50 dark:bg-indigo-950`)}
              />
              <SortableTableHeader
                label="$ 1.5×"
                column="otAmt150"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-indigo-50 dark:bg-indigo-950')}
              />
              <SortableTableHeader
                label="Hrs 2.0×"
                column="otHrs200"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-indigo-50 dark:bg-indigo-950')}
              />
              <SortableTableHeader
                label="$ 2.0×"
                column="otAmt200"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-indigo-50 dark:bg-indigo-950')}
              />
              <SortableTableHeader
                label="Taxable base"
                column="taxableBase"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh(`${GROUP_START} bg-red-50 dark:bg-red-950`)}
              />
              <SortableTableHeader
                label="Tax rate"
                column="taxRate"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-red-50 dark:bg-red-950')}
              />
              <SortableTableHeader
                label="NSSF (emp.)"
                column="nssf"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-red-50 dark:bg-red-950')}
              />
              <SortableTableHeader
                label="Tax (ToS)"
                column="tax"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-red-50 dark:bg-red-950')}
              />
              <SortableTableHeader
                label="Absences"
                column="absences"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-red-50 dark:bg-red-950')}
              />
              <SortableTableHeader
                label="Total ded."
                column="deductionsTotal"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={sortableLeafTh('bg-red-50 dark:bg-red-950')}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
            {pagedItems.map((item) => {
              const profile = getPayrollEmployeeProfile(
                item.userId,
                employeeProfiles,
                item.employeeId,
                item.breakdown?.reviewSnapshot
              );
              return (
                <DataRow
                  key={item.id}
                  row={buildPayrollItemRow(item, profile)}
                  profile={profile}
                  item={item}
                  showNet
                  showReviewerNotes={showReviewerNotes}
                  readOnly={readOnly}
                  onSaveReviewerNote={onSaveReviewerNote}
                  pendingFinalization={isPending}
                  onDownload={onDownloadPayslip ? () => onDownloadPayslip(item) : undefined}
                  showSales={showSales}
                  salesAmount={
                    item.employeeId ? salesByEmployeeId?.[item.employeeId] ?? 0 : 0
                  }
                  onSaveSales={onSaveSales}
                  salesEditing={salesEditing}
                />
              );
            })}
          </tbody>
          <tfoot>
            <DataRow
              row={totals}
              profile={totalsProfile}
              isTotal
              showNet
              showReviewerNotes={showReviewerNotes}
              pendingFinalization={isPending}
              showSales={showSales}
            />
          </tfoot>
        </table>
      </div>
      <ListPagination
        from={showingFrom}
        to={showingTo}
        total={totalCount}
        itemLabel="employees"
        currentPage={currentPage}
        totalPages={totalPages}
        pagesWindow={pagesWindow}
        onPageChange={setCurrentPage}
      />
      {!isPreview ? (
        <p className="px-5 py-2 text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-700">
          Scroll horizontally to view all calculation columns →
        </p>
      ) : null}
    </>
  );
};
