/**
 * Run: npm run test:payroll-attendance  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePayrollAttendanceMetrics } from './payrollAttendanceMetrics.js';
import { resolveTaxDependentsFromEmployeeAndChildren } from '../employeeChildrenService.js';
import { buildPayrollAttendanceSnapshot } from './payrollAttendanceSnapshot.js';

describe('resolveTaxDependentsFromEmployeeAndChildren', () => {
  it('uses stored salary-structure count when child rows are not synced', () => {
    assert.equal(
      resolveTaxDependentsFromEmployeeAndChildren(
        { marital_status: 'married', tax_dependents: 2 },
        []
      ),
      2
    );
  });

  it('counts children without paid work when married', () => {
    assert.equal(
      resolveTaxDependentsFromEmployeeAndChildren(
        { marital_status: 'married', spouse_occupation: 'yes' },
        [
          {
            id: 1,
            childNumber: 1,
            name: 'A',
            nameKh: null,
            age: 5,
            gender: null,
            occupation: null,
            hasJob: 'no',
            isTaxDependent: true,
          },
        ]
      ),
      1
    );
  });
});

describe('computePayrollAttendanceMetrics', () => {
  it('counts ABSENT only — not unpaid leave', () => {
    const absentDates = ['2026-05-23', '2026-05-24', '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31'];
    const attendance = [
      ...absentDates.map((date) => ({ date, status: 'ABSENT' })),
      {
        date: '2026-05-05',
        status: 'UNPAID_LEAVE',
        clockIn: '07:55',
        clockOut: '17:25',
      },
      { date: '2026-05-06', status: 'PRESENT', clockIn: '08:00', clockOut: '17:00' },
    ];

    const metrics = computePayrollAttendanceMetrics({
      attendance,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      workDaysCap: 26,
    });

    assert.equal(metrics.absentDays, 9);
    assert.equal(metrics.unpaidLeaveDays, 1);
    assert.equal(metrics.presentDays, 1);
  });

  it('sums work hours from attendance rows in the employment window', () => {
    const attendance = [
      {
        date: '2026-05-06',
        status: 'PRESENT',
        clockIn: '2026-05-06T08:00:00',
        clockOut: '2026-05-06T17:00:00',
      },
      {
        date: '2026-05-07',
        status: 'PRESENT',
        clockIn: '2026-05-07T08:00:00',
        clockOut: '2026-05-07T17:00:00',
      },
      { date: '2026-05-08', status: 'ABSENT' },
    ];

    const metrics = computePayrollAttendanceMetrics({
      attendance,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      workDaysCap: 26,
    });

    assert.equal(metrics.recordsInPeriod, 3);
    assert.equal(metrics.presentDays, 2);
    assert.equal(metrics.absentDays, 1);
    assert.equal(metrics.totalWorkHours, 18);
  });

  it('does not count roster preview ABSENT (grid placeholder) as payroll absent', () => {
    const metrics = computePayrollAttendanceMetrics({
      attendance: [
        { date: '2026-05-06', status: 'ABSENT', isGridPlaceholder: true },
        { date: '2026-05-07', status: 'ABSENT' },
      ],
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      workDaysCap: 26,
    });
    assert.equal(metrics.absentDays, 1);
    assert.equal(metrics.recordsInPeriod, 2);
  });

  it('does not count DAY_OFF as present or absent', () => {
    const metrics = computePayrollAttendanceMetrics({
      attendance: [
        { date: '2026-05-02', status: 'DAY_OFF' },
        { date: '2026-05-06', status: 'PRESENT', clockIn: '2026-05-06T08:00:00', clockOut: '2026-05-06T17:00:00' },
        { date: '2026-05-07', status: 'ABSENT' },
      ],
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      workDaysCap: 26,
    });
    assert.equal(metrics.presentDays, 1);
    assert.equal(metrics.absentDays, 1);
    assert.equal(metrics.recordsInPeriod, 3);
  });
});

describe('buildPayrollAttendanceSnapshot', () => {
  it('uses attendance ABSENT records only — no roster gap inflation', () => {
    const absentDates = ['2026-05-23', '2026-05-24', '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31'];
    const presentDates = ['01', '02', '03', '04', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17'].map(
      (day) => ({
        date: `2026-05-${day}`,
        status: 'PRESENT',
        clockIn: `2026-05-${day}T08:00:00`,
        clockOut: `2026-05-${day}T17:00:00`,
      })
    );
    const attendance = [
      ...absentDates.map((date) => ({ date, status: 'ABSENT' })),
      {
        date: '2026-05-05',
        status: 'UNPAID_LEAVE',
        clockIn: '2026-05-05T07:55:00',
        clockOut: '2026-05-05T17:25:00',
      },
      ...presentDates,
    ];

    const snapshot = buildPayrollAttendanceSnapshot({
      attendance,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      payrollBasisDays: 26,
      eligibleBasisDays: 26,
    });

    assert.equal(snapshot.unpaidLeaveDays, 1);
    assert.equal(snapshot.absentDays, 9);
    assert.equal(snapshot.payrollBasisDays, 26);
    assert.equal(snapshot.attendanceSource, 'attendance_module');
    assert.ok(snapshot.totalWorkHours > 0);
    assert.equal(snapshot.recordsInPeriod, 26);
  });
});
