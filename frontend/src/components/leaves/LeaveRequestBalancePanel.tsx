import React, { useMemo } from 'react';
import { Wallet } from 'lucide-react';
import type { LeaveBalanceEntry } from '../../types';
import { LoadingState } from '../common/LoadingState';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveLocalizedLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

type Props = {
  balances: LeaveBalanceEntry[];
  year: number;
  loading?: boolean;
  /** Currently selected leave type name (matches form `type`). */
  selectedTypeName?: string;
  /** Requested duration in days — used to show remaining after this request. */
  requestedDays?: number | null;
  labels: {
    title: string;
    remaining: string;
    used: string;
    of: string;
    days: string;
    unpaid: string;
    empty: string;
    afterRequest?: string;
    insufficient?: string;
  };
};

function formatDays(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function balanceTotal(row: LeaveBalanceEntry): number {
  const isStrictAccrual = row.leaveCategory === 'accrual_based';
  const accrued = Number(row.accrued ?? 0);
  const earned = accrued + Number(row.carriedOver ?? 0);
  return isStrictAccrual ? earned : row.entitlement + row.carriedOver;
}

/**
 * Compact leave-balance overview for the leave request modal.
 * Shows every balance; highlights the selected type and remaining after the draft duration.
 */
export const LeaveRequestBalancePanel: React.FC<Props> = ({
  balances,
  year,
  loading,
  selectedTypeName,
  requestedDays,
  labels,
}) => {
  const { language } = useLanguage();

  const selected = useMemo(() => {
    const name = String(selectedTypeName || '').trim().toLowerCase();
    if (!name) return null;
    return (
      balances.find((b) => String(b.leaveTypeName || '').trim().toLowerCase() === name) ?? null
    );
  }, [balances, selectedTypeName]);

  const afterRequest =
    selected && requestedDays != null && Number.isFinite(requestedDays) && requestedDays > 0
      ? selected.remaining - requestedDays
      : null;
  const insufficient = afterRequest != null && afterRequest < 0;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 border-b border-slate-200/80 dark:border-slate-700/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 shrink-0">
            <Wallet className="w-3.5 h-3.5" />
          </div>
          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
            {labels.title}
          </p>
        </div>
        <span className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {year}
        </span>
      </div>

      {loading ? (
        <LoadingState variant="inline" className="px-3 py-2" />
      ) : balances.length === 0 ? (
        <p className="px-3 py-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          {labels.empty}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200/80 dark:divide-slate-700/80 max-h-48 sm:max-h-56 overflow-y-auto">
          {balances.map((row) => {
            const isSelected =
              selected?.leaveTypeId === row.leaveTypeId ||
              String(row.leaveTypeName || '').trim().toLowerCase() ===
                String(selectedTypeName || '').trim().toLowerCase();
            const total = balanceTotal(row);
            return (
              <li
                key={row.leaveTypeId}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-2.5 text-sm transition-colors',
                  isSelected
                    ? 'bg-primary-50/90 dark:bg-primary-950/35 ring-1 ring-inset ring-primary-200/80 dark:ring-primary-800/60'
                    : 'hover:bg-white/60 dark:hover:bg-slate-800/40'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'font-semibold text-slate-900 dark:text-white truncate text-xs sm:text-sm',
                      localizedLabelUsesKhmerFont(
                        row.leaveTypeName,
                        row.leaveTypeNameKh,
                        language
                      ) && 'font-khmer'
                    )}
                  >
                    {resolveLocalizedLabel(row.leaveTypeName, row.leaveTypeNameKh, language)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {!row.isPaid ? <span className="mr-1.5">{labels.unpaid}</span> : null}
                    {labels.used} {formatDays(row.used)} {labels.of} {formatDays(total)}{' '}
                    {labels.days}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={cn(
                      'text-sm sm:text-base font-bold tabular-nums',
                      isSelected
                        ? 'text-primary-700 dark:text-primary-300'
                        : 'text-primary-600 dark:text-primary-400'
                    )}
                  >
                    {formatDays(row.remaining)}
                  </p>
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-slate-400 font-medium">
                    {labels.remaining}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && afterRequest != null ? (
        <div
          className={cn(
            'px-3 py-2 sm:px-4 border-t text-xs sm:text-sm',
            insufficient
              ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
              : 'border-slate-200/80 dark:border-slate-700/80 bg-white/50 dark:bg-slate-950/20 text-slate-600 dark:text-slate-300'
          )}
          role="status"
        >
          {insufficient ? (
            <span>
              {labels.insufficient ||
                `This request needs ${formatDays(requestedDays!)} ${labels.days}, but only ${formatDays(selected.remaining)} ${labels.remaining}.`}
            </span>
          ) : (
            <span>
              {labels.afterRequest || 'Remaining after this request'}:{' '}
              <strong className="tabular-nums font-semibold text-slate-900 dark:text-white">
                {formatDays(afterRequest)} {labels.days}
              </strong>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
};

/** Look up remaining days for a leave type name (case-insensitive). */
export function remainingForLeaveTypeName(
  balances: LeaveBalanceEntry[],
  typeName: string | undefined
): number | null {
  const name = String(typeName || '').trim().toLowerCase();
  if (!name) return null;
  const row = balances.find((b) => String(b.leaveTypeName || '').trim().toLowerCase() === name);
  if (!row) return null;
  const n = Number(row.remaining);
  return Number.isFinite(n) ? n : null;
}

export function formatLeaveBalanceDays(n: number): string {
  return formatDays(n);
}
