import React, { useMemo } from 'react';
import { NumericField } from '../../components/ui/NumericField';
import { CurrencyAmountField } from '../../components/ui/CurrencyAmountField';
import { parseConditionJson } from './allowanceRuleUtils';
import { usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';
import { formatRulesAmountFromUsd } from '../../utils/payrollRulesCurrency';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';

const inputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm w-full';

export const TRIGGER_OPTIONS: { value: string; label: string; hint: string }[] = [
  {
    value: 'fixed',
    label: 'Fixed monthly amount',
    hint: 'Same amount each month when employee has base salary.',
  },
  {
    value: 'attendance',
    label: 'Attendance-based',
    hint: 'Amount depends on present days, absences, and late arrivals.',
  },
  {
    value: 'position',
    label: 'Job title',
    hint: 'Auto-apply by job title, or assign the amount via an allowance package.',
  },
  {
    value: 'commission',
    label: 'Sales / commission',
    hint: 'Percentage or bonus when sales exceed a target.',
  },
  {
    value: 'conditional',
    label: 'Department or custom',
    hint: 'Filter by department or position id — portal role is never a payment gate.',
  },
];

function numField(c: Record<string, unknown>, key: string, fallback: number): number {
  const v = c[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strField(c: Record<string, unknown>, key: string, fallback = ''): string {
  const v = c[key];
  return v != null ? String(v) : fallback;
}

function arrField(c: Record<string, unknown>, key: string): string {
  const v = c[key];
  if (Array.isArray(v)) return v.map(String).join(', ');
  return '';
}

export function defaultConditionsForTrigger(trigger: string): Record<string, unknown> {
  switch (trigger) {
    case 'attendance':
      return {
        present_min: 10,
        absence_max: 0,
        late_max: 2,
        full_amount: 70,
        one_absence_pct: 50,
        two_plus_absence_pct: 0,
      };
    case 'seniority':
      return { years_min: 1, years_max: 2 };
    case 'overtime':
      return { ot_hours_min: 2, ot_hours_double_at: 4, base_meal_amount: 5 };
    case 'position':
      // Portal roles are not payment gates — use package assignment or job-title filters.
      return { position_titles: [], amount: 0 };
    case 'commission':
      return { sales_threshold: 5000, commission_pct: 3, sales_amount: 0 };
    case 'conditional':
      return { department_ids: [], position_ids: [], amount: 0 };
    default:
      return { requires_base_salary: true };
  }
}

/** Plain-language summary for HR users (shown under the form). */
export function describeRuleConditions(
  trigger: string,
  conditions: Record<string, unknown>,
  fixedAmount: number,
  options?: { currency?: PreferredCurrency; exchangeRateKhrPerUsd?: number }
): React.ReactNode {
  const c = conditions;
  const currency = options?.currency ?? 'USD';
  const rate = resolveExchangeRateKhrPerUsd(options?.exchangeRateKhrPerUsd, 'configured');
  const money = (usd: number) => formatRulesAmountFromUsd(usd, currency, rate);
  switch (trigger) {
    case 'fixed':
      return c.requires_base_salary
        ? `Pay ${money(fixedAmount)} each month when the employee has a base salary.`
        : `Pay ${money(fixedAmount)} every month (no extra requirements).`;
    case 'seniority':
      return `Pay ${money(fixedAmount)} when years of service is between ${numField(c, 'years_min', 0)} and ${numField(c, 'years_max', 99)}.`;
    case 'attendance': {
      const full = numField(c, 'full_amount', fixedAmount);
      const lateMax = numField(c, 'late_max', 999);
      const oneAbsPct = numField(c, 'one_absence_pct', 50);
      return (
        <>
          {`Up to ${money(full)} if at least ${numField(c, 'present_min', 10)} present/late days. `}
          <span className="text-red-600 dark:text-red-400 font-medium">
            {`More than ${lateMax} late day${lateMax === 1 ? '' : 's'} → ${oneAbsPct}% of full amount (same as 1 absence). `}
          </span>
          {`1 absence → ${oneAbsPct}% of full amount; `}
          {`2+ absences → ${numField(c, 'two_plus_absence_pct', 0)}%.`}
        </>
      );
    }
    case 'overtime':
      return (
        `Pay meal allowance when approved OT ≥ ${numField(c, 'ot_hours_min', 2)}h ` +
        `(double at ≥ ${numField(c, 'ot_hours_double_at', 4)}h). Base meal: ${money(numField(c, 'base_meal_amount', fixedAmount))}.`
      );
    case 'position': {
      const titles = arrField(c, 'position_titles');
      const amt = money(numField(c, 'amount', fixedAmount));
      if (titles) {
        return `Pay ${amt} when job title contains: ${titles}. Packages always pay this amount when assigned (portal role never blocks).`;
      }
      return `Pay ${amt} when assigned via an allowance package (portal role never blocks). Job-title filters optional for auto-apply without a package.`;
    }
    case 'commission':
      return (
        <>
          {`When sales ≥ ${money(numField(c, 'sales_threshold', 0))}, commission ${numField(c, 'commission_pct', 0)}% of sales. `}
          {`Below that minimum, Fixed amount is paid if set. `}
          <span className="text-slate-600 dark:text-slate-300">
            Enter each employee’s monthly sales on Payroll → Overview for the salary month.
          </span>
        </>
      );
    default:
      return 'Custom conditions — see advanced JSON if needed.';
  }
}

type Props = {
  triggerType: string;
  conditions: Record<string, unknown>;
  fixedAmount: number;
  onChange: (next: Record<string, unknown>) => void;
  showAdvancedJson: boolean;
  onToggleAdvanced: () => void;
  conditionJsonText: string;
  onConditionJsonTextChange: (text: string) => void;
  conditionJsonError: string | null;
};

export const AllowanceRuleConditionForm: React.FC<Props> = ({
  triggerType,
  conditions,
  fixedAmount,
  onChange,
  showAdvancedJson,
  onToggleAdvanced,
  conditionJsonText,
  onConditionJsonTextChange,
  conditionJsonError,
}) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  const c = useMemo(() => parseConditionJson(conditions), [conditions]);
  const summary = describeRuleConditions(triggerType, c, fixedAmount, {
    currency,
    exchangeRateKhrPerUsd,
  });

  const patch = (partial: Record<string, unknown>) => {
    const next = { ...c, ...partial };
    onChange(next);
    onConditionJsonTextChange(JSON.stringify(next, null, 2));
  };

  const moneyField = (key: string, storageUsd: number) => (
    <CurrencyAmountField
      storage="usd"
      className={inputClass}
      value={storageUsd}
      currency={currency}
      exchangeRateKhrPerUsd={exchangeRateKhrPerUsd}
      onValueChange={(next) => patch({ [key]: next })}
    />
  );

  const field = (
    label: string,
    hint: string | undefined,
    control: React.ReactNode
  ) => (
    <label className="text-sm flex flex-col gap-1">
      <span className="text-slate-700 dark:text-slate-300 font-medium">{label}</span>
      {hint && <span className="text-xs text-slate-500 font-normal">{hint}</span>}
      {control}
    </label>
  );

  let form: React.ReactNode = null;

  switch (triggerType) {
    case 'seniority':
      form = (
        <div className="grid sm:grid-cols-2 gap-3">
          {field(
            'Minimum years of service',
            'Inclusive — e.g. 3 means 3 full years qualifies.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'years_min', 1)}
              onValueChange={(v) => patch({ years_min: Number(v) || 0 })}
            />
          )}
          {field(
            'Maximum years of service',
            'Inclusive — use 99 for “and above”.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'years_max', 99)}
              onValueChange={(v) => patch({ years_max: Number(v) || 0 })}
            />
          )}
        </div>
      );
      break;

    case 'attendance':
      form = (
        <div className="grid sm:grid-cols-2 gap-3">
          {field(
            'Minimum present/late days',
            'Days counted as present or late in the payroll month.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'present_min', 10)}
              onValueChange={(v) => patch({ present_min: Number(v) || 0 })}
            />
          )}
          {field(
            'Max late days (optional)',
            'If late days exceed this, pay drops to the “1 absence” percent.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'late_max', 999)}
              onValueChange={(v) => patch({ late_max: Number(v) || 0 })}
            />
          )}
          <div className="sm:col-span-2">
            {field(
              `Full allowance amount (${currency})`,
              'Paid when attendance criteria are fully met.',
              moneyField('full_amount', numField(c, 'full_amount', fixedAmount))
            )}
          </div>
          {field(
            'Pay if 1 absence (%)',
            'e.g. 50 = half of full amount. Also used when late days exceed the max.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'one_absence_pct', 50)}
              onValueChange={(v) => patch({ one_absence_pct: Number(v) || 0 })}
            />
          )}
          {field(
            'Pay if 2+ absences (%)',
            '0 = no allowance.',
            <NumericField
              kind="integer"
              className={inputClass}
              value={numField(c, 'two_plus_absence_pct', 0)}
              onValueChange={(v) => patch({ two_plus_absence_pct: Number(v) || 0 })}
            />
          )}
        </div>
      );
      break;

    case 'overtime':
      form = (
        <div className="grid sm:grid-cols-2 gap-3">
          {field(
            'Minimum OT hours',
            'Approved overtime hours in the month.',
            <NumericField
              kind="decimal"
              filterOptions={{ maxDecimals: 2 }}
              className={inputClass}
              value={numField(c, 'ot_hours_min', 2)}
              onValueChange={(v) => patch({ ot_hours_min: Number(v) || 0 })}
            />
          )}
          {field(
            'Double meal at (hours)',
            'e.g. 4 = double allowance after 4 hours OT.',
            <NumericField
              kind="decimal"
              filterOptions={{ maxDecimals: 2 }}
              className={inputClass}
              value={numField(c, 'ot_hours_double_at', 4)}
              onValueChange={(v) => patch({ ot_hours_double_at: Number(v) || 0 })}
            />
          )}
          {field(
            `Base meal amount (${currency})`,
            'Paid once threshold is met (×2 if double hours reached).',
            moneyField('base_meal_amount', numField(c, 'base_meal_amount', fixedAmount))
          )}
        </div>
      );
      break;

    case 'position':
      form = (
        <div className="grid sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-xs text-slate-500">
            Portal access role never blocks payment. Assign this rule through an allowance
            package, or optionally auto-apply by job title below.
          </p>
          {field(
            'Job title contains (optional)',
            'Auto-apply without a package when the employee title matches. Leave empty to require a package.',
            <input
              className={inputClass}
              placeholder="Supervisor, Team Leader"
              value={arrField(c, 'position_titles')}
              onChange={(e) =>
                patch({
                  position_titles: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          )}
          {field(
            `Allowance amount (${currency})`,
            'Can also use “Fixed amount” above.',
            moneyField('amount', numField(c, 'amount', fixedAmount))
          )}
        </div>
      );
      break;

    case 'commission':
      form = (
        <div className="grid sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-xs text-slate-500">
            Enter monthly sales on Payroll → Overview → Sales Target. Use the (!) next to the dialog
            title for Fixed amount vs Percentage rate (EX: min $5,000, 3%, sales $10,000 → $300).
          </p>
          {field(
            `Minimum sales (${currency})`,
            'Below this, Fixed amount is paid (if set). At or above, % of sales applies.',
            moneyField('sales_threshold', numField(c, 'sales_threshold', 0))
          )}
          {field(
            'Commission rate (%)',
            'Percent of actual monthly sales (overrides Percentage rate above when set).',
            <NumericField
              kind="decimal"
              filterOptions={{ maxDecimals: 2 }}
              className={inputClass}
              value={numField(c, 'commission_pct', 0)}
              onValueChange={(v) => patch({ commission_pct: Number(v) || 0 })}
            />
          )}
        </div>
      );
      break;

    case 'conditional':
      form = null;
      break;

    default:
      form = (
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={c.requires_base_salary !== false}
            onChange={(e) => patch({ requires_base_salary: e.target.checked })}
          />
          Only employees with a base salary receive this allowance
        </label>
      );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-4">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
        When does this rule apply?
      </p>

      {form}

      <div className="rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800/40 px-3 py-2">
        <p className="text-xs font-medium text-primary-800 dark:text-primary-200">Summary</p>
        <p className="text-sm text-primary-900 dark:text-primary-100 mt-0.5">{summary}</p>
      </div>

      <button
        type="button"
        className="text-xs text-slate-500 hover:text-slate-700 underline"
        onClick={onToggleAdvanced}
      >
        {showAdvancedJson ? 'Hide technical JSON' : 'Show technical JSON (advanced)'}
      </button>

      {showAdvancedJson && (
        <label className="text-sm flex flex-col gap-1">
          <span className="text-slate-500">Conditions (JSON) — for IT staff only</span>
          <textarea
            rows={5}
            className={`${inputClass} font-mono text-xs`}
            value={conditionJsonText}
            onChange={(e) => onConditionJsonTextChange(e.target.value)}
          />
          {conditionJsonError && (
            <span className="text-xs text-red-600">{conditionJsonError}</span>
          )}
        </label>
      )}
    </div>
  );
};
