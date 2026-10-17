import { ArrowRightLeft, ClipboardCheck, User } from 'lucide-react';
import type { WizardStep } from '../components/EmployeeWizardStepper';
import type { MovementFormState } from './movementFormLogic';
import {
  validateMovementDetailsStep,
  validateMovementEmployeeStep,
  validateMovementReviewStep,
  type ActiveEmployee,
} from './movementFormLogic';
import type { Position } from '../types';

export function getMovementWizardSteps(t: (key: string) => string): WizardStep[] {
  return [
    {
      id: 'employee',
      label: t('employees.movementsWizard.steps.employee.label'),
      description: t('employees.movementsWizard.steps.employee.description'),
      icon: User,
    },
    {
      id: 'details',
      label: t('employees.movementsWizard.steps.details.label'),
      description: t('employees.movementsWizard.steps.details.description'),
      icon: ArrowRightLeft,
    },
    {
      id: 'review',
      label: t('employees.movementsWizard.steps.review.label'),
      description: t('employees.movementsWizard.steps.review.description'),
      icon: ClipboardCheck,
    },
  ];
}

export function maxReachableMovementStep(params: {
  form: MovementFormState;
  employee?: ActiveEmployee;
  salaryRangePosition?: Position;
}): number {
  if (validateMovementEmployeeStep(params.form)) return 0;
  if (validateMovementDetailsStep(params.form, params.employee, params.salaryRangePosition)) {
    return 1;
  }
  return 2;
}

export function validateMovementWizardStep(
  step: number,
  form: MovementFormState,
  employee: ActiveEmployee | undefined,
  salaryRangePosition: Position | undefined
): string | null {
  if (step === 0) return validateMovementEmployeeStep(form);
  if (step === 1) return validateMovementDetailsStep(form, employee, salaryRangePosition);
  if (step === 2) return validateMovementReviewStep(form);
  return null;
}
