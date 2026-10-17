import { describe, expect, it } from 'vitest';
import type { Position } from '../types';
import {
  defaultMovementFormState,
  suggestSalaryFromPosition,
  validateMovementDetailsStep,
  type ActiveEmployee,
} from './movementFormLogic';

const legalAssociate: Position = {
  id: 'pos-legal',
  title: 'Legal Associate',
  departmentId: 'dep-legal',
  salaryMin: 350,
  salaryMax: 550,
  salary: 420,
};

const employee: ActiveEmployee = {
  employee_id: 'IROC00010',
  first_name: 'Jane',
  last_name: 'Doe',
  department_id: 'dep-legal',
  position_id: 'pos-legal',
  base_salary: 420,
  currency: 'USD',
};

describe('validateMovementDetailsStep salary range', () => {
  it('blocks salary increase above position max', () => {
    const state = defaultMovementFormState({
      movementType: 'salary_increase',
      toBaseSalary: '120000',
    });
    const err = validateMovementDetailsStep(state, employee, legalAssociate);
    expect(err).toMatch(/between/i);
  });

  it('allows salary increase within position range', () => {
    const state = defaultMovementFormState({
      movementType: 'salary_increase',
      toBaseSalary: '500',
    });
    const err = validateMovementDetailsStep(state, employee, legalAssociate);
    expect(err).toBeNull();
  });

  it('blocks optional placement salary above new position max', () => {
    const state = defaultMovementFormState({
      movementType: 'promotion',
      toDepartmentId: 'dep-legal',
      toPositionId: 'pos-legal',
      toBaseSalary: '5000',
    });
    const err = validateMovementDetailsStep(state, employee, legalAssociate);
    expect(err).toMatch(/between/i);
  });

  it('treats equivalent KHR and USD amounts as unchanged pay', () => {
    const khrEmployee: ActiveEmployee = {
      ...employee,
      base_salary: 410_000,
      currency: 'KHR',
    };
    const state = defaultMovementFormState({
      movementType: 'salary_increase',
      toBaseSalary: '100',
      toCurrency: 'USD',
    });
    const err = validateMovementDetailsStep(state, khrEmployee, legalAssociate);
    expect(err).toMatch(/differ from the current/i);
  });
});

describe('suggestSalaryFromPosition', () => {
  it('prefills current salary instead of position max', () => {
    const hrManager: Position = {
      id: 'pos-hr',
      title: 'HR Manager',
      departmentId: 'dep-hr',
      salaryMin: 500,
      salaryMax: 700,
      salary: 600,
    };
    expect(suggestSalaryFromPosition(hrManager, 520, '')).toBe('520');
  });

  it('does not overwrite an entered salary', () => {
    const hrManager: Position = {
      id: 'pos-hr',
      title: 'HR Manager',
      departmentId: 'dep-hr',
      salaryMin: 500,
      salaryMax: 700,
      salary: 600,
    };
    expect(suggestSalaryFromPosition(hrManager, 520, '580')).toBeNull();
  });
});
