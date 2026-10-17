import React, { useEffect, useMemo } from 'react';
import { Controller, type Control, type FieldValues } from 'react-hook-form';
import { AlertCircle, Award, DollarSign } from 'lucide-react';
import type { AllowanceTemplate, AllowanceType, SalaryBreakdown } from '../../types';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { getRulesConfigHelp } from '../../content/rulesConfigHelpContent';
import {
  WizardField,
  WizardFieldFull,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';
import { applyInputFilter, inputModeForFilter, patternForFilter } from '../../utils/formInputFilters';
import type { PayrollEngineConfig } from '../../utils/payrollEngineConfig';
import {
  buildEmployeeNssfRateParts,
  buildEmployerNssfRateParts,
} from '../../utils/nssfSummary';
import {
  dependentDeductionUsd,
  formatDependentAllowanceUsd,
  taxableSalaryBaseUsd,
} from '../../utils/payrollTaxRate';
import {
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from '../../utils/paymentMethod';
import { BANK_ACCOUNT_FORMAT_HINT, registerDigitsOnly } from '../../utils/digitsOnlyInput';
import {
  PAYROLL_BASIS_DAY_OPTIONS,
  DEFAULT_PAYROLL_BASIS_DAYS,
  normalizePayrollBasisDays,
  payrollBasisDaysLabel,
  type PayrollWorkDayMethod,
} from '../../constants/payrollBasisDays';
import type { Position } from '../../types';
import {
  hasPositionSalaryRange,
  positionSalaryBounds,
  validatePositionSalaryValue,
  formatUsd,
} from '../../utils/positionSalary';
import {
  formatContractMoneyFromUsd,
  normalizeContractCurrency,
  usdToKhr,
  type ContractCurrency,
} from '../../utils/contractMoney';
import type { WizardSeniorityPreview } from '../../utils/seniorityPayPreview';
import {
  seniorityPreviewSummaryLines,
  seniorityTotalAddedToGross,
} from '../../utils/seniorityPayPreview';

interface StepSalaryProps {
  control: Control<FieldValues>;
  register: any;
  errors: Record<string, any>;
  estimatedPay: SalaryBreakdown;
  taxRate: number;
  taxBracketRange?: string;
  taxDependents?: number;
  setValue: (name: string, value: unknown, options?: Record<string, unknown>) => void;
  watchPaymentMethod: PaymentMethod;
  watchNssfEnrolled: boolean;
  engineConfig: PayrollEngineConfig;
  allowanceTemplates: AllowanceTemplate[];
  allowanceTypes: AllowanceType[];
  allowanceTemplateId: string;
  onAllowanceTemplateChange: (templateId: string) => void;
  templatesLoading?: boolean;
  allowancePreviewLoading?: boolean;
  selectedPosition?: Pick<Position, 'title' | 'salaryMin' | 'salaryMax' | 'salary'>;
  wizardSeniority: WizardSeniorityPreview;
  joinDate?: string;
  previewMonth: string;
  /** Pay currency from the form — USD default; overview shows KHR only when KHR. */
  watchCurrency?: ContractCurrency;
  /** Company work-day policy — locks basis days when Fixed Company Basis is active. */
  workDayMethod?: PayrollWorkDayMethod;
  companyBasisDays?: number;
}

const fmtUsd = (n?: number) =>
  `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function TaxRateSummaryPanel({
  taxRate,
  taxBracketRange,
  grossForTax,
  taxableBase,
  taxDependents,
  dependentDeduction,
  dependentAllowanceUsd,
  estimatedTaxUsd,
  formatMoney = fmtUsd,
}: {
  taxRate: number;
  taxBracketRange?: string;
  grossForTax: number;
  taxableBase: number;
  taxDependents: number;
  dependentDeduction: number;
  dependentAllowanceUsd: string;
  estimatedTaxUsd: number;
  formatMoney?: (usd: number) => string;
}) {
  const rowClass =
    'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 items-baseline text-xs text-slate-600 dark:text-slate-400';

  return (
    <div className="relative md:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 p-4 sm:p-5">
      <RulesConfigHelp help="wizard.salary.taxOnSalary" className="absolute top-3 right-3 z-10" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 pr-8">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Tax on salary (ToS)</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            From Payroll Rules · GDT marginal brackets
          </p>
        </div>
        <div
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-100 dark:bg-violet-900/40 px-3 py-1.5"
          aria-label={`Marginal tax rate ${taxRate}%`}
        >
          <span className="text-2xl font-bold tabular-nums text-violet-800 dark:text-violet-200 leading-none">
            {taxRate}%
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600/90 dark:text-violet-300/90">
            rate
          </span>
        </div>
      </div>

      {taxBracketRange ? (
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Income bracket:{' '}
          <span className="font-medium text-slate-800 dark:text-slate-200">{taxBracketRange}</span>
        </p>
      ) : null}

      {taxDependents === 0 ? (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 p-3 space-y-2">
            <div className={rowClass}>
              <span>Gross salary</span>
              <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                {formatMoney(grossForTax)}
              </span>
            </div>
            <div
              className={`${rowClass} pt-2 border-t border-slate-200 dark:border-slate-600 font-semibold text-slate-800 dark:text-slate-200`}
            >
              <span>Taxable base</span>
              <span className="tabular-nums">{formatMoney(taxableBase)}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50 rounded-xl px-3 py-2.5">
            Add spouse/children on the <strong>Family</strong> step for relief (
            {dependentAllowanceUsd} per dependent).
          </p>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 p-3 space-y-2">
          <div className={rowClass}>
            <span>Gross salary</span>
            <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
              {formatMoney(grossForTax)}
            </span>
          </div>
          <div className={rowClass}>
            <span>
              Dependent relief ({taxDependents} × {dependentAllowanceUsd})
            </span>
            <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
              −{formatMoney(dependentDeduction)}
            </span>
          </div>
          <div
            className={`${rowClass} pt-2 border-t border-slate-200 dark:border-slate-600 font-semibold text-slate-800 dark:text-slate-200`}
          >
            <span>Taxable base</span>
            <span className="tabular-nums">{formatMoney(taxableBase)}</span>
          </div>
          {estimatedTaxUsd > 0 ? (
            <div className={`${rowClass} text-slate-500 dark:text-slate-400`}>
              <span>Est. tax this month</span>
              <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
                {formatMoney(estimatedTaxUsd)}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SenioritySummaryPanel({
  wizardSeniority,
  baseSalary,
  joinDate,
  previewMonth,
  engineConfig,
  indemnityUsd,
  formatMoney = fmtUsd,
}: {
  wizardSeniority: WizardSeniorityPreview;
  baseSalary: number;
  joinDate?: string;
  previewMonth: string;
  engineConfig: PayrollEngineConfig;
  indemnityUsd: number;
  formatMoney?: (usd: number) => string;
}) {
  const rowClass =
    'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 items-start text-xs text-slate-600 dark:text-slate-400';

  const summaryLines = useMemo(
    () =>
      seniorityPreviewSummaryLines({
        baseSalary,
        joinDate,
        monthPrefix: previewMonth,
        engineConfig,
        wizardSeniority,
        serviceEntitlementUsd: 0,
        indemnityUsd,
      }).filter((line) => !/service seniority/i.test(line.label)),
    [baseSalary, joinDate, previewMonth, engineConfig, wizardSeniority, indemnityUsd]
  );

  const totalSeniority = seniorityTotalAddedToGross(0, indemnityUsd);
  const indemnityActive =
    wizardSeniority.indemnityPreview != null &&
    wizardSeniority.indemnityPreview.ineligibleReason !== 'no_active_policy' &&
    wizardSeniority.indemnityPreview.ineligibleReason !== 'disabled';

  return (
    <div className="relative md:col-span-2 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 sm:p-5">
      <RulesConfigHelp help="wizard.salary.serviceSeniority" className="absolute top-3 right-3 z-10" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3 pr-8">
        <div className="flex items-start gap-2 min-w-0">
          <Award className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Siniority</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              From Payroll → Rules → Siniority · Jun/Dec preview for {previewMonth}
            </p>
          </div>
        </div>
        {wizardSeniority.indemnityLoading ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Loading…
          </span>
        ) : indemnityActive ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2 py-1 rounded-lg border border-amber-200/80 dark:border-amber-800/60">
            Policy active
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
            Inactive
          </span>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 p-3 space-y-3">
        {summaryLines.map((line, idx) => (
          <div key={`${line.label}-${idx}`} className={rowClass}>
            <span className={line.muted ? 'text-slate-500' : ''}>
              <span className="font-medium text-slate-800 dark:text-slate-200">{line.label}</span>
              {line.detail ? (
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  {line.detail}
                </span>
              ) : null}
            </span>
            {line.amount != null ? (
              <span
                className={`tabular-nums shrink-0 font-medium ${
                  line.muted ? 'text-slate-400' : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {formatMoney(line.amount)}
              </span>
            ) : null}
          </div>
        ))}
        <div
          className={`${rowClass} pt-2 border-t border-slate-200 dark:border-slate-600 font-semibold text-slate-800 dark:text-slate-200`}
        >
          <span>Added to gross this month</span>
          <span className="tabular-nums text-amber-700 dark:text-amber-300">{formatMoney(totalSeniority)}</span>
        </div>
      </div>
    </div>
  );
}

function NssfEmployeeBreakdownPanel({
  assumedWageKhr,
  rows,
  totalKhr,
  deductionUsd,
  formatMoney = fmtUsd,
}: {
  assumedWageKhr: number;
  rows: Array<{ label: string; khr: number }>;
  totalKhr: number;
  deductionUsd: number;
  formatMoney?: (usd: number) => string;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600 space-y-3">
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Assumed contributory wage:{' '}
        <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
          {assumedWageKhr.toLocaleString()} KHR
        </span>
      </p>
      <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 p-3 text-xs space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 items-baseline text-slate-600 dark:text-slate-400"
          >
            <span className="min-w-0">{row.label}</span>
            <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200 shrink-0 whitespace-nowrap">
              {row.khr.toLocaleString()} KHR
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 pt-2 border-t border-slate-200 dark:border-slate-600 font-semibold text-slate-800 dark:text-slate-200">
          <span>Total (KHR)</span>
          <span className="tabular-nums shrink-0 whitespace-nowrap">{totalKhr.toLocaleString()} KHR</span>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Estimated deduction from pay:{' '}
        <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
          {formatMoney(deductionUsd)}
        </span>
      </p>
    </div>
  );
}

export const StepSalary: React.FC<StepSalaryProps> = ({
  control,
  register,
  errors,
  estimatedPay,
  taxRate,
  taxBracketRange,
  taxDependents = 0,
  setValue,
  watchPaymentMethod,
  watchNssfEnrolled,
  engineConfig,
  allowanceTemplates,
  allowanceTypes,
  allowanceTemplateId,
  onAllowanceTemplateChange,
  templatesLoading,
  allowancePreviewLoading,
  selectedPosition,
  wizardSeniority,
  joinDate,
  previewMonth,
  watchCurrency = 'USD',
  workDayMethod = 'fixed_employee_basis',
  companyBasisDays = DEFAULT_PAYROLL_BASIS_DAYS,
}) => {
  const payCurrency = normalizeContractCurrency(watchCurrency);
  const companyLocked = workDayMethod === 'fixed_company_basis';
  const lockedBasisDays = normalizePayrollBasisDays(companyBasisDays);
  const { allowances, deductions, overtime, exchangeRate, nssfDetail, baseSalary } = estimatedPay;
  /** Contract salary is always USD; KHR is a read-only FX mirror. */
  useEffect(() => {
    setValue('currency', 'USD', { shouldDirty: false, shouldValidate: false });
  }, [setValue]);
  const fmtMoney = (usd: number) => formatContractMoneyFromUsd(usd, 'USD', exchangeRate);
  const salaryBounds = selectedPosition ? positionSalaryBounds(selectedPosition) : null;
  const positionRangeHint =
    selectedPosition && hasPositionSalaryRange(selectedPosition) && salaryBounds
      ? `Allowed for this position: ${formatUsd(salaryBounds.min)} – ${formatUsd(salaryBounds.max)}`
      : undefined;
  const salaryRangeError =
    typeof errors.basicSalary?.message === 'string' ? errors.basicSalary.message : undefined;
  const showRangeAlert =
    !!salaryRangeError &&
    !!selectedPosition &&
    hasPositionSalaryRange(selectedPosition);
  const allowanceLines = estimatedPay.allowanceLines ?? [];
  const showFullAllowanceCatalog = allowanceTypes.length > 0;
  const packageTypeIds = allowanceTemplateId
    ? new Set(
        (allowanceTemplates.find((t) => t.id === allowanceTemplateId)?.items ?? []).map(
          (it) => String(it.allowance_type_id)
        )
      )
    : null;
  const grossForTax = estimatedPay.grossSalary ?? baseSalary;
  const dependentDeduction = dependentDeductionUsd(taxDependents, exchangeRate);
  const taxableBase = taxableSalaryBaseUsd(grossForTax, taxDependents, exchangeRate);
  const nssfCapUsd =
    Math.round((engineConfig.nssfPensionEmployeeCapKhr / exchangeRate) * 100) / 100;
  const employeeNssfRateParts = buildEmployeeNssfRateParts(engineConfig);
  const employerNssfRateParts = buildEmployerNssfRateParts(engineConfig);
  const belowMinWage =
    baseSalary > 0 && baseSalary < engineConfig.minimumWageUsd;

  const seniorityIndemnityUsd = estimatedPay.seniorityIndemnity ?? 0;
  const seniorityGrossTotal = seniorityTotalAddedToGross(0, seniorityIndemnityUsd);
  const seniorityOverviewLines = useMemo(
    () =>
      seniorityPreviewSummaryLines({
        baseSalary,
        joinDate,
        monthPrefix: previewMonth,
        engineConfig,
        wizardSeniority,
        serviceEntitlementUsd: 0,
        indemnityUsd: seniorityIndemnityUsd,
      }).filter((line) => line.amount != null && line.amount > 0),
    [baseSalary, joinDate, previewMonth, engineConfig, wizardSeniority, seniorityIndemnityUsd]
  );

  const allowancePackageHelpBase = getRulesConfigHelp('wizard.salary.allowancePackage');
  const allowancePackageHelp = {
    ...allowancePackageHelpBase,
    summary: estimatedPay.allowancePackageName
      ? `Active: ${estimatedPay.allowancePackageName}`
      : allowanceTemplateId
        ? 'Allowance package selected.'
        : 'Uses matching package or active allowance rules (same as Payroll preview).',
    notes: [allowancePackageHelpBase.summary],
  };

  const nssfBreakdownRows: Array<{ label: string; khr: number }> = [];
  if (watchNssfEnrolled && nssfDetail) {
    if (
      engineConfig.nssfHealthcareEmployeePct > 0 &&
      (nssfDetail.employeeHealthcareKhr ?? 0) > 0
    ) {
      nssfBreakdownRows.push({
        label: `Health care (${engineConfig.nssfHealthcareEmployeePct}%)`,
        khr: nssfDetail.employeeHealthcareKhr ?? 0,
      });
    }
    if (
      engineConfig.nssfOccupationalRiskEmployeePct > 0 &&
      (nssfDetail.employeeOccupationalRiskKhr ?? 0) > 0
    ) {
      nssfBreakdownRows.push({
        label: `Occupational risk (${engineConfig.nssfOccupationalRiskEmployeePct}%)`,
        khr: nssfDetail.employeeOccupationalRiskKhr ?? 0,
      });
    }
    if (engineConfig.nssfPensionEmployeePct > 0 && nssfDetail.employeePensionKhr > 0) {
      nssfBreakdownRows.push({
        label: `Pension (${engineConfig.nssfPensionEmployeePct}%)`,
        khr: nssfDetail.employeePensionKhr,
      });
    }
  }
  const nssfTotalKhr =
    nssfDetail?.employeeTotalKhr ?? nssfDetail?.employeePensionKhr ?? 0;

  return (
    <WizardStepStack>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-5">
          <WizardSectionCard
            icon={DollarSign}
            title="Pay & banking"
          >
            {showRangeAlert ? (
              <div
                role="alert"
                className="md:col-span-2 flex gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
              >
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
                <p>{salaryRangeError}</p>
              </div>
            ) : null}
            <WizardFieldGrid>
              <WizardField
                label="Basic salary (USD)"
                required
                error={salaryRangeError}
                hint={
                  salaryRangeError
                    ? undefined
                    : positionRangeHint ??
                      (belowMinWage
                        ? `Below sector minimum wage reference ($${engineConfig.minimumWageUsd}/month per Payroll Rules).`
                        : 'Enter salary in USD. KHR equivalent is calculated from the payroll exchange rate.')
                }
              >
                <Controller
                  name="basicSalary"
                  control={control}
                  rules={{
                    validate: (value) =>
                      validatePositionSalaryValue(Number(value) || 0, selectedPosition),
                  }}
                  render={({ field }) => (
                    <input
                      type="text"
                      inputMode={inputModeForFilter('decimal')}
                      pattern={patternForFilter('decimal')}
                      aria-invalid={showRangeAlert ? true : undefined}
                      className={`${WIZARD_INPUT_CLASS}${
                        showRangeAlert
                          ? ' border-red-500 dark:border-red-500 focus:ring-red-500/25 focus:border-red-500'
                          : ''
                      }`}
                      value={field.value === 0 || field.value == null ? '' : String(field.value)}
                      onChange={(e) => {
                        const filtered = applyInputFilter('decimal', e.target.value, {
                          maxDecimals: 2,
                          maxLength: 12,
                        });
                        const parsed = filtered === '' || filtered === '.' ? 0 : Number(filtered);
                        field.onChange(Number.isFinite(parsed) ? parsed : 0);
                      }}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      min={salaryBounds && salaryBounds.max > 0 ? salaryBounds.min : 0}
                      max={salaryBounds && salaryBounds.max > 0 ? salaryBounds.max : undefined}
                      step="0.01"
                    />
                  )}
                />
              </WizardField>
              <WizardField
                label="KHR equivalent"
                hint={`FX ${exchangeRate.toLocaleString()} KHR/USD — view only`}
              >
                <input
                  type="text"
                  readOnly
                  tabIndex={-1}
                  aria-readonly="true"
                  className={`${WIZARD_INPUT_CLASS} bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 cursor-default`}
                  value={
                    baseSalary > 0
                      ? Math.round(Number(usdToKhr(baseSalary, exchangeRate))).toLocaleString()
                      : ''
                  }
                  placeholder="—"
                />
              </WizardField>
              <WizardField
                label="Payroll basis days"
              >
                <select
                  {...register('payrollBasisDays', { valueAsNumber: true })}
                  className={`${WIZARD_SELECT_CLASS}${
                    companyLocked
                      ? ' bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                      : ''
                  }`}
                  disabled={companyLocked}
                  aria-readonly={companyLocked || undefined}
                  defaultValue={companyLocked ? lockedBasisDays : DEFAULT_PAYROLL_BASIS_DAYS}
                >
                  {PAYROLL_BASIS_DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {payrollBasisDaysLabel(d)}
                    </option>
                  ))}
                </select>
              </WizardField>
              <WizardFieldFull>
                <WizardField label="Payment method" required error={errors.paymentMethod?.message}>
                  <div className="flex flex-wrap gap-3">
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                          watchPaymentMethod === opt.value
                            ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-100'
                            : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                        }`}
                      >
                        <input
                          type="radio"
                          value={opt.value}
                          className="sr-only"
                          {...register('paymentMethod', {
                            onChange: (e: { target: { value: string } }) => {
                              if (e.target.value === 'cash') {
                                setValue('bankName', '', { shouldDirty: true });
                                setValue('bankAccount', '', { shouldDirty: true });
                              }
                            },
                          })}
                        />
                        <span className="text-sm font-medium">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </WizardField>
              </WizardFieldFull>
              {watchPaymentMethod === 'bank' ? (
                <>
                  <WizardField label="Bank name" required error={errors.bankName?.message}>
                    <input {...register('bankName')} className={WIZARD_INPUT_CLASS} />
                  </WizardField>
                  <WizardField label="Bank account" required error={errors.bankAccount?.message}>
                    <input
                      {...registerDigitsOnly(register, 'bankAccount', { maxLength: 20 })}
                      placeholder={BANK_ACCOUNT_FORMAT_HINT}
                      className={`${WIZARD_INPUT_CLASS} font-mono tracking-wide`}
                    />
                  </WizardField>
                </>
              ) : (
                <WizardFieldFull>
                  <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
                    Salary will be paid in cash. Bank details are not required.
                  </p>
                </WizardFieldFull>
              )}
              <WizardFieldFull>
                <WizardField
                  label={
                    <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                      <span className="text-xs font-semibold uppercase tracking-wide">
                        Allowance package
                      </span>
                      <RulesConfigHelp help={allowancePackageHelp} />
                    </span>
                  }
                >
                  <select
                    value={allowanceTemplateId}
                    disabled={templatesLoading}
                    onChange={(e) => onAllowanceTemplateChange(e.target.value)}
                    className={WIZARD_SELECT_CLASS}
                  >
                    <option value="">No allowance</option>
                    {allowanceTemplates
                      .filter((t) => t.active !== false)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.template_name}
                        </option>
                      ))}
                  </select>
                  {allowancePreviewLoading ? (
                    <p className="mt-1 text-xs text-slate-500">Updating preview…</p>
                  ) : null}
                </WizardField>
              </WizardFieldFull>
            </WizardFieldGrid>
          </WizardSectionCard>

          <div className="space-y-5">
            <TaxRateSummaryPanel
              taxRate={taxRate}
              taxBracketRange={taxBracketRange}
              grossForTax={grossForTax}
              taxableBase={taxableBase}
              taxDependents={taxDependents}
              dependentDeduction={dependentDeduction}
              dependentAllowanceUsd={formatDependentAllowanceUsd(exchangeRate)}
              estimatedTaxUsd={deductions.taxOnSalary}
              formatMoney={fmtMoney}
            />
            <SenioritySummaryPanel
              wizardSeniority={wizardSeniority}
              baseSalary={baseSalary}
              joinDate={joinDate}
              previewMonth={previewMonth}
              engineConfig={engineConfig}
              indemnityUsd={seniorityIndemnityUsd}
              formatMoney={fmtMoney}
            />
            <div className="surface-card/80 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">NSSF enrolled</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Rates from Payroll Rules. Pension employee share capped at{' '}
                {engineConfig.nssfPensionEmployeeCapKhr.toLocaleString()} KHR/mo (~
                {fmtMoney(nssfCapUsd)}).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={watchNssfEnrolled}
              onClick={() =>
                setValue('nssfEnrolled', !watchNssfEnrolled, { shouldValidate: true, shouldDirty: true })
              }
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                watchNssfEnrolled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                  watchNssfEnrolled ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {!watchNssfEnrolled ? (
            <p className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400">
              NSSF employee deductions are not applied.
            </p>
          ) : nssfDetail && nssfBreakdownRows.length > 0 ? (
            <NssfEmployeeBreakdownPanel
              assumedWageKhr={nssfDetail.assumedWageKhr}
              rows={nssfBreakdownRows}
              totalKhr={nssfTotalKhr}
              deductionUsd={deductions.nssf}
              formatMoney={fmtMoney}
            />
          ) : (
            <p className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400">
              No employee NSSF % configured in Payroll Rules.
            </p>
          )}

          {employerNssfRateParts.length > 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
              Employer NSSF (company cost, not deducted from pay):{' '}
              {employerNssfRateParts.join(' · ')}
            </p>
          ) : null}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 min-w-0 relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-gradient-to-br from-white via-slate-50/80 to-primary-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-primary-950/25 text-slate-900 dark:text-slate-100 shadow-sm">
          {/* Pay-slip accent rail */}
          <div
            className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary-400 via-primary-500 to-teal-600"
            aria-hidden
          />
          {/* Soft ledger watermark */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-18deg, transparent, transparent 11px, rgb(72 182 198 / 0.07) 11px, rgb(72 182 198 / 0.07) 12px)',
            }}
            aria-hidden
          />

          <div className="relative pl-5 sm:pl-6 pr-5 sm:pr-6 py-5 sm:py-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-primary-500/10 dark:bg-primary-400/15 border border-primary-500/25 dark:border-primary-400/30 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-primary-600 dark:text-primary-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">
              Salary Overview
            </h3>
          </div>
        </div>

        <div className="space-y-2 text-sm rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/70 dark:bg-slate-950/35 px-3.5 py-3 mb-3">
          <div className="flex justify-between gap-4 min-w-0">
            <span className="text-slate-500 dark:text-slate-400">Base salary</span>
            <span className="font-medium tabular-nums shrink-0 text-slate-900 dark:text-white">
              {fmtMoney(baseSalary)}
            </span>
          </div>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mt-2 mb-1 tracking-wide">
            Allowances
          </p>
          {showFullAllowanceCatalog ? (
            allowanceLines.map((line) => {
              const typeMeta = allowanceTypes.find(
                (t) => String(t.code).toUpperCase() === String(line.code).toUpperCase()
              );
              const inPackage =
                packageTypeIds != null &&
                packageTypeIds.size > 0 &&
                typeMeta != null &&
                packageTypeIds.has(typeMeta.id);
              const muted =
                Boolean(allowanceTemplateId) && !inPackage && line.amount <= 0;
              return (
                <div
                  key={line.code}
                  className={`flex justify-between gap-3 ${
                    muted
                      ? 'text-slate-400 dark:text-slate-500'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="min-w-0 truncate">{line.name}</span>
                  <span className="shrink-0 tabular-nums">{fmtMoney(line.amount)}</span>
                </div>
              );
            })
          ) : allowanceLines.length > 0 ? (
            allowanceLines.map((line) => (
              <div
                key={line.code}
                className="flex justify-between text-slate-700 dark:text-slate-300 gap-3"
              >
                <span className="min-w-0 truncate">{line.name}</span>
                <span className="shrink-0 tabular-nums">{fmtMoney(line.amount)}</span>
              </div>
            ))
          ) : (
            <>
              <div className="flex justify-between text-slate-700 dark:text-slate-300">
                <span>Transport</span>
                <span>{fmtMoney(allowances.transport)}</span>
              </div>
              <div className="flex justify-between text-slate-700 dark:text-slate-300">
                <span>Attendance</span>
                <span>{fmtMoney(allowances.attendance)}</span>
              </div>
              <div className="flex justify-between text-slate-700 dark:text-slate-300">
                <span>Meal</span>
                <span>{fmtMoney(allowances.meal)}</span>
              </div>
            </>
          )}
          {allowanceTemplateId && showFullAllowanceCatalog ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              Highlighted types are in the selected package; amounts follow active payroll
              allowance rules.
            </p>
          ) : !allowanceTemplateId &&
            showFullAllowanceCatalog &&
            allowanceLines.some((l) => l.amount > 0) ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              Amounts from active allowance rules (same engine as Payroll preview).
            </p>
          ) : null}

          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mt-3 mb-1 flex items-center gap-1.5">
            <Award className="w-3 h-3 text-amber-500 dark:text-amber-400/80" />
            Siniority
          </p>
          {wizardSeniority.indemnityLoading ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Loading siniority preview…</p>
          ) : seniorityGrossTotal > 0 ? (
            <>
              {seniorityIndemnityUsd > 0 ? (
                <div className="flex justify-between text-slate-700 dark:text-slate-300 gap-3 mt-1">
                  <span className="min-w-0">
                    Jun/Dec siniority
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      {engineConfig.seniorityPayoutJuneDays} days · {previewMonth.slice(0, 7)} payout
                      month
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{fmtMoney(seniorityIndemnityUsd)}</span>
                </div>
              ) : null}
              {seniorityOverviewLines.map((line) =>
                line.amount != null && line.amount > 0 ? (
                  <p
                    key={line.label}
                    className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 pl-0.5"
                  >
                    {line.label}: {line.detail}
                  </p>
                ) : null
              )}
              <div className="flex justify-between text-amber-700 dark:text-amber-200/90 gap-3 mt-2 pt-2 border-t border-slate-200 dark:border-slate-600/50 text-xs font-medium">
                <span>Siniority subtotal</span>
                <span className="tabular-nums">{fmtMoney(seniorityGrossTotal)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No siniority this month (inactive policy, eligibility, or non-payout month).
            </p>
          )}

          {(overtime.total > 0 || overtime.hours150 > 0 || overtime.hours200 > 0) && (
            <>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mt-2 mb-1">
                Overtime (approved requests only)
              </p>
              <div className="flex justify-between text-slate-700 dark:text-slate-300 text-xs">
                <span>
                  Daytime ({engineConfig.otMultiplierNormal}x) · {overtime.hours150}h
                </span>
                <span>{fmtMoney(overtime.amount150)}</span>
              </div>
              <div className="flex justify-between text-slate-700 dark:text-slate-300 text-xs">
                <span>
                  Premium / night ({engineConfig.otMultiplierPremium}x) · {overtime.hours200}h
                </span>
                <span>{fmtMoney(overtime.amount200)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-semibold text-slate-900 dark:text-white border-t border-dashed border-slate-300/80 dark:border-slate-600 mt-2 pt-2">
            <span>Gross</span>
            <span className="tabular-nums">{fmtMoney(estimatedPay.grossSalary)}</span>
          </div>
        </div>

        <div className="space-y-3 text-sm mb-4 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/70 dark:bg-slate-950/35 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1 tracking-wide">
            Deductions
          </p>
          <div className="flex justify-between gap-3 text-slate-700 dark:text-slate-300">
            <span>
              NSSF (employee)
              {!watchNssfEnrolled ? (
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                  Not enrolled
                </span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-slate-900 dark:text-white">
              {fmtMoney(watchNssfEnrolled ? deductions.nssf : 0)}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-slate-700 dark:text-slate-300">
            <span>
              Tax on salary (ToS)
              <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                {taxRate}% bracket · {taxDependents} dependent{taxDependents === 1 ? '' : 's'}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{fmtMoney(deductions.taxOnSalary)}</span>
          </div>
        </div>

        {/* Take-home banner — distinct from line items */}
        <div className="relative mb-3 overflow-hidden rounded-2xl border border-primary-200/80 dark:border-primary-800/50 bg-gradient-to-r from-primary-50 via-white to-teal-50/90 dark:from-primary-950/50 dark:via-slate-900 dark:to-teal-950/30 px-4 py-4">
          <div
            className="absolute top-0 inset-x-6 h-px bg-gradient-to-r from-transparent via-primary-400/70 to-transparent"
            aria-hidden
          />
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">
                Net salary
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Estimated take-home
              </p>
              {payCurrency === 'KHR' ? (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">
                  FX ref. {exchangeRate.toLocaleString()} KHR/USD
                </p>
              ) : null}
            </div>
            <p className="text-3xl sm:text-[2rem] font-bold tabular-nums tracking-tight text-slate-900 dark:text-white shrink-0">
              {fmtMoney(estimatedPay.netSalary)}
            </p>
          </div>
        </div>

          </div>
        </div>
      </div>
    </WizardStepStack>
  );
};

