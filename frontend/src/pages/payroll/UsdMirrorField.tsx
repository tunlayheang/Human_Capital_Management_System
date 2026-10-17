import React from 'react';
import { inputClass } from '../../constants/designSystem';
import {
  formatUsdAmount,
  khrToUsd,
  PAYROLL_OPEN_ENDED_MAX_USD,
} from '../../utils/payrollRulesCurrency';

const usdMirrorClass = `${inputClass} mt-1 bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 cursor-not-allowed border-slate-200/70 dark:border-slate-700`;

/** Read-only USD display derived from a KHR-authoritative amount. */
export const UsdMirrorField: React.FC<{
  label: string;
  khr: number;
  rate: number;
  openEnded?: boolean;
  placeholder?: string;
  className?: string;
}> = ({ label, khr, rate, openEnded, placeholder, className }) => {
  const display =
    placeholder != null && placeholder !== ''
      ? placeholder
      : openEnded
        ? formatUsdAmount(PAYROLL_OPEN_ENDED_MAX_USD)
        : formatUsdAmount(khrToUsd(khr, rate));
  return (
    <label className={`block mt-1.5 ${className ?? ''}`}>
      <span className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">
        {label} (USD)
      </span>
      <input type="text" readOnly tabIndex={-1} value={display} className={usdMirrorClass} />
    </label>
  );
};
