import React from 'react';
import { CalendarClock } from 'lucide-react';
import { inputClass } from '../../constants/designSystem';
import { formatPolicyEffectiveLabel, formatPolicyLastUpdatedLabel } from '../../utils/policyEffectiveDate';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';

type Props = {
  value: string;
  onChange: (value: string) => void;
  currentEffectiveFrom?: string | null;
  scheduledEffectiveFrom?: string | null;
  lastUpdatedAt?: string | null;
  disabled?: boolean;
  className?: string;
};

export const PolicyEffectiveDateField: React.FC<Props> = ({
  value,
  onChange,
  currentEffectiveFrom,
  scheduledEffectiveFrom,
  lastUpdatedAt,
  disabled = false,
  className = '',
}) => (
  <div
    className={`relative rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/20 p-4 space-y-3 ${className}`}
  >
    <RulesConfigHelp help="payroll.policyEffectiveDate" className="absolute top-3 right-3 z-10" />
    <div className="flex items-start gap-2 pr-10">
      <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
      <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
        Effective date required
      </p>
    </div>

    <div className="max-w-xs">
      <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1.5">
        Effective from
      </label>
      <DatePickerInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={inputClass}
        required
      />
    </div>

    {(lastUpdatedAt || currentEffectiveFrom || scheduledEffectiveFrom) && (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        {lastUpdatedAt && (
          <span>
            Last updated: <strong>{formatPolicyLastUpdatedLabel(lastUpdatedAt)}</strong>
          </span>
        )}
        {currentEffectiveFrom && (
          <span>
            Saved effective from:{' '}
            <strong>{formatPolicyEffectiveLabel(currentEffectiveFrom)}</strong>
          </span>
        )}
        {scheduledEffectiveFrom && (
          <span>
            Scheduled: <strong>{formatPolicyEffectiveLabel(scheduledEffectiveFrom)}</strong>
          </span>
        )}
      </div>
    )}
  </div>
);
