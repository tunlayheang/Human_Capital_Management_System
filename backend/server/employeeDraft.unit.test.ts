import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillDraftCreateFields, resolveEmployeeStatus } from './employeeDraft.js';

describe('fillDraftCreateFields — placement', () => {
  it('keeps empty department/position as null (does not invent first active placement)', () => {
    const filled = fillDraftCreateFields({
      employee_id: 'ROC00052',
      first_name: 'An',
      last_name: 'Channn',
      department_id: '',
      position_id: '',
    });
    assert.equal(filled.department_id, null);
    assert.equal(filled.position_id, null);
    assert.equal(filled.first_name, 'An');
    assert.equal(filled.last_name, 'Channn');
  });

  it('preserves department/position when the user selected them', () => {
    const filled = fillDraftCreateFields({
      employee_id: 'ROC00052',
      first_name: 'An',
      department_id: 'dept-credit',
      position_id: 'pos-senior',
    });
    assert.equal(filled.department_id, 'dept-credit');
    assert.equal(filled.position_id, 'pos-senior');
  });
});

describe('resolveEmployeeStatus — draft isolation', () => {
  it('keeps an existing draft as draft even when join date / payload looks complete', () => {
    const result = resolveEmployeeStatus({
      previousStatus: 'draft',
      body: {
        employee_id: 'ROC00001',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        phone: '012345678',
        department_id: 'dept-1',
        position_id: 'pos-1',
        join_date: '2020-01-01',
        gender: 'female',
        birth_date: '1990-01-01',
        nationality: 'Cambodian',
        base_salary: 1000,
        time_in: '08:00',
        time_out: '17:00',
        work_days: 5,
        religion: 'Buddhism',
        national_id: 'NID-1',
        passport_number: 'P-1',
        street_address: 'Street 1',
        city: 'Phnom Penh',
        payment_method: 'cash',
      },
    });
    assert.equal(result.status, 'draft');
    assert.equal(result.markOnboardingComplete, false);
  });

  it('does not activate an incomplete draft even with activate_profile', () => {
    const result = resolveEmployeeStatus({
      previousStatus: 'draft',
      body: {
        activate_profile: true,
        first_name: 'Ada',
        last_name: 'Lovelace',
        join_date: '2020-01-01',
      },
    });
    assert.equal(result.status, 'draft');
    assert.equal(result.markOnboardingComplete, false);
  });

  it('honors explicit is_draft / status draft', () => {
    const result = resolveEmployeeStatus({
      previousStatus: 'active',
      body: { is_draft: true, first_name: 'Ada' },
    });
    assert.equal(result.status, 'draft');
  });

  it('keeps placeholder draft emails as draft until explicit Save Draft / activate', () => {
    const result = resolveEmployeeStatus({
      previousStatus: null,
      body: {
        email: 'roc00099@pending.iroc',
        join_date: '2020-01-01',
        first_name: 'Temp',
      },
    });
    assert.equal(result.status, 'draft');
  });

  it('does not invent draft status for incomplete non-draft create payloads', () => {
    const result = resolveEmployeeStatus({
      previousStatus: null,
      body: {
        first_name: 'Temp',
        join_date: '2020-01-01',
      },
    });
    // Route rejects these; resolver must not coerce to draft without is_draft.
    assert.notEqual(result.status, 'draft');
  });
});
