import React from 'react';
import { Department, Position } from '../../types';
import { inputClass } from '../../constants/designSystem';
import { movementTypeLabel } from '../employee/employeeMovementDisplay';
import { ApproverApprovalField } from '../workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../workflow/ApproverSelectPanel';
import type { ActiveEmployee, MovementFormState } from '../../employeeMovement/movementFormLogic';
import {
  isMetadataMovementType,
  isPlacementMovementType,
  isSalaryMovementType,
  parseSalaryInput,
  resolveActiveEmployeeCompensation,
} from '../../employeeMovement/movementFormLogic';
import {
  contractAmountsEqual,
  formatContractMoneyAmount,
  normalizeContractCurrency,
} from '../../utils/contractMoney';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import {
  resolveDepartmentDisplayName,
  resolvePositionTitle,
} from '../../utils/localizedEntityLabel';

type Props = {
  form: MovementFormState;
  onChange: (patch: Partial<MovementFormState>) => void;
  employee: ActiveEmployee | null;
  departments: Department[];
  positions: Position[];
  selectedApprovers?: WorkflowApproverCandidate[];
  onApproversChange?: (userIds: string[], candidates: WorkflowApproverCandidate[]) => void;
};

export const StepMovementReview: React.FC<Props> = ({
  form,
  onChange,
  employee,
  departments,
  positions,
  selectedApprovers,
  onApproversChange,
}) => {
  const { language } = useLanguage();
  const toDept = departments.find((d) => d.id === form.toDepartmentId);
  const toPos = positions.find((p) => p.id === form.toPositionId);
  const deptName = toDept ? resolveDepartmentDisplayName(toDept, language) : '';
  const posTitle = toPos ? resolvePositionTitle(toPos, language) : '';
  const { base_salary: currentSalary, currency: currentCurrencyRaw } =
    resolveActiveEmployeeCompensation(employee);
  const currentCurrency = normalizeContractCurrency(currentCurrencyRaw);
  const payCurrency = normalizeContractCurrency(form.toCurrency);
  const exchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');
  const newSalary = parseSalaryInput(form.toBaseSalary);
  const includesSalary =
    !isMetadataMovementType(form.movementType) &&
    newSalary != null &&
    newSalary > 0 &&
    !contractAmountsEqual(
      newSalary,
      payCurrency,
      currentSalary,
      currentCurrency,
      exchangeRate
    );

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3 text-sm">
        <h4 className="font-semibold text-slate-900 dark:text-white">Summary</h4>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-slate-600 dark:text-slate-300">
          <div>
            <dt className="text-xs text-slate-500">Employee</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-100">
              {employee
                ? `${resolveEmployeeRecordDisplayName(employee, language)} (${employee.employee_id})`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Movement type</dt>
            <dd className="font-medium">{movementTypeLabel(form.movementType)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Effective date</dt>
            <dd className="font-medium">{form.effectiveDate || '—'}</dd>
          </div>
          {isPlacementMovementType(form.movementType) ? (
            <>
              <div>
                <dt className="text-xs text-slate-500">New department</dt>
                <dd className="font-medium">{deptName || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">New position</dt>
                <dd className="font-medium">{posTitle || '—'}</dd>
              </div>
            </>
          ) : null}
          {form.newContractType ? (
            <div>
              <dt className="text-xs text-slate-500">New contract type</dt>
              <dd className="font-medium">{form.newContractType}</dd>
            </div>
          ) : null}
          {form.newEmploymentStatus ? (
            <div>
              <dt className="text-xs text-slate-500">New employment status</dt>
              <dd className="font-medium">{form.newEmploymentStatus}</dd>
            </div>
          ) : null}
          {includesSalary || isSalaryMovementType(form.movementType) ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Pay change</dt>
              <dd className="font-medium">
                {currentSalary > 0
                  ? `${formatContractMoneyAmount(currentSalary, currentCurrency, exchangeRate)} → `
                  : ''}
                {newSalary != null
                  ? formatContractMoneyAmount(newSalary, payCurrency, exchangeRate)
                  : '—'}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          Reason for change <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={4}
          className={inputClass}
          placeholder="Required — explain why placement or pay is changing (audit trail)."
          required
        />
      </div>

      <ApproverApprovalField
        required
        value={form.assignedApproverUserIds}
        selected={selectedApprovers}
        defaultExpandedDepartmentId={employee?.department_id ?? null}
        onChange={(userIds, candidates) => {
          onChange({ assignedApproverUserIds: userIds });
          onApproversChange?.(userIds, candidates);
        }}
        label="Approvers"
        hint="Assign approvers in order. Each person reviews the full movement details before it routes to the next approver."
        modalTitle="Select movement approvers"
      />
    </div>
  );
};

export default StepMovementReview;
