import React from 'react';
import { Calculator } from 'lucide-react';

/** Short note that final settlement uses the same hybrid engine as monthly payroll. */
export const SettlementEngineNotice: React.FC<{ className?: string }> = ({ className = '' }) => (
  <p
    className={`text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2 ${className}`}
  >
    <Calculator className="w-4 h-4 shrink-0 text-primary-600 mt-0.5" aria-hidden />
    <span>
      Amounts use the <strong>same payroll engine</strong> as monthly runs (attendance proration, NSSF,
      tax, dependents, overtime, absences). Leave encashment and clearance are added on top.
    </span>
  </p>
);

export default SettlementEngineNotice;
