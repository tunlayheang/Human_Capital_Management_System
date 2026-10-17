import React, { useMemo } from 'react';
import type { PayrollCalendarCycleConfig, PayrollCycleDefinition } from '../../types';
import { inputClass } from '../../constants/designSystem';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { getGroupConfig, syncGroupCyclePeriodBounds } from './payrollCalendarCycleUtils';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type CycleRow = {
  month: string;
  label: string;
  monthIndex: number;
  cycle?: PayrollCycleDefinition;
};

type CycleSortCol =
  | 'month'
  | 'payPeriod'
  | 'attendanceCutoff'
  | 'calculation'
  | 'approval'
  | 'payment';

const cycleThClass =
  'px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap';

type Props = {
  year: number;
  groupId: string;
  cycleConfig: PayrollCalendarCycleConfig;
  canEdit: boolean;
  onChange: (next: PayrollCalendarCycleConfig) => void;
};

function updateCycle(
  config: PayrollCalendarCycleConfig,
  year: number,
  groupId: string,
  month: string,
  patch: Partial<PayrollCycleDefinition>
): PayrollCalendarCycleConfig {
  const cyclesByGroup = { ...config.cyclesByGroup };
  const groupCycles = { ...(cyclesByGroup[groupId] ?? {}) };
  groupCycles[month] = { ...groupCycles[month], month, ...patch } as PayrollCycleDefinition;
  const group = getGroupConfig(config, groupId);
  cyclesByGroup[groupId] = syncGroupCyclePeriodBounds(year, group, groupCycles);
  return { ...config, cyclesByGroup };
}

export const PayrollCalendarCycleTable: React.FC<Props> = ({
  year,
  groupId,
  cycleConfig,
  canEdit,
  onChange,
}) => {
  const cycles = cycleConfig.cyclesByGroup[groupId] ?? {};
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<CycleSortCol>();

  const cycleRows = useMemo<CycleRow[]>(
    () =>
      MONTH_FULL.map((label, i) => {
        const month = `${year}-${String(i + 1).padStart(2, '0')}`;
        return {
          month,
          label,
          monthIndex: i,
          cycle: cycles[month],
        };
      }),
    [cycles, year]
  );

  const sortedCycleRows = useMemo(() => {
    const getSortValue = (row: CycleRow, col: CycleSortCol): string | number => {
      const c = row.cycle;
      switch (col) {
        case 'month':
          return row.monthIndex;
        case 'payPeriod':
          return c?.periodStart?.slice(0, 10) ?? '';
        case 'attendanceCutoff':
          return c?.attendanceCutoffDate?.slice(0, 10) ?? '';
        case 'calculation':
          return c?.payrollCalculationDate?.slice(0, 10) ?? '';
        case 'approval':
          return c?.payrollApprovalDate?.slice(0, 10) ?? '';
        case 'payment':
          return c?.paymentDate?.slice(0, 10) ?? '';
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: CycleRow[]) => rows.sort((a, b) => a.monthIndex - b.monthIndex);
    return sortRowsByColumn(cycleRows, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [cycleRows, sortBy, sortOrder]);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/80 text-left">
          <tr>
            <SortableTableHeader
              label="Month"
              column="month"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
            <SortableTableHeader
              label="Pay period"
              column="payPeriod"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
            <SortableTableHeader
              label="Attendance cutoff"
              column="attendanceCutoff"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
            <SortableTableHeader
              label="Calculation"
              column="calculation"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
            <SortableTableHeader
              label="Approval"
              column="approval"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
            <SortableTableHeader
              label="Payment"
              column="payment"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={cycleThClass}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {sortedCycleRows.map(({ month, label, cycle: c }) => {
            if (!c) {
              return (
                <tr key={month}>
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                    {label}
                  </td>
                  <td colSpan={5} className="px-3 py-2 text-slate-400 text-xs">
                    No cycle configured
                  </td>
                </tr>
              );
            }
            const field = (key: keyof PayrollCycleDefinition, value: string) =>
              canEdit ? (
                <DatePickerInput className={inputClass + ' h-9 min-w-[8.5rem]'}
                  value={value?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    onChange(updateCycle(cycleConfig, year, groupId, month, { [key]: e.target.value }))
                  }
                />
              ) : (
                <span className="tabular-nums text-slate-700 dark:text-slate-300">
                  {value?.slice(0, 10)}
                </span>
              );

            return (
              <tr key={month} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                  {label}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                  {c.periodStart?.slice(0, 10)} → {c.periodEnd?.slice(0, 10)}
                </td>
                <td className="px-3 py-2">{field('attendanceCutoffDate', c.attendanceCutoffDate)}</td>
                <td className="px-3 py-2">
                  {field('payrollCalculationDate', c.payrollCalculationDate)}
                </td>
                <td className="px-3 py-2">{field('payrollApprovalDate', c.payrollApprovalDate)}</td>
                <td className="px-3 py-2">{field('paymentDate', c.paymentDate ?? '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
