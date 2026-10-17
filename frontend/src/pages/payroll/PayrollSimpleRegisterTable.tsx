import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import type { Payslip } from '../../types';
import {
  buildPayrollItemRow,
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
import {
  EmployeeListIdentityCells,
  employeeListIdentityFromPayrollProfile,
} from '../../components/employee/EmployeeListIdentity';
import { employmentFlagLabel, formatNetDelta, paymentStatusLabel } from './payrollReviewFilters';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { ListPagination } from '../../components/ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import {
  SortableTableHeader,
  SortIcon,
  getSortIconState,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';

type Props = {
  items: Payslip[];
  employeeProfiles: Record<string, PayrollEmployeeProfile>;
  pendingFinalization?: boolean;
  showReviewerNotes?: boolean;
  readOnly?: boolean;
  onSaveReviewerNote?: (item: Payslip, note: string) => void;
  salesByEmployeeId?: Record<string, number>;
  onSaveSales?: (item: Payslip, salesAmount: number) => void;
};

const th =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap';

type SimpleRegisterSortCol =
  | 'employeeId'
  | 'employeeName'
  | 'jobTitle'
  | 'department'
  | 'base'
  | 'proratedPay'
  | 'payableDays'
  | 'flags'
  | 'salesTarget'
  | 'allowance'
  | 'ot'
  | 'gross'
  | 'taxable'
  | 'taxPct'
  | 'nssfEmp'
  | 'nssfEmpl'
  | 'tax'
  | 'otherDed'
  | 'priorNet'
  | 'netDelta'
  | 'fx'
  | 'nssfId'
  | 'taxId'
  | 'nssfWage'
  | 'emplCost'
  | 'payStatus'
  | 'net'
  | 'bank'
  | 'reviewerNote';

function getSimpleRegisterSortValue(
  row: PayrollItemRow,
  profile: PayrollEmployeeProfile,
  column: SimpleRegisterSortCol,
  salesAmount = 0,
  reviewerNote = ''
): string | number {
  switch (column) {
    case 'employeeId':
      return profile.employeeId || row.id;
    case 'employeeName':
      return profile.displayName || row.employeeName;
    case 'jobTitle':
      return row.jobTitle;
    case 'department':
      return row.departmentName;
    case 'base':
      return row.base;
    case 'proratedPay':
      return row.proratedPay;
    case 'payableDays':
      return row.prorationLabel;
    case 'flags':
      return row.employmentFlags.map(employmentFlagLabel).join(', ');
    case 'salesTarget':
      return salesAmount;
    case 'allowance':
      return row.allowanceTotal;
    case 'ot':
      return row.otTotal;
    case 'gross':
      return row.gross;
    case 'taxable':
      return row.taxableBase;
    case 'taxPct':
      return row.taxRatePct;
    case 'nssfEmp':
      return row.nssf;
    case 'nssfEmpl':
      return row.employerNssf;
    case 'tax':
      return row.tax;
    case 'otherDed':
      return row.otherDeductions;
    case 'priorNet':
      return row.priorMonthNetUsd ?? -1;
    case 'netDelta':
      return row.netChangeVsPriorMonthUsd ?? -1;
    case 'fx':
      return row.exchangeRate;
    case 'nssfId':
      return row.nssfId;
    case 'taxId':
      return row.taxId;
    case 'nssfWage':
      return row.nssfAssumedWageKhr ?? -1;
    case 'emplCost':
      return row.totalEmployerCostUsd;
    case 'payStatus':
      return row.paymentStatus ? paymentStatusLabel(row.paymentStatus) : '';
    case 'net':
      return row.net;
    case 'bank':
      return row.bankDisplay;
    case 'reviewerNote':
      return reviewerNote;
    default:
      return '';
  }
}

const tdLayout = 'px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm';
const td = `${tdLayout} text-slate-700 dark:text-slate-300 tabular-nums`;
const tdNeg = `${tdLayout} tabular-nums text-red-600 dark:text-red-400`;

/** Red for nonzero deduction amounts (shown without a leading minus). */
function deductionTdClass(n: number): string {
  return n !== 0 ? tdNeg : td;
}
function EmploymentFlags({ flags }: { flags: PayrollItemRow['employmentFlags'] }) {
  if (!flags.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1 max-w-[10rem]">
      {flags.map((f) => (
        <Badge key={f} variant={f === 'final_settlement_overlap' ? 'warning' : 'info'}>
          {employmentFlagLabel(f)}
        </Badge>
      ))}
    </div>
  );
}

function SimpleSalesInput({
  item,
  value,
  onSave,
}: {
  item: Payslip;
  value: number;
  onSave: (item: Payslip, salesAmount: number) => void;
}) {
  const [draft, setDraft] = useState(value > 0 ? String(value) : '');
  useEffect(() => {
    setDraft(value > 0 ? String(value) : '');
  }, [item.id, item.employeeId, value]);
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
      title="Monthly sales target (USD) for commission rules. $0 or blank = no commission."
      className="w-24 max-w-[6.5rem] rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-base tabular-nums"
      aria-label={`Sales target for ${item.employeeId ?? item.userId}`}
    />
  );
}

export const PayrollSimpleRegisterTable: React.FC<Props> = ({
  items,
  employeeProfiles,
  pendingFinalization,
  showReviewerNotes,
  readOnly,
  onSaveReviewerNote,
  salesByEmployeeId,
  onSaveSales,
}) => {
  const showSales = onSaveSales != null || salesByEmployeeId != null;
  const [salesEditing, setSalesEditing] = useState(false);
  const canEditSales = showSales && !readOnly && onSaveSales != null;
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<SimpleRegisterSortCol>();

  const profileFor = (item: Payslip) =>
    getPayrollEmployeeProfile(
      item.userId,
      employeeProfiles,
      item.employeeId,
      item.breakdown?.reviewSnapshot
    );

  const sortedItems = useMemo(
    () =>
      sortRowsByColumn(items, sortBy, sortOrder, (item, column) => {
        const profile = profileFor(item);
        const row = buildPayrollItemRow(item, profile);
        const sales =
          item.employeeId ? salesByEmployeeId?.[item.employeeId] ?? 0 : 0;
        return getSimpleRegisterSortValue(row, profile, column, sales, item.reviewerNote ?? '');
      }),
    [items, sortBy, sortOrder, employeeProfiles, salesByEmployeeId]
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
  } = useClientPagination(sortedItems, 25, `${sortedItems.length}-${sortBy ?? ''}-${sortOrder}`);

  const rows = pagedItems.map((item) => buildPayrollItemRow(item, profileFor(item)));
  const totals = sumPayrollRows(items.map((item) => buildPayrollItemRow(item, profileFor(item))));

  const headerCols: Array<{
    label: string;
    column?: SimpleRegisterSortCol;
    className?: string;
    title?: string;
    custom?: React.ReactNode;
  }> = [
    { label: '#' },
    { label: 'ID', column: 'employeeId' },
    { label: 'Employee', column: 'employeeName' },
    { label: 'Job title', column: 'jobTitle' },
    { label: 'Dept', column: 'department' },
    { label: 'Base', column: 'base' },
    { label: 'Prorated pay', column: 'proratedPay' },
    { label: 'Payable days', column: 'payableDays' },
    { label: 'Flags', column: 'flags' },
    ...(showSales
      ? [
          {
            label: 'Sales Target',
            column: 'salesTarget' as const,
            className: `${th} bg-teal-100 dark:bg-teal-950/50`,
            title:
              'Monthly sales target (USD) for commission rules. $0 or blank = no commission.',
            custom: (
              <div className="flex items-center gap-1 normal-case tracking-normal">
                {canEditSales ? (
                  <button
                    type="button"
                    onClick={() => setSalesEditing((v) => !v)}
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
                  </button>
                ) : null}
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  Sales Target
                </span>
              </div>
            ),
          },
        ]
      : []),
    { label: 'Allowance', column: 'allowance' },
    { label: 'OT', column: 'ot' },
    { label: 'Gross', column: 'gross' },
    { label: 'Taxable', column: 'taxable' },
    { label: 'Tax %', column: 'taxPct' },
    { label: 'NSSF (emp.)', column: 'nssfEmp' },
    { label: 'NSSF (empl.)', column: 'nssfEmpl' },
    { label: 'Tax', column: 'tax' },
    { label: 'Other ded.', column: 'otherDed' },
    { label: 'Prior net', column: 'priorNet' },
    { label: 'Δ vs prior', column: 'netDelta' },
    { label: 'FX', column: 'fx' },
    { label: 'NSSF ID', column: 'nssfId' },
    { label: 'Tax ID', column: 'taxId' },
    { label: 'NSSF wage', column: 'nssfWage' },
    { label: 'Empl. cost', column: 'emplCost' },
    { label: 'Pay status', column: 'payStatus' },
    { label: 'Net', column: 'net' },
    { label: 'Bank', column: 'bank' },
    ...(showReviewerNotes ? [{ label: 'Reviewer note', column: 'reviewerNote' as const }] : []),
  ];

  return (
    <>
      <div className="hcms-table-scroll hcms-payroll-register-scroll custom-scrollbar">
        <table className="min-w-[2200px] w-full text-sm border-separate border-spacing-0">
          <thead className="bg-slate-100 dark:bg-slate-900">
            <tr>
              {headerCols.map((h) =>
                h.column ? (
                  h.custom ? (
                    <th
                      key={h.column}
                      className={h.className ?? th}
                      title={h.title}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(h.column!)}
                        className="inline-flex items-center max-w-full font-semibold hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        {h.custom}
                        <SortIcon state={getSortIconState(sortBy, sortOrder, h.column!)} />
                      </button>
                    </th>
                  ) : (
                    <SortableTableHeader
                      key={h.column}
                      label={h.label}
                      column={h.column}
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onToggle={toggleSort}
                      className={h.className ?? th}
                      title={h.title}
                    />
                  )
                ) : (
                  <th key={h.label} className={th}>
                    {h.label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/80">
            {pagedItems.map((item, idx) => {
              const profile = profileFor(item);
              const row = rows[idx]!;
              return (
                <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className={td}>{showingFrom + idx}</td>
                  <EmployeeListIdentityCells
                    data={employeeListIdentityFromPayrollProfile(profile)}
                    avatarOnlyOnMobile
                    showEmail={false}
                    showPhone={false}
                    idCellClassName={td}
                    identityCellClassName={`${td} w-[2.75rem] min-w-[2.75rem] max-w-[2.75rem] sm:w-auto sm:min-w-[14rem] sm:max-w-none`}
                  />
                  <td className={td}>{row.jobTitle}</td>
                  <td className={td}>{row.departmentName}</td>
                  <td className={td}>{money(row.base)}</td>
                  <td className={td}>{money(row.proratedPay)}</td>
                  <td className={td}>{row.prorationLabel}</td>
                  <td className={td}>
                    <EmploymentFlags flags={row.employmentFlags} />
                  </td>
                  {showSales ? (
                    <td className={`${td} bg-teal-100/90 dark:bg-teal-950/40`}>
                      {readOnly || !onSaveSales || !salesEditing ? (
                        (() => {
                          const v = item.employeeId
                            ? salesByEmployeeId?.[item.employeeId] ?? 0
                            : 0;
                          return v > 0 ? money(v) : '—';
                        })()
                      ) : (
                        <SimpleSalesInput
                          item={item}
                          value={
                            item.employeeId ? salesByEmployeeId?.[item.employeeId] ?? 0 : 0
                          }
                          onSave={onSaveSales}
                        />
                      )}
                    </td>
                  ) : null}
                  <td className={td}>{signedMoney(row.allowanceTotal, '+')}</td>
                  <td className={td}>{signedMoney(row.otTotal, '+')}</td>
                  <td className={`${td} font-semibold`}>
                    {pendingFinalization ? '—' : money(row.gross)}
                  </td>
                  <td className={td}>{money(row.taxableBase)}</td>
                  <td className={td}>{row.taxRatePct}%</td>
                  <td className={deductionTdClass(row.nssf)}>{deductionMoney(row.nssf)}</td>
                  <td className={td}>{money(row.employerNssf)}</td>
                  <td className={deductionTdClass(row.tax)}>{deductionMoney(row.tax)}</td>
                  <td className={deductionTdClass(row.otherDeductions)}>
                    {deductionMoney(row.otherDeductions)}
                  </td>
                  <td className={td}>
                    {row.priorMonthNetUsd != null ? money(row.priorMonthNetUsd) : '—'}
                  </td>
                  <td className={td}>
                    {formatNetDelta(row.netChangeVsPriorMonthUsd, row.netChangeVsPriorMonthPct)}
                  </td>
                  <td className={td}>{row.exchangeRate.toLocaleString()}</td>
                  <td className={td}>{row.nssfId}</td>
                  <td className={td}>{row.taxId}</td>
                  <td className={td}>
                    {row.nssfAssumedWageKhr != null
                      ? `${row.nssfAssumedWageKhr.toLocaleString()} KHR`
                      : '—'}
                  </td>
                  <td className={td}>{money(row.totalEmployerCostUsd)}</td>
                  <td className={td}>
                    {row.paymentStatus ? (
                      <StatusLabel
                        status={row.paymentStatus}
                        context="payroll_payment"
                        label={paymentStatusLabel(row.paymentStatus)}
                        size="sm"
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${td} font-bold`}>
                    {pendingFinalization ? '—' : money(row.net)}
                  </td>
                  <td className={`${td} max-w-[12rem] truncate`} title={row.bankDisplay}>
                    {row.bankDisplay}
                  </td>
                  {showReviewerNotes && (
                    <td className={`${td} min-w-[14rem]`}>
                      <ReviewerNoteCell
                        item={item}
                        readOnly={readOnly}
                        onSave={onSaveReviewerNote}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 dark:bg-slate-900 font-semibold">
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} colSpan={9}>
                TOTALS
              </td>
              {showSales ? <td className={`${td} bg-slate-100 dark:bg-slate-900`} /> : null}
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{signedMoney(totals.allowanceTotal, '+')}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{signedMoney(totals.otTotal, '+')}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{money(totals.gross)}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} colSpan={2} />
              <td className={`${deductionTdClass(totals.nssf)} bg-slate-100 dark:bg-slate-900`}>{deductionMoney(totals.nssf)}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{money(totals.employerNssf)}</td>
              <td className={`${deductionTdClass(totals.tax)} bg-slate-100 dark:bg-slate-900`}>{deductionMoney(totals.tax)}</td>
              <td className={`${deductionTdClass(totals.otherDeductions)} bg-slate-100 dark:bg-slate-900`}>
                {deductionMoney(totals.otherDeductions)}
              </td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} colSpan={2} />
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} />
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} colSpan={2} />
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} />
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{money(totals.totalEmployerCostUsd)}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} />
              <td className={`${td} bg-slate-100 dark:bg-slate-900`}>{money(totals.net)}</td>
              <td className={`${td} bg-slate-100 dark:bg-slate-900`} />
              {showReviewerNotes && <td className={`${td} bg-slate-100 dark:bg-slate-900`} />}
            </tr>
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
    </>
  );
};

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
