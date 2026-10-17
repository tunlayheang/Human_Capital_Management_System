import { describe, expect, it } from 'vitest';
import {
  collectActivationIssueDetails,
  activationBlockersExtended,
} from './employeeActivation';
import type { EmployeeFormValues } from '../pages/EmployeeInput';

function baseValues(overrides: Partial<EmployeeFormValues> = {}): EmployeeFormValues {
  return {
    id: 'ROC00001',
    firstName: 'Ada',
    lastName: 'Lovelace',
    firstNameKh: '',
    lastNameKh: '',
    accessRole: 'employee' as EmployeeFormValues['accessRole'],
    allowLogin: false,
    email: 'ada@example.com',
    gender: 'Female',
    birthDate: '1990-01-01',
    nationality: 'Cambodia',
    religion: 'Buddhism',
    nationalId: '123456789',
    passport: 'N1234567',
    birthCertificate: '',
    phone: '012345678',
    telegramNumber: '',
    departmentId: 'dept-1',
    position: 'pos-1',
    employmentType: 'Full-Time',
    joinDate: '2024-01-01',
    workerType: 'regular',
    probationPeriodMonths: 3,
    probationEnd: '',
    workDays: 5,
    timeIn: '08:00',
    timeOut: '17:00',
    workHours: 8,
    breakDurationMinutes: 60,
    gracePeriodMinutes: 10,
    address: 'Street 1',
    addressKh: '',
    country: 'Cambodia',
    city: 'Phnom Penh',
    cityKh: '',
    website: '',
    maritalStatus: 'single',
    spouseName: '',
    spouseNameKh: '',
    spouseHasWork: 'yes',
    spousePhone: '',
    children: [],
    basicSalary: 500,
    currency: 'USD',
    paymentMethod: 'cash',
    bankName: '',
    bankAccount: '',
    nssfEnrolled: true,
    allowanceTemplateId: '',
    emergencyName: 'Bob',
    emergencyNameKh: '',
    emergencyRelation: 'Spouse',
    emergencyRelationKh: '',
    emergencyPhone: '012345679',
    leaveAssignments: {},
    ...overrides,
  } as EmployeeFormValues;
}

describe('collectActivationIssueDetails', () => {
  it('returns no blockers when profile is complete', () => {
    const issues = collectActivationIssueDetails(baseValues(), {
      avatarUrl: 'https://example.com/a.jpg',
    });
    expect(issues.blockers).toEqual([]);
    expect(issues.fieldErrors).toEqual({});
  });

  it('flags first/last name separately and keeps blocker label', () => {
    const issues = collectActivationIssueDetails(
      baseValues({ firstName: '', lastName: '' }),
      { avatarUrl: 'https://example.com/a.jpg' }
    );
    expect(issues.fieldErrors.firstName).toBeTruthy();
    expect(issues.fieldErrors.lastName).toBeTruthy();
    expect(issues.blockers[0]).toBe('First and last name');
  });

  it('keeps blocker order aligned with activationBlockersExtended', () => {
    const values = baseValues({
      firstName: '',
      departmentId: '',
      basicSalary: 0,
      emergencyName: '',
    });
    const options = { avatarUrl: 'https://example.com/a.jpg' };
    expect(collectActivationIssueDetails(values, options).blockers).toEqual(
      activationBlockersExtended(values, options)
    );
  });

  it('requires bank fields only for non-cash payment', () => {
    const cash = collectActivationIssueDetails(
      baseValues({ paymentMethod: 'cash', bankName: '', bankAccount: '' }),
      { avatarUrl: 'https://example.com/a.jpg' }
    );
    expect(cash.fieldErrors.bankName).toBeUndefined();

    const bank = collectActivationIssueDetails(
      baseValues({ paymentMethod: 'bank', bankName: '', bankAccount: '' }),
      { avatarUrl: 'https://example.com/a.jpg' }
    );
    expect(bank.fieldErrors.bankName).toBeTruthy();
    expect(bank.fieldErrors.bankAccount).toBeTruthy();
  });

  it('does not require a profile photo', () => {
    const issues = collectActivationIssueDetails(baseValues(), { avatarUrl: '' });
    expect(issues.blockers).not.toContain('Profile photo');
    expect(issues.fieldErrors).not.toHaveProperty('avatarUrl');
  });

  it('does not require national ID or passport number', () => {
    const issues = collectActivationIssueDetails(
      baseValues({ nationalId: '', passport: '' }),
      { avatarUrl: '' }
    );
    expect(issues.blockers).not.toContain('National ID number');
    expect(issues.blockers).not.toContain('Passport number');
    expect(issues.fieldErrors.nationalId).toBeUndefined();
    expect(issues.fieldErrors.passport).toBeUndefined();
  });
});
