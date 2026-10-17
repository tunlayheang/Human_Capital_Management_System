/**
 * Payroll review anomaly engine — rule-based pattern detection across the cohort.
 * Compares each employee to period norms and leave records (not a black-box LLM).
 */
import type { PayrollBreakdown } from '../payrollCalculation.js';
import type { HybridPayrollComponents } from './hybridPayrollTypes.js';
import type { PayrollRunItem } from './payrollRunItemsService.js';
import { countApprovedLeaveDaysByUserForMonth } from '../payrollLeaveDeductions.js';

export const PAYROLL_ANOMALY_ENGINE_VERSION = 'payroll-anomaly-v4.0';

import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';

export type PayrollAnomalySeverity = 'info' | 'warning' | 'critical';

export type PayrollAnomaly = {
  code: string;
  severity: PayrollAnomalySeverity;
  message: string;
  /** Optional metrics for UI / audit. */
  details?: Record<string, number | string | boolean | null>;
};

export type PayrollAnomalySummary = {
  engineVersion: string;
  employeesReviewed: number;
  employeesFlagged: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  /** Most frequent anomaly codes in this run. */
  topPatterns: Array<{ code: string; count: number }>;
};

export type PayrollAnomalyDetectionResult = {
  byEmployeeId: Map<string, PayrollAnomaly[]>;
  summary: PayrollAnomalySummary;
  globalInsights: Array<{ code: string; message: string }>;
};

type EmployeeSnapshot = {
  userId: string;
  employeeId: string;
  breakdown: PayrollBreakdown;
  hybrid: HybridPayrollComponents | null;
  /** Paid days for salary (present + paid leave) when attendance finalized; else roster eligible days. */
  paidDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  recordsInPeriod: number;
  totalWorkHours: number;
  stdHoursPerDay: number;
  baseSalary: number;
  contractBase: number;
  gross: number;
  net: number;
  attendanceDeduction: number;
  latePenaltyDeduction: number;
  unpaidLeaveDeduction: number;
  approvedLeaveDays: number;
  hourlyRate: number;
  /** Work hours ÷ present days (when present > 0). */
  avgHoursPerPresentDay: number;
  otHrs150: number;
  otHrs200: number;
  otAmt150: number;
  otAmt200: number;
  otTotal: number;
  employeeStatus: string;
  scheduledWorkingDays: number;
  attendanceFinalized: boolean;
  usePresentDayProration: boolean;
  usedLegacyFallback: boolean;
  prorationFactor: number;
  prorationReason: string | null;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mode(values: number[]): number | null {
  if (!values.length) return null;
  const freq = new Map<number, number>();
  for (const v of values) {
    const key = Math.round(v * 100) / 100;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [k, c] of freq) {
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length < 2) return { mean: values[0] ?? 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function zScore(value: number, mean: number, std: number): number {
  if (std <= 0) return 0;
  return (value - mean) / std;
}

function snapshotFromItem(
  item: PayrollRunItem,
  leave: { totalDays: number; unpaidDays: number }
): EmployeeSnapshot {
  const b = item.breakdown;
  const summary = b.attendanceSummary;
  const hybrid = (b.hybrid ?? null) as HybridPayrollComponents | null;
  const dayClass = hybrid?.dayClassification;
  const attendanceFinalized =
    hybrid?.dayClassification?.finalized === true ||
    hybrid?.attendancePeriodStatus === 'FINALIZED' ||
    hybrid?.attendancePeriodStatus === 'LOCKED';
  const prorationFactor = num(hybrid?.fixed?.prorationFactor, 1);
  const prorationReason = hybrid?.fixed?.prorationReason ?? null;
  const usePresentDayProration =
    attendanceFinalized &&
    prorationFactor > 0 &&
    prorationFactor < 1 &&
    (prorationReason === 'partial_attendance' ||
      prorationReason === 'no_paid_days' ||
      Boolean(dayClass?.finalized));
  const paidDays =
    summary && typeof summary.paidDays === 'number'
      ? num(summary.paidDays)
      : typeof b.proratedDays === 'number' && Number.isFinite(b.proratedDays)
        ? b.proratedDays
        : num(hybrid?.fixed?.prorationFactor ? hybrid?.payrollAudit?.eligibleWorkingDays : 0);
  const paidLeaveDays = num(summary?.paidLeaveDays ?? dayClass?.paidLeaveDays);
  const unpaidLeaveDays = num(summary?.unpaidLeaveDays ?? dayClass?.unpaidLeaveDays);
  const absentDays = num(summary?.absentDays ?? dayClass?.unexcusedAbsentDays);
  const scheduledWorkingDays = num(
    summary?.scheduledWorkDays ??
      b.payrollAudit?.totalScheduledWorkingDays ??
      hybrid?.payrollAudit?.totalScheduledWorkingDays ??
      hybrid?.standardDays,
    LEGACY_WORK_DAYS_PER_MONTH
  );
  return {
    userId: item.userId,
    employeeId: item.employeeId,
    breakdown: b,
    hybrid,
    paidDays,
    presentDays: num(summary?.presentDays ?? dayClass?.presentDays),
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    recordsInPeriod: num(summary?.recordsInPeriod),
    totalWorkHours: num(summary?.totalWorkHours),
    stdHoursPerDay: num(summary?.standardHoursPerDay, 8),
    baseSalary: num(b.baseSalary),
    contractBase: num(b.contractBaseSalary ?? b.baseSalary),
    gross: num(b.grossSalary),
    net: num(b.netSalary),
    attendanceDeduction: num(b.deductions?.absences),
    latePenaltyDeduction: num(hybrid?.variableDeductions?.latePenalty),
    unpaidLeaveDeduction: num(hybrid?.variableDeductions?.unpaidLeave),
    approvedLeaveDays: leave.totalDays,
    hourlyRate: num(summary?.hourlyRate),
    avgHoursPerPresentDay:
      num(summary?.presentDays) > 0
        ? num(summary?.totalWorkHours) / num(summary?.presentDays)
        : 0,
    otHrs150: num(b.overtime?.hours150),
    otHrs200: num(b.overtime?.hours200),
    otAmt150: num(b.overtime?.amount150),
    otAmt200: num(b.overtime?.amount200),
    otTotal: num(b.overtime?.total) || num(b.overtime?.amount150) + num(b.overtime?.amount200),
    employeeStatus: String(item.employeeStatus ?? 'active'),
    scheduledWorkingDays,
    attendanceFinalized,
    usePresentDayProration,
    usedLegacyFallback: Boolean(
      b.payrollAudit?.usedLegacyFallback ?? hybrid?.payrollAudit?.usedLegacyFallback
    ),
    prorationFactor,
    prorationReason,
  };
}

function moneyClose(a: number, b: number, tolerance = 0.05): boolean {
  return Math.abs(a - b) <= tolerance;
}

function expectedHourlyRate(
  baseSalary: number,
  stdHoursPerDay: number,
  scheduledWorkingDays: number
): number {
  if (baseSalary <= 0 || stdHoursPerDay <= 0) return 0;
  const divisor =
    scheduledWorkingDays > 0 ? scheduledWorkingDays : LEGACY_WORK_DAYS_PER_MONTH;
  return Math.round((baseSalary / (divisor * stdHoursPerDay)) * 100) / 100;
}

function hasExplainedProration(s: EmployeeSnapshot): boolean {
  const reason = String(s.prorationReason ?? '');
  if (!reason) return false;
  return (
    reason.includes('mid_month_join') ||
    reason.includes('last_working_date') ||
    reason.includes('mid_month_resign') ||
    reason.includes('terminated_before_period') ||
    reason.includes('not_yet_joined') ||
    reason === 'partial_attendance' ||
    reason === 'no_paid_days' ||
    reason === 'no_scheduled_days'
  );
}

function cohortPeersFor(s: EmployeeSnapshot, snapshots: EmployeeSnapshot[]): EmployeeSnapshot[] {
  return snapshots.filter(
    (p) =>
      p.employeeId !== s.employeeId &&
      Math.round(p.scheduledWorkingDays) === Math.round(s.scheduledWorkingDays)
  );
}

function buildAttendanceCohort(peers: EmployeeSnapshot[], cohortSize: number): AttendanceCohortStats {
  const proratedValues = peers.map((p) => p.paidDays).filter((v) => v > 0);
  const presentValues = peers.map((p) => p.presentDays).filter((v) => v > 0);
  const stdHoursValues = peers.map((p) => p.stdHoursPerDay).filter((v) => v > 0);
  const hourlyValues = peers
    .filter((p) => p.hourlyRate > 0 && p.contractBase > 0)
    .map((p) => p.hourlyRate);
  const avgHrsPresentValues = peers
    .filter((p) => p.presentDays >= 3 && p.avgHoursPerPresentDay > 0)
    .map((p) => p.avgHoursPerPresentDay);
  return {
    modeProrated: mode(proratedValues),
    medianProrated: median(proratedValues),
    modePresent: mode(presentValues),
    medianPresent: median(presentValues),
    modeStdHours: mode(stdHoursValues),
    medianStdHours: median(stdHoursValues),
    medianHourlyRate: median(hourlyValues),
    hourlyRateMeanStd: meanStd(hourlyValues),
    medianAvgHrsPerPresent: median(avgHrsPresentValues),
    cohortSize,
  };
}

type AttendanceCohortStats = {
  modeProrated: number | null;
  medianProrated: number | null;
  modePresent: number | null;
  medianPresent: number | null;
  modeStdHours: number | null;
  medianStdHours: number | null;
  medianHourlyRate: number | null;
  hourlyRateMeanStd: { mean: number; std: number };
  medianAvgHrsPerPresent: number | null;
  cohortSize: number;
};

function detectAttendanceColumnAnomalies(
  s: EmployeeSnapshot,
  att: AttendanceCohortStats
): PayrollAnomaly[] {
  const anomalies: PayrollAnomaly[] = [];
  const push = (
    code: string,
    severity: PayrollAnomalySeverity,
    message: string,
    details?: PayrollAnomaly['details']
  ) => {
    anomalies.push({ code, severity, message, details });
  };

  const modeProrated = att.modeProrated ?? LEGACY_WORK_DAYS_PER_MONTH;
  const medianProrated = att.medianProrated ?? modeProrated;
  const modePresent = att.modePresent ?? att.medianPresent ?? 0;
  const medianPresent = att.medianPresent ?? 0;
  const modeStd = att.modeStdHours ?? 8;
  const medianStd = att.medianStdHours ?? 8;
  const expectedHr = expectedHourlyRate(
    s.contractBase,
    s.stdHoursPerDay,
    s.scheduledWorkingDays
  );
  const hrTolerance = Math.max(0.15, expectedHr * 0.02);

  // —— Paid days vs Planning roster (calendar_v2 present-day proration) ——
  if (s.attendanceFinalized) {
    if (s.paidDays <= 0 && s.presentDays > 0) {
      push(
        'PAID_DAYS_ZERO_WITH_PRESENT',
        'critical',
        `${s.employeeId}: 0 paid days but ${s.presentDays} present day(s) — attendance proration mismatch.`,
        { paidDays: 0, presentDays: s.presentDays }
      );
    }

    const payableFromAttendance = s.presentDays + s.paidLeaveDays;
    if (
      s.paidDays > 0 &&
      payableFromAttendance > 0 &&
      Math.abs(s.paidDays - payableFromAttendance) > 1
    ) {
      push(
        'PAID_DAYS_FORMULA_MISMATCH',
        'warning',
        `${s.employeeId}: paid days ${s.paidDays} ≠ present ${s.presentDays} + paid leave ${s.paidLeaveDays} — verify attendance grid.`,
        {
          paidDays: s.paidDays,
          presentDays: s.presentDays,
          paidLeaveDays: s.paidLeaveDays,
          expectedPaidDays: payableFromAttendance,
        }
      );
    }

    if (s.scheduledWorkingDays > 0 && s.paidDays > s.scheduledWorkingDays + 0.5) {
      push(
        'PAID_DAYS_EXCEED_SCHEDULED',
        'warning',
        `${s.employeeId}: paid days ${s.paidDays} exceed ${s.scheduledWorkingDays} scheduled work days from Planning roster.`,
        { paidDays: s.paidDays, scheduledWorkingDays: s.scheduledWorkingDays }
      );
    }

    const accountedDays = s.paidDays + s.absentDays + s.unpaidLeaveDays;
    if (
      s.scheduledWorkingDays > 0 &&
      accountedDays > 0 &&
      Math.abs(accountedDays - s.scheduledWorkingDays) > 2
    ) {
      push(
        'SCHEDULED_DAYS_ACCOUNTING_GAP',
        'info',
        `${s.employeeId}: paid ${s.paidDays} + absent ${s.absentDays} + unpaid leave ${s.unpaidLeaveDays} = ${accountedDays} vs ${s.scheduledWorkingDays} scheduled — review roster/rest days.`,
        {
          paidDays: s.paidDays,
          absentDays: s.absentDays,
          unpaidLeaveDays: s.unpaidLeaveDays,
          scheduledWorkingDays: s.scheduledWorkingDays,
        }
      );
    }

    if (
      att.cohortSize >= 3 &&
      s.paidDays > modeProrated + 0.5 &&
      s.paidDays > s.scheduledWorkingDays - 0.5 &&
      !hasExplainedProration(s)
    ) {
      push(
        'PAID_DAYS_ABOVE_COHORT',
        'info',
        `${s.employeeId}: paid days ${s.paidDays} exceed peer median ${modeProrated} (${s.scheduledWorkingDays} scheduled) — verify join/leave dates.`,
        { paidDays: s.paidDays, cohortMedianPaidDays: modeProrated }
      );
    }
  }

  // —— Present days ——
  if (
    att.cohortSize >= 3 &&
    medianPresent > 0 &&
    s.presentDays > medianPresent + 5 &&
    s.presentDays > modePresent + 4
  ) {
    push(
      'PRESENT_DAYS_ABOVE_COHORT',
      'info',
      `${s.employeeId}: ${s.presentDays} present days is high vs team median ${Math.round(medianPresent)} — confirm attendance status codes.`,
      { presentDays: s.presentDays, medianPresentDays: medianPresent }
    );
  }

  if (s.presentDays === 0 && s.recordsInPeriod > 0 && s.baseSalary > 0) {
    push(
      'PRESENT_DAYS_ZERO_WITH_RECORDS',
      'warning',
      `${s.employeeId}: ${s.recordsInPeriod} attendance record(s) but 0 present days — review absent/leave statuses.`,
      { recordsInPeriod: s.recordsInPeriod }
    );
  }

  // —— Work hours ——
  if (s.presentDays >= 3 && s.totalWorkHours <= 0) {
    push(
      'WORK_HOURS_ZERO_WITH_PRESENT',
      'critical',
      `${s.employeeId}: 0 work hours recorded despite ${s.presentDays} present day(s).`,
      { presentDays: s.presentDays, totalWorkHours: 0 }
    );
  }

  if (
    s.presentDays >= 5 &&
    s.stdHoursPerDay > 0 &&
    s.totalWorkHours > s.presentDays * s.stdHoursPerDay * 1.2
  ) {
    push(
      'WORK_HOURS_HIGH_FOR_PRESENT',
      'warning',
      `${s.employeeId}: work hours ${s.totalWorkHours.toFixed(1)} exceed expected ~${(s.presentDays * s.stdHoursPerDay).toFixed(0)}h (${s.presentDays} present × ${s.stdHoursPerDay}h).`,
      {
        totalWorkHours: s.totalWorkHours,
        expectedMax: s.presentDays * s.stdHoursPerDay,
        presentDays: s.presentDays,
        stdHoursPerDay: s.stdHoursPerDay,
      }
    );
  }

  if (s.presentDays >= 3 && s.avgHoursPerPresentDay > 0) {
    if (s.avgHoursPerPresentDay < s.stdHoursPerDay * 0.45) {
      push(
        'AVG_HOURS_PER_PRESENT_DAY_LOW',
        'warning',
        `${s.employeeId}: average ${s.avgHoursPerPresentDay.toFixed(1)}h per present day vs ${s.stdHoursPerDay}h standard — incomplete clock-out data?`,
        {
          avgHoursPerPresentDay: Math.round(s.avgHoursPerPresentDay * 10) / 10,
          stdHoursPerDay: s.stdHoursPerDay,
        }
      );
    } else if (s.avgHoursPerPresentDay > s.stdHoursPerDay * 1.15) {
      push(
        'AVG_HOURS_PER_PRESENT_DAY_HIGH',
        'info',
        `${s.employeeId}: average ${s.avgHoursPerPresentDay.toFixed(1)}h per present day exceeds ${s.stdHoursPerDay}h standard.`,
        {
          avgHoursPerPresentDay: Math.round(s.avgHoursPerPresentDay * 10) / 10,
          stdHoursPerDay: s.stdHoursPerDay,
        }
      );
    }

    const medianAvg = att.medianAvgHrsPerPresent;
    if (
      att.cohortSize >= 5 &&
      medianAvg != null &&
      medianAvg > 0 &&
      s.avgHoursPerPresentDay < medianAvg * 0.6
    ) {
      push(
        'AVG_HOURS_PER_PRESENT_BELOW_COHORT',
        'warning',
        `${s.employeeId}: ${s.avgHoursPerPresentDay.toFixed(1)}h avg per present day vs team median ${medianAvg.toFixed(1)}h.`,
        {
          avgHoursPerPresentDay: s.avgHoursPerPresentDay,
          medianAvgHoursPerPresent: medianAvg,
        }
      );
    }
  }

  // —— Std hrs/day ——
  if (att.cohortSize >= 3 && Math.abs(s.stdHoursPerDay - modeStd) >= 0.01) {
    const severity: PayrollAnomalySeverity =
      Math.abs(s.stdHoursPerDay - medianStd) > 2 ? 'warning' : 'info';
    push(
      'STD_HRS_DAY_OFF_COHORT',
      severity,
      `${s.employeeId}: standard ${s.stdHoursPerDay}h/day differs from team norm ${modeStd}h — hourly rate and OT may differ.`,
      { stdHoursPerDay: s.stdHoursPerDay, cohortModeStdHours: modeStd }
    );
  }

  if (s.stdHoursPerDay <= 0 || s.stdHoursPerDay > 16) {
    push(
      'STD_HRS_DAY_UNUSUAL',
      'warning',
      `${s.employeeId}: standard hours/day is ${s.stdHoursPerDay} — expected between 1 and 16.`,
      { stdHoursPerDay: s.stdHoursPerDay }
    );
  }

  // —— Hourly rate (contract base ÷ scheduled days × std hrs — not prorated base) ——
  if (s.contractBase > 0 && s.stdHoursPerDay > 0 && s.hourlyRate > 0) {
    if (Math.abs(s.hourlyRate - expectedHr) > hrTolerance) {
      push(
        'HOURLY_RATE_FORMULA_MISMATCH',
        'warning',
        `${s.employeeId}: hourly rate $${s.hourlyRate.toFixed(2)} ≠ contract base ÷ (${s.scheduledWorkingDays} scheduled days × ${s.stdHoursPerDay}h) ≈ $${expectedHr.toFixed(2)}.`,
        {
          hourlyRate: s.hourlyRate,
          expectedHourlyRate: expectedHr,
          contractBase: s.contractBase,
          stdHoursPerDay: s.stdHoursPerDay,
        }
      );
    }
  }

  if (s.usedLegacyFallback && s.scheduledWorkingDays === LEGACY_WORK_DAYS_PER_MONTH) {
    push(
      'ROSTER_DAYS_FALLBACK',
      'info',
      `${s.employeeId}: using legacy ${LEGACY_WORK_DAYS_PER_MONTH}-day divisor — no active Planning roster for this period.`,
      { scheduledWorkingDays: s.scheduledWorkingDays }
    );
  }

  if (s.hourlyRate > 0 && s.contractBase <= 0) {
    push(
      'HOURLY_RATE_WITHOUT_BASE',
      'warning',
      `${s.employeeId}: hourly rate $${s.hourlyRate.toFixed(2)} shown but base salary is $0.`,
      { hourlyRate: s.hourlyRate }
    );
  }

  if (
    att.cohortSize >= 5 &&
    s.hourlyRate > 0 &&
    att.hourlyRateMeanStd.std > 0 &&
    s.contractBase > 0
  ) {
    const zHr = zScore(s.hourlyRate, att.hourlyRateMeanStd.mean, att.hourlyRateMeanStd.std);
    if (Math.abs(zHr) >= 2.5) {
      push(
        'HOURLY_RATE_COHORT_OUTLIER',
        'info',
        `${s.employeeId}: hourly rate $${s.hourlyRate.toFixed(2)} is unusual vs peers (z=${zHr.toFixed(1)}).`,
        { hourlyRate: s.hourlyRate, zScore: Math.round(zHr * 10) / 10 }
      );
    }
  }

  if (
    att.cohortSize >= 3 &&
    att.medianHourlyRate != null &&
    att.medianHourlyRate > 0 &&
    s.hourlyRate > 0 &&
    s.stdHoursPerDay === medianStd &&
    s.hourlyRate < att.medianHourlyRate * 0.5
  ) {
    push(
      'HOURLY_RATE_LOW_VS_PEERS',
      'info',
      `${s.employeeId}: hourly rate $${s.hourlyRate.toFixed(2)} is less than half the team median $${att.medianHourlyRate.toFixed(2)} (same std hours).`,
      { hourlyRate: s.hourlyRate, medianHourlyRate: att.medianHourlyRate }
    );
  }

  return anomalies;
}

type OvertimeCohortStats = {
  cohortSize: number;
  medianOtHrs150: number | null;
  medianOtHrs200: number | null;
  medianOtPay: number | null;
  otHrs150MeanStd: { mean: number; std: number };
  otHrs200MeanStd: { mean: number; std: number };
  otPayMeanStd: { mean: number; std: number };
  employeesWithOt: number;
};

function detectOvertimeColumnAnomalies(
  s: EmployeeSnapshot,
  att: AttendanceCohortStats,
  ot: OvertimeCohortStats,
  multipliers: { normal: number; premium: number }
): PayrollAnomaly[] {
  const anomalies: PayrollAnomaly[] = [];
  const push = (
    code: string,
    severity: PayrollAnomalySeverity,
    message: string,
    details?: PayrollAnomaly['details']
  ) => {
    anomalies.push({ code, severity, message, details });
  };

  const { normal: otMult150, premium: otMult200 } = multipliers;
  const otHrsTotal = s.otHrs150 + s.otHrs200;
  const otAmtSum = Math.round((s.otAmt150 + s.otAmt200) * 100) / 100;
  const canComputeOtPay = s.hourlyRate > 0 && s.contractBase > 0;
  const expected150 = canComputeOtPay
    ? Math.round(s.otHrs150 * s.hourlyRate * otMult150 * 100) / 100
    : 0;
  const expected200 = canComputeOtPay
    ? Math.round(s.otHrs200 * s.hourlyRate * otMult200 * 100) / 100
    : 0;
  const payTol = (n: number) => Math.max(0.08, n * 0.025);

  // —— Internal consistency (hrs ↔ $ ↔ total) ——
  if (s.otHrs150 > 0 && s.otAmt150 <= 0 && canComputeOtPay) {
    push(
      'OT_HRS_150_WITHOUT_PAY',
      'critical',
      `${s.employeeId}: ${s.otHrs150.toFixed(1)}h at 1.5× but $0 OT pay — check hourly rate and approvals.`,
      { otHrs150: s.otHrs150, otAmt150: 0, hourlyRate: s.hourlyRate }
    );
  }

  if (s.otHrs200 > 0 && s.otAmt200 <= 0 && canComputeOtPay) {
    push(
      'OT_HRS_200_WITHOUT_PAY',
      'critical',
      `${s.employeeId}: ${s.otHrs200.toFixed(1)}h at 2× but $0 OT pay — check hourly rate and approvals.`,
      { otHrs200: s.otHrs200, otAmt200: 0, hourlyRate: s.hourlyRate }
    );
  }

  if (s.otAmt150 > 0 && s.otHrs150 <= 0) {
    push(
      'OT_PAY_150_WITHOUT_HOURS',
      'critical',
      `${s.employeeId}: $${s.otAmt150.toFixed(2)} OT at 1.5× but 0 OT hours recorded.`,
      { otAmt150: s.otAmt150 }
    );
  }

  if (s.otAmt200 > 0 && s.otHrs200 <= 0) {
    push(
      'OT_PAY_200_WITHOUT_HOURS',
      'critical',
      `${s.employeeId}: $${s.otAmt200.toFixed(2)} OT at 2× but 0 OT hours recorded.`,
      { otAmt200: s.otAmt200 }
    );
  }

  if (canComputeOtPay && s.otHrs150 > 0 && !moneyClose(s.otAmt150, expected150, payTol(expected150))) {
    push(
      'OT_AMOUNT_150_FORMULA_MISMATCH',
      'warning',
      `${s.employeeId}: OT $1.5× $${s.otAmt150.toFixed(2)} ≠ ${s.otHrs150.toFixed(1)}h × $${s.hourlyRate.toFixed(2)} × ${otMult150} (≈ $${expected150.toFixed(2)}).`,
      {
        otAmt150: s.otAmt150,
        expectedAmt150: expected150,
        otHrs150: s.otHrs150,
        hourlyRate: s.hourlyRate,
        multiplier: otMult150,
      }
    );
  }

  if (canComputeOtPay && s.otHrs200 > 0 && !moneyClose(s.otAmt200, expected200, payTol(expected200))) {
    push(
      'OT_AMOUNT_200_FORMULA_MISMATCH',
      'warning',
      `${s.employeeId}: OT $2× $${s.otAmt200.toFixed(2)} ≠ ${s.otHrs200.toFixed(1)}h × $${s.hourlyRate.toFixed(2)} × ${otMult200} (≈ $${expected200.toFixed(2)}).`,
      {
        otAmt200: s.otAmt200,
        expectedAmt200: expected200,
        otHrs200: s.otHrs200,
        hourlyRate: s.hourlyRate,
        multiplier: otMult200,
      }
    );
  }

  if (otAmtSum > 0 && !moneyClose(s.otTotal, otAmtSum, 0.03)) {
    push(
      'OT_TOTAL_MISMATCH',
      'warning',
      `${s.employeeId}: OT total $${s.otTotal.toFixed(2)} ≠ $1.5× $${s.otAmt150.toFixed(2)} + $2× $${s.otAmt200.toFixed(2)}.`,
      { otTotal: s.otTotal, sumParts: otAmtSum }
    );
  }

  // —— OT without valid base / attendance context ——
  if ((otHrsTotal > 0 || s.otTotal > 0) && !canComputeOtPay) {
    push(
      'OT_WITHOUT_VALID_HOURLY_BASE',
      'critical',
      `${s.employeeId}: overtime hours/pay present but base salary or hourly rate is $0.`,
      {
        otHrs150: s.otHrs150,
        otHrs200: s.otHrs200,
        otTotal: s.otTotal,
        contractBase: s.contractBase,
        hourlyRate: s.hourlyRate,
      }
    );
  }

  if (s.otTotal > 0 && s.presentDays <= 0) {
    push(
      'OT_PAY_WITHOUT_PRESENT_DAYS',
      'warning',
      `${s.employeeId}: $${s.otTotal.toFixed(2)} overtime pay but 0 present days in period.`,
      { otTotal: s.otTotal, presentDays: 0 }
    );
  }

  if (s.otTotal > 0 && s.totalWorkHours <= 0) {
    push(
      'OT_PAY_WITHOUT_WORK_HOURS',
      'warning',
      `${s.employeeId}: $${s.otTotal.toFixed(2)} overtime pay but 0 total work hours recorded.`,
      { otTotal: s.otTotal }
    );
  }

  // —— Volume thresholds ——
  if (s.otHrs150 > 40) {
    push(
      'OT_HRS_150_EXCESSIVE',
      'warning',
      `${s.employeeId}: ${s.otHrs150.toFixed(1)}h at 1.5× exceeds 40h/month — verify approvals.`,
      { otHrs150: s.otHrs150 }
    );
  }

  if (s.otHrs200 > 24) {
    push(
      'OT_HRS_200_EXCESSIVE',
      'warning',
      `${s.employeeId}: ${s.otHrs200.toFixed(1)}h at 2× exceeds 24h/month — verify approvals.`,
      { otHrs200: s.otHrs200 }
    );
  }

  if (otHrsTotal > 48) {
    push(
      'OT_HOURS_TOTAL_EXCESSIVE',
      'warning',
      `${s.employeeId}: ${otHrsTotal.toFixed(1)} total OT hours (1.5× + 2×) exceeds 48h/month.`,
      { otHrs150: s.otHrs150, otHrs200: s.otHrs200, otHrsTotal }
    );
  }

  if (s.baseSalary > 0 && s.otTotal > s.baseSalary * 0.5) {
    push(
      'OT_PAY_HIGH_VS_BASE',
      'warning',
      `${s.employeeId}: OT pay $${s.otTotal.toFixed(2)} exceeds 50% of base salary $${s.baseSalary.toFixed(2)}.`,
      {
        otTotal: s.otTotal,
        baseSalary: s.baseSalary,
        pctOfBase: Math.round((s.otTotal / s.baseSalary) * 1000) / 10,
      }
    );
  }

  if (s.gross > 0 && s.otTotal > s.gross * 0.45) {
    push(
      'OT_PAY_HIGH_VS_GROSS',
      'info',
      `${s.employeeId}: OT pay $${s.otTotal.toFixed(2)} is ${Math.round((s.otTotal / s.gross) * 100)}% of gross — unusually OT-heavy.`,
      { otTotal: s.otTotal, grossSalary: s.gross }
    );
  }

  // —— Cohort comparisons (peers with OT) ——
  if (ot.employeesWithOt >= 3 && s.otHrs150 > 0 && ot.medianOtHrs150 != null && ot.medianOtHrs150 > 0) {
    if (s.otHrs150 > ot.medianOtHrs150 * 2.5 && s.otHrs150 > ot.medianOtHrs150 + 8) {
      push(
        'OT_HRS_150_ABOVE_COHORT',
        'warning',
        `${s.employeeId}: ${s.otHrs150.toFixed(1)}h at 1.5× is far above team median ${ot.medianOtHrs150.toFixed(1)}h.`,
        { otHrs150: s.otHrs150, medianOtHrs150: ot.medianOtHrs150 }
      );
    }
  }

  if (ot.employeesWithOt >= 3 && s.otHrs200 > 0 && ot.medianOtHrs200 != null && ot.medianOtHrs200 > 0) {
    if (s.otHrs200 > ot.medianOtHrs200 * 2.5 && s.otHrs200 > ot.medianOtHrs200 + 6) {
      push(
        'OT_HRS_200_ABOVE_COHORT',
        'warning',
        `${s.employeeId}: ${s.otHrs200.toFixed(1)}h at 2× is far above team median ${ot.medianOtHrs200.toFixed(1)}h.`,
        { otHrs200: s.otHrs200, medianOtHrs200: ot.medianOtHrs200 }
      );
    }
  }

  if (ot.cohortSize >= 5 && s.otTotal > 0 && ot.otPayMeanStd.std > 0) {
    const z = zScore(s.otTotal, ot.otPayMeanStd.mean, ot.otPayMeanStd.std);
    if (z >= 2.5) {
      push(
        'OT_PAY_COHORT_OUTLIER',
        'info',
        `${s.employeeId}: total OT pay $${s.otTotal.toFixed(2)} is high vs peers (z=${z.toFixed(1)}).`,
        { otTotal: s.otTotal, zScore: Math.round(z * 10) / 10 }
      );
    }
  }

  if (ot.cohortSize >= 5 && s.otHrs150 > 0 && ot.otHrs150MeanStd.std > 0) {
    const z = zScore(s.otHrs150, ot.otHrs150MeanStd.mean, ot.otHrs150MeanStd.std);
    if (z >= 2.5) {
      push(
        'OT_HRS_150_COHORT_OUTLIER',
        'info',
        `${s.employeeId}: ${s.otHrs150.toFixed(1)}h at 1.5× is unusual vs peers (z=${z.toFixed(1)}).`,
        { otHrs150: s.otHrs150, zScore: Math.round(z * 10) / 10 }
      );
    }
  }

  if (ot.cohortSize >= 5 && s.otHrs200 > 0 && ot.otHrs200MeanStd.std > 0) {
    const z = zScore(s.otHrs200, ot.otHrs200MeanStd.mean, ot.otHrs200MeanStd.std);
    if (z >= 2.5) {
      push(
        'OT_HRS_200_COHORT_OUTLIER',
        'info',
        `${s.employeeId}: ${s.otHrs200.toFixed(1)}h at 2× is unusual vs peers (z=${z.toFixed(1)}).`,
        { otHrs200: s.otHrs200, zScore: Math.round(z * 10) / 10 }
      );
    }
  }

  // —— Unusual tier mix ——
  if (s.otHrs200 > 0 && s.otHrs150 <= 0 && s.otAmt200 > 0) {
    push(
      'OT_ONLY_200_TIER',
      'info',
      `${s.employeeId}: 2× OT (${s.otHrs200.toFixed(1)}h / $${s.otAmt200.toFixed(2)}) with no 1.5× OT — confirm tier classification.`,
      { otHrs200: s.otHrs200, otAmt200: s.otAmt200 }
    );
  }

  if (s.otHrs150 > 0 && s.otHrs200 > 0 && s.otAmt200 > s.otAmt150 * 1.5 && s.otHrs150 >= s.otHrs200) {
    push(
      'OT_200_PAY_DOMINATES_150',
      'info',
      `${s.employeeId}: 2× OT pay exceeds 1.5× OT pay while 1.5× hours are not lower — review rates/tiers.`,
      {
        otAmt150: s.otAmt150,
        otAmt200: s.otAmt200,
        otHrs150: s.otHrs150,
        otHrs200: s.otHrs200,
      }
    );
  }

  // —— OT when regular attendance is very low ——
  if (
    att.medianPresent != null &&
    att.medianPresent > 0 &&
    s.presentDays > 0 &&
    s.presentDays < att.medianPresent * 0.5 &&
    otHrsTotal >= 12
  ) {
    push(
      'OT_HIGH_WITH_LOW_ATTENDANCE',
      'warning',
      `${s.employeeId}: ${otHrsTotal.toFixed(1)} OT hours but only ${s.presentDays} present days (median ${Math.round(att.medianPresent)}).`,
      { otHrsTotal, presentDays: s.presentDays, medianPresent: att.medianPresent }
    );
  }

  return anomalies;
}

function detectForEmployee(
  s: EmployeeSnapshot,
  cohort: AttendanceCohortStats & {
    medianBase: number | null;
    netMeanStd: { mean: number; std: number };
    grossMeanStd: { mean: number; std: number };
  },
  otCohort: OvertimeCohortStats,
  otMultipliers: { normal: number; premium: number }
): PayrollAnomaly[] {
  const anomalies = [
    ...detectAttendanceColumnAnomalies(s, cohort),
    ...detectOvertimeColumnAnomalies(s, cohort, otCohort, otMultipliers),
  ];
  const push = (
    code: string,
    severity: PayrollAnomalySeverity,
    message: string,
    details?: PayrollAnomaly['details']
  ) => {
    anomalies.push({ code, severity, message, details });
  };

  const medianPresent = cohort.medianPresent ?? 0;
  const prorationReason = s.prorationReason;
  const prorationFactor = s.prorationFactor;

  if (s.attendanceFinalized) {
    if (
      s.scheduledWorkingDays > 0 &&
      s.paidDays < s.scheduledWorkingDays - 2 &&
      s.absentDays + s.unpaidLeaveDays < s.scheduledWorkingDays - s.paidDays - 1 &&
      s.approvedLeaveDays < s.scheduledWorkingDays - s.paidDays - 1
    ) {
      push(
        'PAID_DAYS_BELOW_SCHEDULED',
        'warning',
        `${s.employeeId}: paid days ${s.paidDays} vs ${s.scheduledWorkingDays} scheduled work days — gap not fully explained by absent/unpaid leave or approved leave.`,
        {
          paidDays: s.paidDays,
          scheduledWorkingDays: s.scheduledWorkingDays,
          absentDays: s.absentDays,
          unpaidLeaveDays: s.unpaidLeaveDays,
          approvedLeaveDays: s.approvedLeaveDays,
        }
      );
    }

    if (
      cohort.cohortSize >= 3 &&
      medianPresent > 0 &&
      s.presentDays > 0 &&
      s.presentDays < medianPresent - 3 &&
      s.paidLeaveDays + s.approvedLeaveDays < medianPresent - s.presentDays - 1
    ) {
      push(
        'PRESENT_DAYS_LOW_NO_LEAVE',
        'warning',
        `${s.employeeId}: only ${s.presentDays} present days vs peers median ${Math.round(medianPresent)} (${s.scheduledWorkingDays} scheduled) — paid/approved leave does not explain the gap.`,
        {
          presentDays: s.presentDays,
          medianPresentDays: medianPresent,
          paidLeaveDays: s.paidLeaveDays,
          approvedLeaveDays: s.approvedLeaveDays,
        }
      );
    }

    if (s.unpaidLeaveDays > 0 && s.usePresentDayProration && s.paidDays >= s.scheduledWorkingDays - 0.5) {
      push(
        'UNPAID_LEAVE_NOT_IN_PRORATION',
        'warning',
        `${s.employeeId}: ${s.unpaidLeaveDays} unpaid leave day(s) recorded but paid days still near full schedule — proration may be wrong.`,
        {
          unpaidLeaveDays: s.unpaidLeaveDays,
          paidDays: s.paidDays,
          scheduledWorkingDays: s.scheduledWorkingDays,
        }
      );
    }
  }

  if (s.recordsInPeriod === 0) {
    push(
      'NO_ATTENDANCE_RECORDS',
      'critical',
      `${s.employeeId}: no attendance records in this payroll period.`,
      { recordsInPeriod: 0 }
    );
  }

  if (
    s.presentDays >= 5 &&
    s.stdHoursPerDay > 0 &&
    s.totalWorkHours < s.presentDays * s.stdHoursPerDay * 0.55
  ) {
    push(
      'WORK_HOURS_LOW_FOR_PRESENT',
      'warning',
      `${s.employeeId}: work hours (${s.totalWorkHours.toFixed(1)}) are low for ${s.presentDays} present days (expected ~${(s.presentDays * s.stdHoursPerDay).toFixed(0)}h).`,
      {
        totalWorkHours: s.totalWorkHours,
        presentDays: s.presentDays,
        expectedHours: s.presentDays * s.stdHoursPerDay,
      }
    );
  }

  // —— Leave / late deductions (absent days reduce base via proration, not $ deduction) ——
  if (!s.usePresentDayProration && s.unpaidLeaveDeduction > 0 && s.unpaidLeaveDays === 0) {
    push(
      'UNPAID_LEAVE_DED_MISMATCH',
      'warning',
      `${s.employeeId}: unpaid leave deduction applied ($${s.unpaidLeaveDeduction.toFixed(2)}) but no unpaid leave days in attendance.`,
      { unpaidLeaveDeduction: s.unpaidLeaveDeduction }
    );
  }

  if (
    s.latePenaltyDeduction > 0 &&
    s.contractBase > 0 &&
    s.latePenaltyDeduction > s.contractBase * 0.05
  ) {
    push(
      'LATE_PENALTY_HIGH',
      'warning',
      `${s.employeeId}: late penalties ($${s.latePenaltyDeduction.toFixed(2)}) exceed 5% of contract base.`,
      {
        latePenalty: s.latePenaltyDeduction,
        contractBase: s.contractBase,
        pctOfBase: Math.round((s.latePenaltyDeduction / s.contractBase) * 1000) / 10,
      }
    );
  }

  if (s.attendanceFinalized && s.absentDays > 0 && s.attendanceDeduction > s.latePenaltyDeduction + 0.02) {
    push(
      'UNEXPECTED_ATTENDANCE_DEDUCTION',
      'warning',
      `${s.employeeId}: attendance deductions ($${s.attendanceDeduction.toFixed(2)}) include more than late penalties — absent days should reduce pay via proration only.`,
      {
        attendanceDeduction: s.attendanceDeduction,
        latePenalty: s.latePenaltyDeduction,
        absentDays: s.absentDays,
      }
    );
  }

  // —— Compensation ——
  if (s.baseSalary <= 0 && s.contractBase > 0) {
    push(
      'ZERO_PRORATED_BASE',
      'critical',
      `${s.employeeId}: $0 prorated base but contract base $${s.contractBase} — check join/leave dates.`,
      { contractBase: s.contractBase, prorationReason: prorationReason ?? '' }
    );
  } else if (s.baseSalary <= 0 && s.contractBase <= 0) {
    push(
      'MISSING_BASE_SALARY',
      'critical',
      `${s.employeeId}: no base salary on file.`,
      {}
    );
  }

  if (prorationReason === 'not_yet_joined' && s.presentDays > 0) {
    push(
      'JOIN_DATE_ATTENDANCE_CONFLICT',
      'critical',
      `${s.employeeId}: payroll treats employee as not yet joined, but ${s.presentDays} present day(s) exist in this period.`,
      { presentDays: s.presentDays, prorationReason }
    );
  }

  if (
    s.attendanceFinalized &&
    prorationFactor < 1 &&
    prorationFactor > 0 &&
    !prorationReason
  ) {
    push(
      'PRORATION_WITHOUT_REASON',
      'info',
      `${s.employeeId}: salary prorated (${Math.round(prorationFactor * 100)}%) without a documented proration reason.`,
      { prorationFactor }
    );
  }

  // —— Allowances & OT ——
  const attendanceBonus = num(s.breakdown.allowances?.attendance);
  const presentThreshold = Math.min(10, Math.max(5, Math.round(s.scheduledWorkingDays * 0.4)));
  if (attendanceBonus > 0 && s.presentDays < presentThreshold) {
    push(
      'ATTENDANCE_BONUS_LOW_PRESENT',
      'warning',
      `${s.employeeId}: attendance bonus $${attendanceBonus} with only ${s.presentDays} present days (usually needs ≥${presentThreshold} for ${s.scheduledWorkingDays} scheduled days).`,
      { attendanceBonus, presentDays: s.presentDays, presentThreshold }
    );
  }

  // —— Statistical outliers (same cohort) ——
  if (cohort.cohortSize >= 5 && cohort.netMeanStd.std > 0) {
    const zNet = zScore(s.net, cohort.netMeanStd.mean, cohort.netMeanStd.std);
    if (Math.abs(zNet) >= 2.5) {
      push(
        'NET_PAY_OUTLIER',
        'info',
        `${s.employeeId}: net pay $${s.net.toFixed(2)} is unusual vs this payroll cohort (z=${zNet.toFixed(1)}).`,
        { netPay: s.net, zScore: Math.round(zNet * 10) / 10 }
      );
    }
  }

  if (cohort.cohortSize >= 5 && cohort.grossMeanStd.std > 0) {
    const zGross = zScore(s.gross, cohort.grossMeanStd.mean, cohort.grossMeanStd.std);
    if (Math.abs(zGross) >= 2.5) {
      push(
        'GROSS_PAY_OUTLIER',
        'info',
        `${s.employeeId}: gross pay $${s.gross.toFixed(2)} is unusual vs this payroll cohort (z=${zGross.toFixed(1)}).`,
        { grossPay: s.gross, zScore: Math.round(zGross * 10) / 10 }
      );
    }
  }

  if (
    cohort.medianBase != null &&
    cohort.medianBase > 0 &&
    s.baseSalary > 0 &&
    s.baseSalary < cohort.medianBase * 0.55
  ) {
    push(
      'BASE_SALARY_BELOW_COHORT',
      'info',
      `${s.employeeId}: base $${s.baseSalary} is well below team median base $${Math.round(cohort.medianBase)}.`,
      { baseSalary: s.baseSalary, medianBase: cohort.medianBase }
    );
  }

  return anomalies;
}

export async function detectPayrollAnomalies(
  items: PayrollRunItem[],
  month: string
): Promise<PayrollAnomalyDetectionResult> {
  const byEmployeeId = new Map<string, PayrollAnomaly[]>();
  if (!items.length) {
    return {
      byEmployeeId,
      summary: {
        engineVersion: PAYROLL_ANOMALY_ENGINE_VERSION,
        employeesReviewed: 0,
        employeesFlagged: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        topPatterns: [],
      },
      globalInsights: [],
    };
  }

  const userIds = items.map((i) => i.userId);
  const { resolvePayrollPeriod } = await import('./payrollPeriodService.js');
  const period = await resolvePayrollPeriod(month);
  const [{ compliance }, leaveByUser] = await Promise.all([
    import('../payrollEngineInputs.js').then((m) => m.loadPayrollEngineInputs()),
    countApprovedLeaveDaysByUserForMonth(userIds, month, {
      periodStart: period.payPeriodStart,
      periodEnd: period.payPeriodEnd,
    }),
  ]);
  const otMultipliers = {
    normal: compliance?.otMultiplierNormal ?? 1.5,
    premium: compliance?.otMultiplierPremium ?? 2,
  };

  const snapshots = items.map((item) => {
    const leave = leaveByUser.get(item.userId) ?? { totalDays: 0, unpaidDays: 0 };
    return snapshotFromItem(item, leave);
  });

  const netValues = snapshots.map((s) => s.net);
  const grossValues = snapshots.map((s) => s.gross);
  const baseValues = snapshots.map((s) => s.baseSalary).filter((v) => v > 0);

  const globalOtHrs150 = snapshots.filter((s) => s.otHrs150 > 0).map((s) => s.otHrs150);
  const globalOtHrs200 = snapshots.filter((s) => s.otHrs200 > 0).map((s) => s.otHrs200);
  const globalOtPay = snapshots.filter((s) => s.otTotal > 0).map((s) => s.otTotal);

  const globalPayCohort = {
    medianBase: median(baseValues),
    netMeanStd: meanStd(netValues),
    grossMeanStd: meanStd(grossValues),
  };

  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  const codeCounts = new Map<string, number>();

  for (const s of snapshots) {
    const peers = cohortPeersFor(s, snapshots);
    const cohort = {
      ...buildAttendanceCohort(peers, peers.length + 1),
      ...globalPayCohort,
    };
    const peerOtHrs150 = peers.filter((p) => p.otHrs150 > 0).map((p) => p.otHrs150);
    const peerOtHrs200 = peers.filter((p) => p.otHrs200 > 0).map((p) => p.otHrs200);
    const peerOtPay = peers.filter((p) => p.otTotal > 0).map((p) => p.otTotal);
    const otCohort: OvertimeCohortStats = {
      cohortSize: peers.length + 1,
      medianOtHrs150: median(peerOtHrs150.length ? peerOtHrs150 : globalOtHrs150),
      medianOtHrs200: median(peerOtHrs200.length ? peerOtHrs200 : globalOtHrs200),
      medianOtPay: median(peerOtPay.length ? peerOtPay : globalOtPay),
      otHrs150MeanStd: meanStd(peerOtHrs150.length >= 3 ? peerOtHrs150 : globalOtHrs150),
      otHrs200MeanStd: meanStd(peerOtHrs200.length >= 3 ? peerOtHrs200 : globalOtHrs200),
      otPayMeanStd: meanStd(peerOtPay.length >= 3 ? peerOtPay : globalOtPay),
      employeesWithOt: (peerOtPay.length ? peerOtPay : globalOtPay).length,
    };
    const anomalies = detectForEmployee(s, cohort, otCohort, otMultipliers);
    if (anomalies.length) byEmployeeId.set(s.employeeId, anomalies);
    for (const a of anomalies) {
      codeCounts.set(a.code, (codeCounts.get(a.code) ?? 0) + 1);
      if (a.severity === 'critical') criticalCount += 1;
      else if (a.severity === 'warning') warningCount += 1;
      else infoCount += 1;
    }
  }

  const topPatterns = [...codeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }));

  const employeesFlagged = byEmployeeId.size;
  const globalInsights: Array<{ code: string; message: string }> = [];

  if (employeesFlagged > 0) {
    globalInsights.push({
      code: 'ANOMALY_REVIEW_REQUIRED',
      message: `AI payroll review flagged ${employeesFlagged} employee(s) — review paid days vs Planning roster, OT hrs/pay (1.5× & 2×), and compensation before run.`,
    });
  }
  if (criticalCount > 0) {
    globalInsights.push({
      code: 'CRITICAL_ANOMALIES',
      message: `${criticalCount} critical pattern(s) require HR action before approval.`,
    });
  }

  return {
    byEmployeeId,
    summary: {
      engineVersion: PAYROLL_ANOMALY_ENGINE_VERSION,
      employeesReviewed: items.length,
      employeesFlagged,
      criticalCount,
      warningCount,
      infoCount,
      topPatterns,
    },
    globalInsights,
  };
}
