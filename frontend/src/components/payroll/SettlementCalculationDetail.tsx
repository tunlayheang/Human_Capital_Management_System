import React from 'react';
import {
  type CalculationDisplayLine,
  type SettlementCalculationContext,
} from '../../payroll/settlementCalculationDetail';
import { formatDisplayDate } from '../../offboarding/settlementFormUtils';

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `−$${formatted}`;
  return `$${formatted}`;
}

function LineRow({ line }: { line: CalculationDisplayLine }) {
  const isDeduction = line.amount < 0;
  return (
    <div
      className={`col-span-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums ${
        line.emphasis ? 'font-semibold pt-1 border-t border-current/10' : ''
      }`}
      key={line.label}
    >
      <span className={line.emphasis ? '' : 'opacity-90'}>{line.label}</span>
      <span className={`text-right ${isDeduction && !line.emphasis ? 'text-red-700 dark:text-red-300' : ''}`}>
        {formatUsd(line.amount)}
      </span>
    </div>
  );
}

type Props = {
  calculation: SettlementCalculationContext;
  className?: string;
};

const PRORATION_REASON_LABEL: Record<string, string> = {
  mid_month_join: 'Joined mid-month (pay starts from join date)',
  last_working_date: 'Last working date ends the pay window',
  mid_month_resign: 'Resignation / termination mid-month',
  attendance_present_days:
    'Final settlement: only days with Present/Late attendance count toward base and fixed allowances',
  no_attendance_present:
    'No Present/Late attendance in the period through last working date — base prorated to zero',
};

export const SettlementCalculationDetail: React.FC<Props> = ({ calculation, className = '' }) => {
  const { month, lastWorkingDate, lines, payPeriodStart, payPeriodEnd, joinDate, prorationReason } =
    calculation;
  const earningLines = lines.filter((l) => l.section === 'earning' || l.section === 'deduction' || l.section === 'total');
  const metaProration = lines.find((l) => l.section === 'meta' && l.label.includes('Proration'));
  const prorationHints = (prorationReason ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => PRORATION_REASON_LABEL[r] ?? r);

  if (!earningLines.length) return null;

  return (
    <details open className={`group ${className}`}>
      <summary className="text-xs font-semibold cursor-pointer list-none flex items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-slate-500 group-open:rotate-90 transition-transform inline-block" aria-hidden>
          ▸
        </span>
        Calculation breakdown
      </summary>
      <div className="mt-2 rounded-lg border border-current/10 bg-white/50 dark:bg-slate-900/40 px-3 py-2.5 space-y-2">
        <p className="text-xs opacity-90">
          <span className="font-medium">Month:</span> {month}
          {lastWorkingDate ? (
            <>
              {' '}
              · <span className="font-medium">LWD:</span> {formatDisplayDate(lastWorkingDate)}
            </>
          ) : null}
        </p>
        {metaProration ? <p className="text-xs opacity-90">{metaProration.label}</p> : null}
        {payPeriodStart && payPeriodEnd ? (
          <p className="text-xs opacity-90">
            <span className="font-medium">Pay period:</span>{' '}
            {formatDisplayDate(payPeriodStart)} – {formatDisplayDate(payPeriodEnd)}
          </p>
        ) : null}
        {joinDate ? (
          <p className="text-xs opacity-90">
            <span className="font-medium">Join date:</span> {formatDisplayDate(joinDate)}
          </p>
        ) : null}
        {prorationReason === 'attendance_present_days' || prorationReason === 'no_attendance_present' ? (
          <p className="text-xs opacity-90">
            Last working date is required; paid days are counted from{' '}
            <span className="font-medium">Present/Late</span> attendance records through LWD. Gap days
            after last clock-in may still be deducted. Performance allowances use the same
            attendance data.
          </p>
        ) : null}
        {prorationHints.length ? (
          <ul className="text-xs list-disc list-inside opacity-90 space-y-0.5">
            {prorationHints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-1 gap-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-60 col-span-2">
            Earnings
          </p>
          {lines
            .filter((l) => l.section === 'earning' && !l.label.startsWith('Gross'))
            .map((line) => (
              <LineRow key={line.label} line={line} />
            ))}
          {lines
            .filter((l) => l.label === 'Gross pay')
            .map((line) => (
              <LineRow key={line.label} line={line} />
            ))}
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-60 col-span-2 pt-1">
            Deductions
          </p>
          {lines
            .filter((l) => l.section === 'deduction')
            .map((line) => (
              <LineRow key={line.label} line={line} />
            ))}
          {lines
            .filter((l) => l.section === 'total')
            .map((line) => (
              <LineRow key={line.label} line={line} />
            ))}
        </div>
      </div>
    </details>
  );
};

export default SettlementCalculationDetail;
