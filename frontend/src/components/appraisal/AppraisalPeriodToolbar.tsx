import React from 'react';
import type { AppraisalPeriod } from '../../types/appraisal';
import { PeriodSelectToolbar } from '../ui/PeriodSelectToolbar';

type Props = {
  periods: AppraisalPeriod[];
  periodId: string;
  onPeriodChange: (periodId: string) => void;
  label?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** Refresh button, loading spinner, etc. */
  trailing?: React.ReactNode;
};

export const AppraisalPeriodToolbar: React.FC<Props> = ({
  periods,
  periodId,
  onPeriodChange,
  label = 'Period',
  ariaLabel = 'Appraisal period',
  id = 'appraisal-period-select',
  className,
  trailing,
}) => (
  <PeriodSelectToolbar
    id={id}
    className={className}
    label={label}
    ariaLabel={ariaLabel}
    options={periods.map((p) => ({
      id: p.id,
      name: p.name?.trim() || p.id,
    }))}
    value={periodId}
    onChange={onPeriodChange}
    trailing={trailing}
  />
);
