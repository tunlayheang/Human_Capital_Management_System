/**
 * Run: npm run test:payroll-anomaly  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectPayrollAnomalies,
  PAYROLL_ANOMALY_ENGINE_VERSION,
} from './payrollAnomalyDetectionService.js';
import type { PayrollRunItem } from './payrollRunItemsService.js';

function item(partial: {
  employeeId: string;
  userId: string;
  breakdown: PayrollRunItem['breakdown'];
}): PayrollRunItem {
  return {
    id: `item-${partial.employeeId}`,
    userId: partial.userId,
    employeeId: partial.employeeId,
    employeeStatus: 'active',
    breakdown: partial.breakdown,
  } as PayrollRunItem;
}

describe('payroll anomaly v4', () => {
  it('uses contract base for hourly rate formula (not prorated base)', async () => {
    const breakdown = {
      contractBaseSalary: 800,
      baseSalary: 400,
      grossSalary: 400,
      netSalary: 350,
      proratedDays: 13,
      deductions: { nssf: 0, taxOnSalary: 0, absences: 0, advances: 0, total: 0 },
      allowances: {},
      overtime: { hours150: 0, hours200: 0, amount150: 0, amount200: 0, total: 0 },
      attendanceSummary: {
        recordsInPeriod: 13,
        presentDays: 13,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        absentDays: 0,
        paidDays: 13,
        scheduledWorkDays: 26,
        totalWorkHours: 104,
        standardHoursPerDay: 8,
        hourlyRate: 3.85,
        dependents: 0,
      },
      payrollAudit: {
        engineVersion: 'calendar_v2',
        payrollPeriodStart: '2026-05-01',
        payrollPeriodEnd: '2026-05-31',
        totalCalendarDays: 31,
        totalScheduledWorkingDays: 26,
        eligibleWorkingDays: 13,
        calculationMethod: 'scheduled_shift_days',
        dailyRateDivisor: 26,
        prorationFactor: 0.5,
        payrollProcessingType: 'MONTHLY',
      },
      hybrid: {
        model: 'hybrid_enterprise_v1',
        attendancePeriodStatus: 'FINALIZED',
        fixed: {
          contractBaseSalary: 800,
          fixedBaseSalary: 400,
          prorationFactor: 0.5,
          prorationReason: 'partial_attendance',
          positionAllowance: 0,
          seniorityAllowance: 0,
          seniorityIndemnity: 0,
          transportAllowance: 0,
          mealAllowance: 0,
          otherFixedAllowances: 0,
          total: 400,
        },
        variableDeductions: {
          unpaidLeave: 0,
          unexcusedAbsence: 0,
          latePenalty: 0,
          advances: 0,
          other: 0,
          total: 0,
        },
        dayClassification: {
          employmentEligiblePeriod: { start: '2026-05-01', end: '2026-05-31' },
          totalScheduledWorkingDays: 26,
          scheduledWorkingDays: 26,
          payableDays: 13,
          deductibleDays: 13,
          neutralDays: 0,
          presentDays: 13,
          paidLeaveDays: 0,
          unpaidLeaveDays: 0,
          unexcusedAbsentDays: 13,
          attendanceBreakdown: {},
          leaveBreakdown: [],
          finalized: true,
        },
      },
    } as PayrollRunItem['breakdown'];

    const result = await detectPayrollAnomalies(
      [item({ employeeId: 'E001', userId: 'u1', breakdown })],
      '2026-05'
    );
    const codes = (result.byEmployeeId.get('E001') ?? []).map((a) => a.code);
    assert.equal(result.summary.engineVersion, PAYROLL_ANOMALY_ENGINE_VERSION);
    assert.ok(!codes.includes('HOURLY_RATE_FORMULA_MISMATCH'));
  });

  it('flags unexpected attendance deduction when absent days should prorate only', async () => {
    const breakdown = {
      contractBaseSalary: 800,
      baseSalary: 500,
      grossSalary: 500,
      netSalary: 400,
      deductions: { nssf: 0, taxOnSalary: 0, absences: 50, advances: 0, total: 50 },
      allowances: {},
      overtime: { hours150: 0, hours200: 0, amount150: 0, amount200: 0, total: 0 },
      attendanceSummary: {
        recordsInPeriod: 20,
        presentDays: 15,
        paidDays: 15,
        absentDays: 5,
        scheduledWorkDays: 26,
        totalWorkHours: 120,
        standardHoursPerDay: 8,
        hourlyRate: 3.85,
        dependents: 0,
      },
      hybrid: {
        attendancePeriodStatus: 'FINALIZED',
        fixed: { prorationFactor: 0.58, prorationReason: 'partial_attendance' },
        variableDeductions: { unpaidLeave: 0, unexcusedAbsence: 0, latePenalty: 0, total: 50 },
        dayClassification: { finalized: true, unexcusedAbsentDays: 5 },
      },
    } as PayrollRunItem['breakdown'];

    const result = await detectPayrollAnomalies(
      [item({ employeeId: 'E002', userId: 'u2', breakdown })],
      '2026-05'
    );
    const codes = (result.byEmployeeId.get('E002') ?? []).map((a) => a.code);
    assert.ok(codes.includes('UNEXPECTED_ATTENDANCE_DEDUCTION'));
    assert.ok(!codes.includes('HIGH_ABSENCE_DEDUCTION'));
  });
});
