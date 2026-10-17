import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmployeeAllowedSystemAccess,
  isEmployeeActiveForPortal,
  isEmployeeDraftStatus,
  isEmployeeEligibleForAttendanceRoster,
  isEmployeeInactiveForPortal,
} from './employeePortalStatus.js';

describe('isEmployeeEligibleForAttendanceRoster', () => {
  it('treats legacy profile_incomplete like draft (excluded from roster)', () => {
    assert.equal(isEmployeeEligibleForAttendanceRoster('profile_incomplete'), false);
  });

  it('excludes draft and terminated employees', () => {
    assert.equal(isEmployeeEligibleForAttendanceRoster('draft'), false);
    assert.equal(isEmployeeEligibleForAttendanceRoster('terminated'), false);
    assert.equal(isEmployeeInactiveForPortal('terminated'), true);
  });

  it('does not treat missing status as Active', () => {
    assert.equal(isEmployeeEligibleForAttendanceRoster(null), false);
    assert.equal(isEmployeeEligibleForAttendanceRoster(''), false);
    assert.equal(isEmployeeEligibleForAttendanceRoster(undefined), false);
  });

  it('allows only Active employees on the roster', () => {
    assert.equal(isEmployeeEligibleForAttendanceRoster('active'), true);
    assert.equal(isEmployeeEligibleForAttendanceRoster('ACTIVE'), true);
    assert.equal(isEmployeeEligibleForAttendanceRoster('pending_approval'), false);
    assert.equal(isEmployeeEligibleForAttendanceRoster('inactive'), false);
  });
});

describe('system access helpers', () => {
  it('only Active employees have system access', () => {
    assert.equal(isEmployeeAllowedSystemAccess('active'), true);
    assert.equal(isEmployeeAllowedSystemAccess('draft'), false);
    assert.equal(isEmployeeAllowedSystemAccess('profile_incomplete'), false);
    assert.equal(isEmployeeAllowedSystemAccess('pending_approval'), false);
    assert.equal(isEmployeeAllowedSystemAccess('inactive'), false);
  });

  it('blocks draft portal activation', () => {
    assert.equal(isEmployeeDraftStatus('draft'), true);
    assert.equal(isEmployeeDraftStatus('profile_incomplete'), true);
    assert.equal(isEmployeeActiveForPortal('draft'), false);
    assert.equal(isEmployeeActiveForPortal('active'), true);
  });
});
