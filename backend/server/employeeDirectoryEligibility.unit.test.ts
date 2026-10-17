import { describe, expect, it } from 'vitest';
import { hasAssignedEmployeeDisplayId } from './employeeDirectoryEligibility.js';

describe('hasAssignedEmployeeDisplayId', () => {
  it('accepts active employees with badge code and work email', () => {
    expect(
      hasAssignedEmployeeDisplayId({
        employee_id: 'TROC00026',
        status: 'active',
        email: 'theany@company.com',
      })
    ).toBe(true);
  });

  it('rejects draft status even when badge code exists', () => {
    expect(
      hasAssignedEmployeeDisplayId({
        employee_id: 'TROC00024',
        status: 'draft',
        email: 'draft.pending@pending.iroc',
      })
    ).toBe(false);
  });

  it('rejects placeholder onboarding email', () => {
    expect(
      hasAssignedEmployeeDisplayId({
        employee_id: 'TROC00024',
        status: 'active',
        email: 'draft.slug@pending.iroc',
      })
    ).toBe(false);
  });

  it('rejects missing badge code', () => {
    expect(
      hasAssignedEmployeeDisplayId({
        employee_id: '',
        status: 'active',
        email: 'user@company.com',
      })
    ).toBe(false);
  });
});
