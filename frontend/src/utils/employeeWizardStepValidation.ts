import type { EmployeeFormValues } from '../pages/EmployeeInput';
import type { ActivationCheckOptions } from './employeeActivation';
import { validatePositionSalaryValue } from './positionSalary';
import {
  hasValidEmployeePhone,
  hasValidWorkEmail,
  isLikelyDraftPlaceholderPhone,
} from './employeeDraft';

/**
 * Wizard steps that must pass validation before Next / forward stepper navigation.
 * Matches the screens provided for onboarding (not every step is mandatory).
 */
export const MANDATORY_WIZARD_STEP_INDEXES: readonly number[] = [0, 2, 3, 5, 6];

export function isMandatoryWizardStep(stepIndex: number): boolean {
  return MANDATORY_WIZARD_STEP_INDEXES.includes(stepIndex);
}

/** Fields passed to react-hook-form `trigger` per step (only mandatory steps have entries). */
export const STEP_FIELDS_MAP: (keyof EmployeeFormValues)[][] = [
  ['firstName', 'lastName', 'email', 'phone'],
  [],
  ['departmentId', 'position', 'joinDate'],
  ['workDays', 'timeIn', 'timeOut', 'workHours', 'breakDurationMinutes', 'gracePeriodMinutes'],
  [],
  ['maritalStatus', 'spouseName', 'spouseHasWork', 'spousePhone'],
  ['basicSalary', 'paymentMethod', 'bankName', 'bankAccount'],
  [],
  [],
  [],
];

export type WizardStepValidationOptions = ActivationCheckOptions;

export type WizardStepValidationResult = {
  ok: boolean;
  messages: string[];
};

function identityStepMessages(values: EmployeeFormValues): string[] {
  const msgs: string[] = [];
  if (!String(values.id ?? '').trim()) msgs.push('Employee ID');
  if (!String(values.lastName ?? '').trim()) msgs.push('Last name');
  if (!String(values.firstName ?? '').trim()) msgs.push('First name');
  if (!hasValidWorkEmail(values.email)) msgs.push('Valid work email');
  if (
    !hasValidEmployeePhone(values.phone) ||
    isLikelyDraftPlaceholderPhone(values.phone, values.id)
  ) {
    msgs.push('Valid phone number');
  }
  return msgs;
}

function placementStepMessages(values: EmployeeFormValues): string[] {
  const msgs: string[] = [];
  if (!String(values.departmentId ?? '').trim()) msgs.push('Department');
  if (!String(values.position ?? '').trim()) msgs.push('Job position');
  if (!String(values.joinDate ?? '').trim()) msgs.push('Join date');
  return msgs;
}

function scheduleStepMessages(values: EmployeeFormValues): string[] {
  const msgs: string[] = [];
  if (!/^\d{2}:\d{2}$/.test(String(values.timeIn ?? ''))) msgs.push('Time in');
  if (!/^\d{2}:\d{2}$/.test(String(values.timeOut ?? ''))) msgs.push('Time out');
  if (values.workDays == null || Number(values.workDays) < 1) msgs.push('Work days per week');
  if (values.gracePeriodMinutes == null || Number.isNaN(Number(values.gracePeriodMinutes))) {
    msgs.push('Grace period (minutes)');
  }
  if (
    values.breakDurationMinutes == null ||
    Number.isNaN(Number(values.breakDurationMinutes))
  ) {
    msgs.push('Break duration (minutes)');
  }
  return msgs;
}

function familyStepMessages(values: EmployeeFormValues): string[] {
  if (values.maritalStatus !== 'married') return [];
  const msgs: string[] = [];
  if (!String(values.spouseName ?? '').trim()) msgs.push('Spouse name');
  if (values.spouseHasWork !== 'yes' && values.spouseHasWork !== 'no') {
    msgs.push('Spouse employment status');
  }
  if (!String(values.spousePhone ?? '').trim()) msgs.push('Spouse phone');
  return msgs;
}

function payStepMessages(
  values: EmployeeFormValues,
  options?: WizardStepValidationOptions
): string[] {
  const msgs: string[] = [];
  if (
    values.basicSalary === undefined ||
    values.basicSalary === null ||
    Number(values.basicSalary) <= 0
  ) {
    msgs.push('Base salary');
  } else if (options?.selectedPosition) {
    const rangeResult = validatePositionSalaryValue(
      values.basicSalary,
      options.selectedPosition
    );
    if (rangeResult !== true) msgs.push(rangeResult);
  }
  if (values.paymentMethod !== 'cash') {
    if (!String(values.bankName ?? '').trim()) msgs.push('Bank name');
    if (!String(values.bankAccount ?? '').trim()) msgs.push('Bank account number');
  }
  return msgs;
}

function messagesForMandatoryStep(
  stepIndex: number,
  values: EmployeeFormValues,
  _options?: WizardStepValidationOptions
): string[] {
  switch (stepIndex) {
    case 0:
      return identityStepMessages(values);
    case 2:
      return placementStepMessages(values);
    case 3:
      return scheduleStepMessages(values);
    case 5:
      return familyStepMessages(values);
    case 6:
      return payStepMessages(values, _options);
    default:
      return [];
  }
}

/** Step-level checks for mandatory wizard steps only. */
export function validateEmployeeWizardStep(
  stepIndex: number,
  values: EmployeeFormValues,
  options?: WizardStepValidationOptions
): WizardStepValidationResult {
  if (!isMandatoryWizardStep(stepIndex)) {
    return { ok: true, messages: [] };
  }
  const messages = messagesForMandatoryStep(stepIndex, values, options);
  return { ok: messages.length === 0, messages };
}

/** Used on Review / activation — only the mandatory onboarding steps. */
export function validateMandatoryWizardSteps(
  values: EmployeeFormValues,
  options?: WizardStepValidationOptions
): WizardStepValidationResult {
  const messages: string[] = [];
  for (const step of MANDATORY_WIZARD_STEP_INDEXES) {
    const result = validateEmployeeWizardStep(step, values, options);
    if (!result.ok) messages.push(...result.messages);
  }
  const unique = [...new Set(messages)];
  return { ok: unique.length === 0, messages: unique };
}
