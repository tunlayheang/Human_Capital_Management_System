import React, { useMemo } from 'react';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/common/LoadingState';
import type { PayrollNssfWageBracket } from '../../types';
import { formatNssfWageRange } from '../../utils/nssfAssumedWage';
import { inputClass } from '../../constants/designSystem';
import { NumericField } from '../../components/ui/NumericField';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import {
  displayValueToKhrStorage,
  formatNssfWageRangeDisplay,
  formatRulesAmountFromKhr,
  khrStorageToDisplayValue,
  PAYROLL_OPEN_ENDED_MAX_KHR,
} from '../../utils/payrollRulesCurrency';
import { UsdMirrorField } from './UsdMirrorField';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type NssfWageSortCol = 'level' | 'wageMinKhr' | 'wageMaxKhr' | 'assumedWageKhr';

const nssfWageThClass =
  'py-2 pr-2 text-left text-[10px] font-semibold uppercase text-slate-500';

type Props = {
  mode: 'edit' | 'view';
  loading: boolean;
  brackets: PayrollNssfWageBracket[];
  onChange: (brackets: PayrollNssfWageBracket[]) => void;
  headerActions?: React.ReactNode;
};

function parseKhrInput(raw: string, fallback: number): number {
  return displayValueToKhrStorage(raw, 'KHR', 1, fallback);
}

function updateRow(
  brackets: PayrollNssfWageBracket[],
  index: number,
  field: keyof PayrollNssfWageBracket,
  raw: string
): PayrollNssfWageBracket[] {
  const next = [...brackets];
  const row = { ...next[index] };
  if (field === 'level') {
    row.level = Number(raw) || 0;
  } else if (field === 'wageMaxKhr') {
    if (!raw) {
      row.wageMaxKhr = null;
    } else {
      const khr = parseKhrInput(raw, row.wageMaxKhr ?? 0);
      row.wageMaxKhr = khr >= PAYROLL_OPEN_ENDED_MAX_KHR ? null : khr;
    }
  } else if (field === 'wageMinKhr') {
    row.wageMinKhr = parseKhrInput(raw, row.wageMinKhr);
  } else if (field === 'assumedWageKhr') {
    row.assumedWageKhr = parseKhrInput(raw, row.assumedWageKhr);
  }
  row.range = formatNssfWageRange(row.wageMinKhr, row.wageMaxKhr);
  next[index] = row;
  return next;
}

const sectionHeaderClass =
  'flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

export const NssfAssumedWageEditor: React.FC<Props> = ({
  mode,
  loading,
  brackets,
  onChange,
  headerActions,
}) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  const money = currency;
  const rate = exchangeRateKhrPerUsd;
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<NssfWageSortCol>();

  const sortedEditRows = useMemo(() => {
    const indexed = brackets.map((row, index) => ({ row, index }));
    const getSortValue = (
      item: { row: PayrollNssfWageBracket; index: number },
      col: NssfWageSortCol
    ): string | number => {
      const b = item.row;
      switch (col) {
        case 'level':
          return b.level;
        case 'wageMinKhr':
          return b.wageMinKhr;
        case 'wageMaxKhr':
          return b.wageMaxKhr ?? Number.MAX_SAFE_INTEGER;
        case 'assumedWageKhr':
          return b.assumedWageKhr;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: { row: PayrollNssfWageBracket; index: number }[]) =>
      rows.sort((a, b) => a.row.level - b.row.level);
    return sortRowsByColumn(indexed, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [brackets, sortBy, sortOrder]);

  const addLevel = () => {
    const last = brackets[brackets.length - 1];
    const level = (last?.level ?? 0) + 1;
    const wageMinKhr = last?.wageMaxKhr != null ? last.wageMaxKhr + 1 : 0;
    const wageMaxKhr = wageMinKhr + 50_000;
    const assumedWageKhr = wageMaxKhr - 25_000;
    onChange([
      ...brackets,
      {
        level,
        wageMinKhr,
        wageMaxKhr,
        assumedWageKhr,
        range: formatNssfWageRange(wageMinKhr, wageMaxKhr),
      },
    ]);
  };

  const displayMaxKhr = (max: number | null) => {
    if (max == null) return '';
    return khrStorageToDisplayValue(max, 'KHR', rate);
  };

  if (mode === 'edit') {
    return (
      <Card className="border-none shadow-sm overflow-hidden ring-2 ring-primary-500/20">
        <RulesConfigHelp help="payroll.nssfWageTable" className="absolute top-3 right-3 z-20" />
        <div className={`${sectionHeaderClass} pr-12`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
            <Scale className="w-4 h-4" />
            NSSF Assumed Wage Table (KHR)
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" icon={<Plus className="w-4 h-4" />} onClick={addLevel}>
              Add Level
            </Button>
            {headerActions}
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="overflow-x-auto custom-scrollbar max-h-[520px]">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10">
                <tr className="text-left text-[10px] font-semibold uppercase text-slate-500 border-b border-slate-100 dark:border-slate-700">
                  <SortableTableHeader
                    label="Level"
                    column="level"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={nssfWageThClass}
                  />
                  <SortableTableHeader
                    label="Min wage (KHR)"
                    column="wageMinKhr"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={nssfWageThClass}
                  />
                  <SortableTableHeader
                    label="Max wage (KHR)"
                    column="wageMaxKhr"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={nssfWageThClass}
                  />
                  <SortableTableHeader
                    label="Assumed wage (KHR)"
                    column="assumedWageKhr"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={nssfWageThClass}
                  />
                  <th className="py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {sortedEditRows.map(({ row: b, index }) => (
                  <tr
                    key={`nssf-wb-${b.level}-${index}`}
                    className="border-b border-slate-50 dark:border-slate-800 align-top"
                  >
                    <td className="py-2 pr-2">
                      <NumericField
                        kind="integer"
                        value={b.level}
                        onValueChange={(v) => onChange(updateRow(brackets, index, 'level', v))}
                        className={`${inputClass} w-16`}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <NumericField
                        kind="integer"
                        value={khrStorageToDisplayValue(b.wageMinKhr, 'KHR', rate)}
                        onValueChange={(v) =>
                          onChange(updateRow(brackets, index, 'wageMinKhr', v))
                        }
                        className={`${inputClass} min-w-[120px]`}
                      />
                      <UsdMirrorField label="Min" khr={b.wageMinKhr} rate={rate} />
                    </td>
                    <td className="py-2 pr-2">
                      <NumericField
                        kind="integer"
                        placeholder="Open"
                        value={displayMaxKhr(b.wageMaxKhr)}
                        onValueChange={(v) =>
                          onChange(updateRow(brackets, index, 'wageMaxKhr', v))
                        }
                        className={`${inputClass} min-w-[120px]`}
                      />
                      <UsdMirrorField
                        label="Max"
                        khr={b.wageMaxKhr ?? 0}
                        rate={rate}
                        placeholder={
                          b.wageMaxKhr == null ? 'Open / and above' : undefined
                        }
                        openEnded={
                          b.wageMaxKhr != null && b.wageMaxKhr >= PAYROLL_OPEN_ENDED_MAX_KHR
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <NumericField
                        kind="integer"
                        value={khrStorageToDisplayValue(b.assumedWageKhr, 'KHR', rate)}
                        onValueChange={(v) =>
                          onChange(updateRow(brackets, index, 'assumedWageKhr', v))
                        }
                        className={`${inputClass} min-w-[120px]`}
                      />
                      <UsdMirrorField label="Assumed" khr={b.assumedWageKhr} rate={rate} />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onChange(brackets.filter((_, i) => i !== index))}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="Remove level"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <RulesConfigHelp help="payroll.nssfWageTable" className="absolute top-3 right-3 z-20" />
      <div className={`${sectionHeaderClass} pr-12`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <Scale className="w-4 h-4" />
          NSSF Assumed Wage Table ({money})
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600">
            {loading ? 'Loading…' : `${brackets.length} levels`}
          </Badge>
          {headerActions}
        </div>
      </div>
      <ul className="p-5 max-h-[320px] overflow-y-auto custom-scrollbar space-y-1 text-sm">
        {loading && brackets.length === 0 ? (
          <li>
            <LoadingState variant="panel" layout="table" label="Loading wage table…" className="py-2" />
          </li>
        ) : (
          brackets.map((b) => (
            <li
              key={`view-${b.level}-${b.range}`}
              className="flex justify-between gap-3 py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="text-slate-600 dark:text-slate-400 shrink-0 w-8">L{b.level}</span>
              <span className="text-slate-600 dark:text-slate-400 flex-1">
                {formatNssfWageRangeDisplay(
                  b.wageMinKhr,
                  b.wageMaxKhr,
                  money,
                  exchangeRateKhrPerUsd
                )}
              </span>
              <span className="font-bold text-slate-900 dark:text-white shrink-0">
                {formatRulesAmountFromKhr(b.assumedWageKhr, money, exchangeRateKhrPerUsd)}
              </span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
};
