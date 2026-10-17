import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPrivilegedTaskRole, STAFF_TASK_UPDATE_FIELDS } from './taskAccessService.js';

describe('staff task access policy', () => {
  it('treats Admin/HR as privileged task roles', () => {
    assert.equal(isPrivilegedTaskRole('ADMIN'), true);
    assert.equal(isPrivilegedTaskRole('HR'), true);
    assert.equal(isPrivilegedTaskRole('MANAGER'), false);
    assert.equal(isPrivilegedTaskRole('EMPLOYEE'), false);
  });

  it('limits staff updates to progress fields', () => {
    assert.deepEqual([...STAFF_TASK_UPDATE_FIELDS], ['status', 'progress', 'loggedHours']);
  });
});
