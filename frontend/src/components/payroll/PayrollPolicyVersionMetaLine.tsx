import React from 'react';
import {
  formatPolicyEffectiveLabel,
  formatPolicyLastUpdatedLabel,
} from '../../utils/policyEffectiveDate';

type Props = {
  effectiveFrom?: string | null;
  scheduledEffectiveFrom?: string | null;
  lastUpdatedAt?: string | null;
  className?: string;
};

export const PayrollPolicyVersionMetaLine: React.FC<Props> = ({
  effectiveFrom,
  scheduledEffectiveFrom,
  lastUpdatedAt,
  className = 'text-xs text-slate-400',
}) => {
  const parts: string[] = [];
  if (lastUpdatedAt) {
    parts.push(`Last updated ${formatPolicyLastUpdatedLabel(lastUpdatedAt)}`);
  }
  if (effectiveFrom) {
    parts.push(`Effective from ${formatPolicyEffectiveLabel(effectiveFrom)}`);
  }
  if (scheduledEffectiveFrom) {
    parts.push(`Scheduled ${formatPolicyEffectiveLabel(scheduledEffectiveFrom)}`);
  }
  if (!parts.length) return null;
  return <p className={className}>{parts.join(' · ')}</p>;
};
