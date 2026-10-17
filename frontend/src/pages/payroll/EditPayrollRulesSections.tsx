import React from 'react';
import { Trash2 } from 'lucide-react';
import type { PayrollTaxBracket } from '../../types';
import { inputClass } from '../../constants/designSystem';
import { numericInputAttrs, onFilteredChange } from '../../utils/formInputFilters';
import { usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import {
  isOpenEndedKhrMax,
  PAYROLL_OPEN_ENDED_MAX_KHR,
} from '../../utils/payrollRulesCurrency';
import { UsdMirrorField } from './UsdMirrorField';

export const TaxBracketEditSection: React.FC<{
  taxBrackets: PayrollTaxBracket[];
  exchangeRateKhrPerUsd?: number;
  updateBracket: (index: number, field: keyof PayrollTaxBracket, raw: string) => void;
  removeBracket: (index: number) => void;
}> = ({ taxBrackets, exchangeRateKhrPerUsd, updateBracket, removeBracket }) => {
  const { exchangeRateKhrPerUsd: ctxRate } = usePayrollRulesCurrency();
  const rate = exchangeRateKhrPerUsd ?? ctxRate;

  const displayMaxKhr = (maxKhr: number) =>
    isOpenEndedKhrMax(maxKhr) ? PAYROLL_OPEN_ENDED_MAX_KHR : Math.round(maxKhr);

  return (
    <div className="p-5 space-y-4">
      {taxBrackets.map((b, index) => (
        <div key={index} className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[120px]">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-500">From (KHR)</span>
              <input
                {...numericInputAttrs('integer')}
                value={Math.round(b.min)}
                onChange={onFilteredChange('integer', (v) => updateBracket(index, 'min', v))}
                className={`${inputClass} mt-1`}
              />
            </label>
            <UsdMirrorField label="From" khr={b.min} rate={rate} />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-500">To (KHR)</span>
              <input
                {...numericInputAttrs('integer')}
                value={displayMaxKhr(b.max)}
                onChange={onFilteredChange('integer', (v) => updateBracket(index, 'max', v))}
                className={`${inputClass} mt-1`}
              />
            </label>
            <UsdMirrorField
              label="To"
              khr={b.max}
              rate={rate}
              openEnded={isOpenEndedKhrMax(b.max)}
            />
          </div>
          <label className="w-28">
            <span className="text-[10px] font-semibold uppercase text-slate-500">Tax Rate (%)</span>
            <input
              {...numericInputAttrs('decimal')}
              value={b.rate}
              onChange={onFilteredChange('decimal', (v) => updateBracket(index, 'rate', v), {
                maxDecimals: 2,
              })}
              className={`${inputClass} mt-1`}
            />
          </label>
          <div className="w-36 min-w-[120px]">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase text-slate-500">
                Deduction (KHR)
              </span>
              <input
                {...numericInputAttrs('integer')}
                value={Math.round(b.deduction ?? 0)}
                onChange={onFilteredChange('integer', (v) => updateBracket(index, 'deduction', v))}
                className={`${inputClass} mt-1`}
              />
            </label>
            <UsdMirrorField label="Deduction" khr={b.deduction ?? 0} rate={rate} />
          </div>
          <button
            type="button"
            onClick={() => removeBracket(index)}
            className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 mt-5"
            aria-label="Remove bracket"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
