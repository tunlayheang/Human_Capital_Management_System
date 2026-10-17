import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Department, Position } from '../../types';
import { inputClass } from '../../constants/designSystem';
import { DatePickerInput } from '../ui/shadcn/date-picker-input';
import type { AppraisalMovementPrefill } from '../appraisal/appraisalMovementUtils';
import {
  CONTRACT_TYPE_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  CREATABLE_MOVEMENT_TYPE_OPTIONS,
  type EmployeeMovementType,
} from '../../types/employeeMovement';
import type { ActiveEmployee, MovementFormState } from '../../employeeMovement/movementFormLogic';
import {
  isMetadataMovementType,
  isPlacementMovementType,
  isSalaryMovementType,
  isContractMovementType,
  isStatusMovementType,
  parseSalaryInput,
  resolveActiveEmployeeCompensation,
} from '../../employeeMovement/movementFormLogic';
import {
  contractInputToUsd,
  contractAmountsEqual,
  formatContractMoneyAmount,
  formatContractMoneyFromUsd,
  formatSignedContractMoneyDelta,
  normalizeContractCurrency,
  usdToKhr,
} from '../../utils/contractMoney';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import {
  hasPositionSalaryRange,
  positionSalaryBounds,
  validateSalaryInPositionRange,
} from '../../utils/positionSalary';
import { clampIsoDateNotBeforeToday, localTodayIsoDate } from '../../utils/leaveCalendar';
import { movementTypeLabel } from '../employee/employeeMovementDisplay';

type Props = {
  form: MovementFormState;
  onChange: (patch: Partial<MovementFormState>) => void;
  employee: ActiveEmployee | null;
  departments: Department[];
  deptPositions: Position[];
  selectedPosition?: Position;
  /** Position whose salary range applies to the pay field (current role or new role). */
  salaryRangePosition?: Position;
  appraisalPrefill?: AppraisalMovementPrefill | null;
  readOnly?: boolean;
};

export const StepMovementDetails: React.FC<Props> = ({
  form,
  onChange,
  employee,
  departments,
  deptPositions,
  selectedPosition,
  salaryRangePosition,
  appraisalPrefill,
  readOnly = false,
}) => {
  const { base_salary: currentSalary, currency: currentCurrencyRaw } =
    resolveActiveEmployeeCompensation(employee);
  const currentCurrency = normalizeContractCurrency(currentCurrencyRaw);
  const payCurrency = 'USD' as const;
  const exchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');
  const parsedNewSalary = parseSalaryInput(form.toBaseSalary);
  const currentSalaryUsd = contractInputToUsd(currentSalary, currentCurrency, exchangeRate);
  const salaryDeltaUsd =
    parsedNewSalary != null &&
    currentSalary > 0 &&
    !contractAmountsEqual(
      parsedNewSalary,
      payCurrency,
      currentSalary,
      currentCurrency,
      exchangeRate
    )
      ? parsedNewSalary - currentSalaryUsd
      : null;
  const positionRangeLabel =
    salaryRangePosition && hasPositionSalaryRange(salaryRangePosition)
      ? (() => {
          const { min, max } = positionSalaryBounds(salaryRangePosition);
          return `${formatContractMoneyFromUsd(min, 'USD', exchangeRate)} – ${formatContractMoneyFromUsd(max, 'USD', exchangeRate)}`;
        })()
      : null;
  const salaryRangeWarning =
    parsedNewSalary != null &&
    parsedNewSalary > 0 &&
    salaryRangePosition &&
    validateSalaryInPositionRange(parsedNewSalary, salaryRangePosition);

  useEffect(() => {
    if (readOnly) return;
    if (form.toCurrency !== 'USD') {
      onChange({ toCurrency: 'USD' });
    }
  }, [form.toCurrency, onChange, readOnly]);

  const showSalaryRangeHint = !!positionRangeLabel;
  const isSalaryUpdate = isSalaryMovementType(form.movementType);
  const isMetadataChange = isMetadataMovementType(form.movementType);
  const isPlacementChange = isPlacementMovementType(form.movementType);
  const minEffectiveDate = localTodayIsoDate();

  useEffect(() => {
    if (readOnly) return;
    if (form.effectiveDate.slice(0, 10) < minEffectiveDate) {
      onChange({ effectiveDate: minEffectiveDate });
    }
  }, [form.effectiveDate, minEffectiveDate, onChange, readOnly]);

  const readOnlyFieldClass = `${inputClass} bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 cursor-default`;

  const detailsDescription = isMetadataChange
    ? 'Contract type and employment status can only change through a movement. Profile updates on the effective date.'
    : isSalaryUpdate
      ? ''
      : 'Record a role or placement change. The employee profile updates on the effective date only.';

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      {appraisalPrefill ? (
        <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-3 py-2 text-sm text-primary-900 dark:text-primary-100">
          <p className="font-medium">From performance appraisal</p>
          <p className="text-xs mt-0.5 opacity-90">
            {appraisalPrefill.employeeName} · {appraisalPrefill.periodName}
            {appraisalPrefill.finalGrade ? ` · Grade ${appraisalPrefill.finalGrade}` : ''}
          </p>
        </div>
      ) : null}

      {detailsDescription ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{detailsDescription}</p>
      ) : null}

      {employee ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-800 dark:text-white">Current: </span>
          {employee.department?.name || 'Department'} · {employee.position?.title || 'Position'}
          {isSalaryUpdate || isPlacementChange ? (
            <>
              {' '}
              ·{' '}
              {currentSalary > 0
                ? `${formatContractMoneyAmount(currentSalary, currentCurrency, exchangeRate)} base salary`
                : 'Base salary not set'}
            </>
          ) : currentSalary > 0 ? (
            <>
              {' '}
              · {formatContractMoneyAmount(currentSalary, currentCurrency, exchangeRate)} base salary
            </>
          ) : null}
          {employee.contract_type ? <> · Contract: {employee.contract_type}</> : null}
          {employee.employment_status ? <> · Status: {employee.employment_status}</> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            Movement type
          </label>
          {readOnly ? (
            <input
              type="text"
              readOnly
              tabIndex={-1}
              value={movementTypeLabel(form.movementType)}
              className={readOnlyFieldClass}
            />
          ) : (
            <select
              value={form.movementType}
              onChange={(e) =>
                onChange({ movementType: e.target.value as EmployeeMovementType })
              }
              className={inputClass}
            >
              {CREATABLE_MOVEMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            Effective date
          </label>
          {readOnly ? (
            <input type="text" readOnly tabIndex={-1} value={form.effectiveDate} className={readOnlyFieldClass} />
          ) : (
            <DatePickerInput
              min={minEffectiveDate}
              value={form.effectiveDate}
              onChange={(e) =>
                onChange({
                  effectiveDate: clampIsoDateNotBeforeToday(e.target.value, minEffectiveDate),
                })
              }
              className={inputClass}
            />
          )}
        </div>
      </div>

      {isContractMovementType(form.movementType) ? (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            New contract type
          </label>
          <select
            value={form.newContractType}
            onChange={(e) => onChange({ newContractType: e.target.value })}
            className={readOnly ? readOnlyFieldClass : inputClass}
            disabled={readOnly}
          >
            <option value="" disabled hidden>Select contract type…</option>
            {CONTRACT_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {isStatusMovementType(form.movementType) ? (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            New employment status
          </label>
          <select
            value={form.newEmploymentStatus}
            onChange={(e) => onChange({ newEmploymentStatus: e.target.value })}
            className={readOnly ? readOnlyFieldClass : inputClass}
            disabled={readOnly}
          >
            <option value="" disabled hidden>Select employment status…</option>
            {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {isPlacementChange ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              New department
            </label>
            <select
              value={form.toDepartmentId}
              onChange={(e) =>
                onChange({ toDepartmentId: e.target.value, toPositionId: '' })
              }
              className={readOnly ? readOnlyFieldClass : inputClass}
              disabled={readOnly}
            >
              <option value="" disabled hidden>Select department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              New position
            </label>
            <select
              value={form.toPositionId}
              onChange={(e) => onChange({ toPositionId: e.target.value })}
              className={readOnly ? readOnlyFieldClass : inputClass}
              disabled={readOnly || !form.toDepartmentId}
            >
              <option value="" disabled hidden>Select position…</option>
              {deptPositions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {!isMetadataChange ? (
        <div className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/15 p-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {isSalaryUpdate ? 'New base salary' : 'Base salary adjustment'}
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 mt-2">
              <span className="font-medium text-slate-800 dark:text-slate-100">
                Current base salary:{' '}
              </span>
              {currentSalary > 0
                ? formatContractMoneyAmount(currentSalary, currentCurrency, exchangeRate)
                : 'Not set on employee record'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {isSalaryUpdate ? 'New base salary (USD)' : 'New base salary (USD, optional)'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.toBaseSalary}
                onChange={(e) => onChange({ toBaseSalary: e.target.value, toCurrency: 'USD' })}
                readOnly={readOnly}
                disabled={readOnly}
                className={`${readOnly ? readOnlyFieldClass : inputClass}${
                  salaryRangeWarning
                    ? ' border-red-500 dark:border-red-500 focus:ring-red-500/25 focus:border-red-500'
                    : ''
                }`}
                aria-invalid={salaryRangeWarning ? true : undefined}
                placeholder={
                  currentSalaryUsd > 0
                    ? `Current: ${formatContractMoneyFromUsd(currentSalaryUsd, 'USD', exchangeRate)}`
                    : 'Enter amount in USD'
                }
              />
              {showSalaryRangeHint ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Position range: {positionRangeLabel}
                </p>
              ) : null}
              {salaryRangeWarning ? (
                <div
                  role="alert"
                  className="mt-2 flex gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                  <p>{salaryRangeWarning}</p>
                </div>
              ) : null}
              {salaryDeltaUsd != null && Math.abs(salaryDeltaUsd) >= 0.005 ? (
                <p
                  className={`mt-1 text-xs font-medium ${
                    salaryDeltaUsd > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {formatSignedContractMoneyDelta(
                    salaryDeltaUsd,
                    'USD',
                    exchangeRate
                  )}{' '}
                  vs current
                </p>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                KHR equivalent
              </label>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                className={`${inputClass} bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 cursor-default`}
                value={
                  parsedNewSalary != null && parsedNewSalary > 0
                    ? Math.round(Number(usdToKhr(parsedNewSalary, exchangeRate))).toLocaleString()
                    : ''
                }
                placeholder=""
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default StepMovementDetails;
