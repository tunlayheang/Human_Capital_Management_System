import React, { useState } from 'react';
import { Banknote, Shield } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/common/LoadingState';
import { inputClass } from '../../constants/designSystem';
import { NumericField } from '../../components/ui/NumericField';
import { SectionEditToolbar } from './SectionEditToolbar';
import type { PayrollExchangeRateDetails } from '../../types';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { PayrollPolicyVersionMetaLine } from '../../components/payroll/PayrollPolicyVersionMetaLine';

type Props = {
  details: PayrollExchangeRateDetails;
  loading: boolean;
  canEdit: boolean;
  isEditing: boolean;
  saving: boolean;
  draftRate: number;
  onDraftRateChange: (value: number) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** Summary layout when shown beside the tax brackets card. */
  compact?: boolean;
};

export const PayrollExchangeRateCard: React.FC<Props> = ({
  details,
  loading,
  canEdit,
  isEditing,
  saving,
  draftRate,
  onDraftRateChange,
  onEdit,
  onCancel,
  onSave,
  compact = false,
}) => {
  const [inputRaw, setInputRaw] = useState(String(draftRate));

  const configuredRate =
    details.latestExchangeRateKhrPerUsd ?? details.exchangeRateKhrPerUsd;

  React.useEffect(() => {
    if (!isEditing) setInputRaw(String(configuredRate));
  }, [isEditing, configuredRate]);

  const displayRate = isEditing ? draftRate : configuredRate;

  return (
    <Card
      className={`border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden ${compact ? 'h-auto' : ''} ${isEditing ? 'ring-2 ring-primary-500/20' : ''}`}
    >
      <RulesConfigHelp help="payroll.exchangeRate" className="absolute top-3 right-3 z-20" />
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 pr-11 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-0">
          <Banknote className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400" />
          <span className="truncate">{compact ? 'Exchange rate' : 'Payroll exchange rate (KHR / USD)'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600">
            {details.isConfigured ? 'Configured' : 'Default 4,100'}
          </Badge>
          {!canEdit && (
            <Badge variant="neutral" className="gap-1 border border-amber-200 dark:border-amber-800">
              <Shield className="w-3 h-3" />
              Admin edit only
            </Badge>
          )}
          <SectionEditToolbar
            canEdit={canEdit}
            isEditing={isEditing}
            saving={saving}
            onEdit={onEdit}
            onCancel={onCancel}
            onSave={onSave}
          />
        </div>
      </div>

      <div className={`${compact ? 'px-4 py-3' : 'p-5'} space-y-3`}>
        {loading ? (
          <LoadingState variant="panel" layout="form" label="Loading exchange rate…" className="py-1" />
        ) : isEditing ? (
          <div className="max-w-md">
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
              KHR per 1 USD
            </label>
            <NumericField
              kind="integer"
              value={inputRaw}
              onValueChange={(v) => {
                setInputRaw(v);
                const n = Number(v);
                if (Number.isFinite(n)) onDraftRateChange(n);
              }}
              className={inputClass}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            <p className={`${compact ? 'text-2xl' : 'text-3xl'} font-bold text-slate-900 dark:text-white tabular-nums`}>
              {displayRate.toLocaleString()}
              <span className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-slate-500 dark:text-slate-400 ml-1.5`}>
                KHR / USD
              </span>
            </p>
            {!compact && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                1 USD ≈ {displayRate.toLocaleString()} ៛
              </p>
            )}
            <PayrollPolicyVersionMetaLine
              className="w-full text-xs text-slate-400 mt-0.5"
              lastUpdatedAt={details.lastUpdatedAt}
              effectiveFrom={details.effectiveFrom}
              scheduledEffectiveFrom={details.scheduledEffectiveFrom}
            />
          </div>
        )}

      </div>
    </Card>
  );
};
