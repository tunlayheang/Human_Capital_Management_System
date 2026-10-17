import React from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SettlementCalculationContext } from '../../payroll/settlementCalculationDetail';
import { useLanguage } from '../../context/LanguageContext';
import { SettlementPayStatement } from './SettlementPayStatement';

export type PayrollOverlapView = {
  scenario?: string;
  severity?: 'info' | 'warning' | 'error';
  disbursementMode?: string;
  settlementNetUsd?: number;
  recommendedPayUsd?: number;
  alreadyPaidViaMonthlyUsd?: number;
  deltaUsd?: number;
  monthlyRunStatus?: string | null;
  messages?: string[];
  actions?: string[];
  blocksSeparatePayment?: boolean;
  requiresPaymentAcknowledgment?: boolean;
};

function formatUsd(n: unknown): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SCENARIO_KEYS = [
  'NO_MONTHLY_RUN',
  'EXCLUDED_FROM_MONTHLY',
  'MONTHLY_DRAFT_INCLUDES_EMPLOYEE',
  'MONTHLY_IN_FLIGHT',
  'MONTHLY_PAID_DELTA_DUE',
  'MONTHLY_PAID_FULLY_COVERED',
  'MONTHLY_OVERPAID_VS_SETTLEMENT',
  'SETTLEMENT_ALREADY_PAID',
] as const;

type Props = {
  overlap: PayrollOverlapView | null | undefined;
  calculation?: SettlementCalculationContext | null;
  className?: string;
  showPolicy?: boolean;
};

export const PayrollOverlapBanner: React.FC<Props> = ({
  overlap,
  calculation,
  className = '',
  showPolicy = true,
}) => {
  const { t } = useLanguage();

  const scenarioTitle = (scenario?: string) => {
    const key = String(scenario ?? '');
    if ((SCENARIO_KEYS as readonly string[]).includes(key)) {
      return t(`offboarding.overlap.scenarios.${key}`);
    }
    return t('offboarding.overlap.fallbackTitle');
  };

  if (!overlap && !calculation) return null;
  if (!overlap) {
    return calculation?.statement ? (
      <div
        className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/50 px-4 py-3 ${className}`}
      >
        <SettlementPayStatement statement={calculation.statement} />
      </div>
    ) : null;
  }

  const severity = overlap.severity ?? 'info';
  const Icon = severity === 'error' ? XCircle : severity === 'warning' ? AlertTriangle : Info;
  const boxClass =
    severity === 'error'
      ? 'border-red-200 dark:border-red-800 bg-red-50/90 dark:bg-red-950/30 text-red-900 dark:text-red-100'
      : severity === 'warning'
        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/50 text-slate-800 dark:text-slate-200';

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${boxClass} ${className}`}>
      <div className="flex gap-2">
        <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">{scenarioTitle(overlap.scenario)}</p>
          {showPolicy ? <p className="text-xs opacity-90">{t('offboarding.overlap.policy')}</p> : null}
          {calculation?.statement ? null : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              <span>
                {t('offboarding.overlap.labels.settlementNet')} {formatUsd(overlap.settlementNetUsd)}
              </span>
              {overlap.alreadyPaidViaMonthlyUsd != null && overlap.alreadyPaidViaMonthlyUsd > 0 ? (
                <span>
                  {t('offboarding.overlap.labels.alreadyViaMonthly')}{' '}
                  {formatUsd(overlap.alreadyPaidViaMonthlyUsd)}
                </span>
              ) : null}
              <span className="font-semibold">
                {t('offboarding.overlap.labels.payNow')} {formatUsd(overlap.recommendedPayUsd)}
              </span>
            </div>
          )}
          {overlap.messages?.map((m) => (
            <p key={m} className="text-sm">
              {m}
            </p>
          ))}
          {overlap.actions?.length ? (
            <ul className="text-xs list-disc list-inside space-y-0.5 opacity-90">
              {overlap.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
          {calculation?.statement ? (
            <SettlementPayStatement
              statement={calculation.statement}
              className="pt-2 border-t border-current/10"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const OptionAPolicyNote: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t } = useLanguage();
  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      {t('offboarding.overlap.policyNote')}{' '}
      <Link to="/employees/offboarding" className="text-primary-600 hover:underline font-medium">
        {t('offboarding.overlap.guideLink')}
      </Link>
    </p>
  );
};

export default PayrollOverlapBanner;
