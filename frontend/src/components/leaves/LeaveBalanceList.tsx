import React from 'react';
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
  labels: {
    title: string;
    remaining: string;
    used: string;
    of: string;
    days: string;
    unpaid: string;
    empty: string;
  };
};

function formatDays(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export const LeaveBalanceList: React.FC<Props> = ({ balances, year, loading, labels }) => {
  const { language } = useLanguage();
  return (
    <div className="surface-card shadow-[0_10px_28px_-10px_rgba(15,23,42,0.22)] dark:shadow-[0_10px_28px_-10px_rgba(0,0,0,0.55)] w-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-900/30">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 shrink-0">
            <Wallet className="w-4 h-4" />
          </div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
            {labels.title}
          </h2>
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {year}
        </span>
      </div>

      {loading ? (
        <LoadingState variant="inline" className="px-4 py-2" />
      ) : balances.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">{labels.empty}</div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700/80">
          {balances.map((row) => {
            const isStrictAccrual = row.leaveCategory === 'accrual_based';
            const isJoinDateBased = row.leaveCategory === 'join_date_based';
            const accrued = Number(row.accrued ?? 0);
            const earned = accrued + Number(row.carriedOver ?? 0);
            const total = isStrictAccrual
              ? earned
              : row.entitlement + row.carriedOver;
            return (
              <li
                key={row.leaveTypeId}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5 sm:py-3 text-sm hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'font-semibold text-slate-900 dark:text-white truncate',
                      localizedLabelUsesKhmerFont(
                        row.leaveTypeName,
                        row.leaveTypeNameKh,
                        language
                      ) && 'font-khmer'
                    )}
                  >
                    {resolveLocalizedLabel(row.leaveTypeName, row.leaveTypeNameKh, language)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {!row.isPaid && <span className="mr-1.5">{labels.unpaid}</span>}
                    {isStrictAccrual ? (
                      <>
                        {labels.used} {formatDays(row.used)} {labels.of} {formatDays(earned)}{' '}
                        {labels.days} accrued
                        {row.entitlement > 0 ? (
                          <span className="ml-1.5 text-slate-400">
                            (cap {formatDays(row.entitlement)} {labels.days}
                            {row.proratedJoinYear ? ', prorated join year' : ', full year'}
                            {row.fullYearEntitlement != null &&
                            row.fullYearEntitlement !== row.entitlement
                              ? ` · policy ${formatDays(row.fullYearEntitlement)}`
                              : ''}
                            )
                          </span>
                        ) : null}
                      </>
                    ) : isJoinDateBased ? (
                      <>
                        {labels.used} {formatDays(row.used)} {labels.of} {formatDays(total)}{' '}
                        {labels.days}
                        {row.entitlement > 0 ? (
                          <span className="ml-1.5 text-slate-400">
                            (yearly
                            {row.proratedJoinYear ? ', prorated join year' : ''}
                            {accrued > 0 ? ` · accrued ${formatDays(accrued)}` : ''}
                            {row.fullYearEntitlement != null &&
                            row.fullYearEntitlement !== row.entitlement
                              ? ` · policy ${formatDays(row.fullYearEntitlement)}`
                              : ''}
                            )
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {labels.used} {formatDays(row.used)} {labels.of} {formatDays(total)} {labels.days}
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold tabular-nums text-primary-600 dark:text-primary-400">
                    {formatDays(row.remaining)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">
                    {labels.remaining}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
