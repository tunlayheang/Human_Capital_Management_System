import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canViewAllProjects } from './projectAccessService.js';

describe('manager project visibility policy', () => {
  it('Admin and HR can view all projects', () => {
    assert.equal(canViewAllProjects('ADMIN'), true);
    assert.equal(canViewAllProjects('HR'), true);
  });

  it('Manager cannot view all projects (creator-scoped instead)', () => {
    assert.equal(canViewAllProjects('MANAGER'), false);
    assert.equal(canViewAllProjects('EMPLOYEE'), false);
  });
});
