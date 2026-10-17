/**
 * Run: npm run test:payroll-workflow  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPayrollRunTransitionAllowed,
  isPayrollRunLocked,
  normalizeLegacyRunStatus,
} from './payrollWorkflowService.js';

describe('payrollWorkflowService', () => {
  it('normalizes legacy PROCESSING and COMPLETED statuses', () => {
    assert.equal(normalizeLegacyRunStatus('processing'), 'DRAFT');
    assert.equal(normalizeLegacyRunStatus('COMPLETED'), 'APPROVED');
  });

  it('locks inputs after approval but still allows payment transitions', () => {
    assert.equal(isPayrollRunLocked('APPROVED'), true);
    assert.equal(isPayrollRunLocked('DRAFT'), false);
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('APPROVED', 'PAYMENT_PROCESSING')
    );
  });

  it('allows final approval from pending approval', () => {
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('PENDING_APPROVAL', 'APPROVED')
    );
  });

  it('allows return and reject during pending approval', () => {
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('PENDING_APPROVAL', 'DRAFT')
    );
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('PENDING_APPROVAL', 'REJECTED')
    );
  });

  it('preserves legacy lock paths outside pending approval', () => {
    assert.doesNotThrow(() => assertPayrollRunTransitionAllowed('DRAFT', 'LOCKED'));
    assert.doesNotThrow(() => assertPayrollRunTransitionAllowed('UNDER_REVIEW', 'LOCKED'));
  });

  it('blocks skipping approval by locking a pending run', () => {
    assert.throws(
      () => assertPayrollRunTransitionAllowed('PENDING_APPROVAL', 'LOCKED'),
      /cannot transition/
    );
  });

  it('allows payment processing to complete as paid', () => {
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('PAYMENT_PROCESSING', 'PAID')
    );
  });

  it('blocks edits after approval', () => {
    assert.throws(
      () => assertPayrollRunTransitionAllowed('APPROVED', 'DRAFT'),
      /cannot transition/
    );
  });

  it('treats COMPLETED runs like approved for disbursement', () => {
    assert.doesNotThrow(() =>
      assertPayrollRunTransitionAllowed('COMPLETED', 'PAYMENT_PROCESSING')
    );
  });
});
