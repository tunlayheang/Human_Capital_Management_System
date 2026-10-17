import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleForPayrollRun,
  normalizeEmployeeStatus,
} from './employeePayrollEligibility.js';

describe('normalizeEmployeeStatus — draft isolation', () => {
  it('does not map draft or profile_incomplete to active', () => {
    assert.equal(normalizeEmployeeStatus('draft'), 'draft');
    assert.equal(normalizeEmployeeStatus('profile_incomplete'), 'profile_incomplete');
  });

  it('does not treat missing status as active', () => {
    assert.equal(normalizeEmployeeStatus(null), 'draft');
    assert.equal(normalizeEmployeeStatus(''), 'draft');
  });

  it('keeps known active / pending statuses', () => {
    assert.equal(normalizeEmployeeStatus('active'), 'active');
    assert.equal(normalizeEmployeeStatus('pending_approval'), 'pending_approval');
  });
});

describe('isEligibleForPayrollRun — draft isolation', () => {
  it('excludes draft employees from payroll runs', () => {
    assert.equal(
      isEligibleForPayrollRun({
        employee: { status: 'draft', access_role: 'EMPLOYEE' },
        portalUser: { role: 'EMPLOYEE' },
      }),
      false
    );
  });

  it('allows active employees', () => {
    assert.equal(
      isEligibleForPayrollRun({
        employee: { status: 'active', access_role: 'EMPLOYEE' },
        portalUser: { role: 'EMPLOYEE' },
      }),
      true
    );
  });
});
