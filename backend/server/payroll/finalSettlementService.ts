import { Op } from 'sequelize';
import { AttendanceRecord, Employee, Payslip, PayrollRun } from '../db.js';
import { findEmployeeWithCompensation } from '../salaryStructureService.js';
import { findEmployeeByUserId } from '../employeeAttendanceSchedule.js';
import {
  findDisplayIdByEmployeePk,
  findUserIdByEmployeePk,
  resolveEmployeePk,
} from '../employeeIdentity.js';
import { buildBreakdownForUserId } from '../payrollCalculation.js';
import { breakdownToRow } from '../payslipBreakdownDb.js';
import { PayslipBreakdown } from '../db.js';
import { FinalSettlementRun } from './finalSettlementSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { createPayrollAdjustment } from './payrollAdjustmentService.js';
import { isPayrollRunLocked } from './payrollWorkflowService.js';
import { resolvePayrollCycleForMonth } from './payrollCalendarCycleService.js';
import { getProrationConfig } from './prorationConfigService.js';
import { getAttendancePeriod } from './attendanceFinalizationService.js';
import { computeLastValidWorkingDate } from './lastValidWorkingDateService.js';
import { joinEmployeeNameParts } from '../employeeDisplayName.js';
import { employeeLookupWhere, toCanonicalEmployeeDisplayId } from '../employeeIdFormat.js';

async function settlementIdentity(plain: Record<string, unknown>) {
  const pk =
    String(plain.employee_id ?? '').trim() ||
    (await resolveEmployeePk(String(plain.employeeId ?? ''))) ||
    '';
  const employeeDisplayId = pk
    ? (await findDisplayIdByEmployeePk(pk)) ?? String(plain.employeeId ?? '')
    : String(plain.employeeId ?? '');
  const userId =
    String(plain.userId ?? '').trim() ||
    (pk ? ((await findUserIdByEmployeePk(pk)) ?? '') : '');
  return { employeePk: pk, employeeDisplayId, userId };
}

import { toDateKey } from './dateKey.js';
import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';
import { resolvePayrollContractRates } from './payrollContractRates.js';
import type { PayrollBreakdown } from '../payrollCalculation.js';
import { isPayrollExcusedAbsence } from '../payrollCalculation.js';
import {
  filterRecordsThroughLastWorkingDate,
  normalizeEmployeeStatus,
  resolveLastWorkingDate,
} from './employeePayrollEligibility.js';
import {
  assessFinalSettlementPayrollOverlap,
  persistSettlementPayrollOverlap,
  parsePayrollOverlap,
} from './finalSettlementPayrollOverlapService.js';

export type FinalSettlementEligibility = {
  eligible: boolean;
  employeeId: string;
  employeeName: string;
  employeeStatus: string;
  offboardLabel: string;
  suggestedLastWorkingDate: string | null;
  lastPresentDate: string | null;
  absenceFrom: string | null;
  absenceTo: string | null;
  offboardingAbsenceDays: number;
  periodStart: string | null;
  periodEnd: string | null;
  attendanceRecordsInPeriod: number;
  presentOrLateDays: number;
  reasons: string[];
  warnings: string[];
  existingDraft: Record<string, unknown> | null;
  hasBlockingSettlement: boolean;
};

const OFFBOARD_SETTLEMENT_STATUSES = new Set(['terminated', 'resigned']);

/** Daily rate for post–last-present gap days — matches hybrid payroll contract ÷ work days. */
export function resolveOffboardAbsenceDailyRateUsd(
  breakdown: PayrollBreakdown,
  employeePlain?: Record<string, unknown> | null
): number {
  const hybridFixed = breakdown.hybrid?.fixed as { contractBaseSalary?: number } | undefined;
  const contractBase = Number(
    breakdown.contractBaseSalary ??
      hybridFixed?.contractBaseSalary ??
      employeePlain?.base_salary ??
      (employeePlain?.salary_structure as { base_salary?: number } | undefined)?.base_salary ??
      0
  );
  const scheduledDays = Number(
    breakdown.payrollAudit?.totalScheduledWorkingDays ??
      breakdown.hybrid?.payrollAudit?.totalScheduledWorkingDays ??
      breakdown.hybrid?.standardDays ??
      LEGACY_WORK_DAYS_PER_MONTH
  );
  const stdHours = Number(employeePlain?.work_hours ?? 8);
  return resolvePayrollContractRates({
    contractBaseSalary: contractBase,
    scheduledWorkingDays: scheduledDays,
    standardHoursPerDay: stdHours > 0 ? stdHours : 8,
  }).dailyRateExact;
}

function monthStartFromDate(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function offboardLabelForStatus(status: string): string {
  return status === 'resigned' ? 'Resigned' : status === 'terminated' ? 'Terminated' : status;
}

/** Official LWD from offboarding (not last-valid-present, which is used for absence gap). */
function resolveOfficialLastWorkingDate(employee: Record<string, unknown>): string | null {
  return (
    toDateKey(employee.last_working_date ?? employee.lastWorkingDate) ??
    toDateKey(employee.final_settlement_date ?? employee.finalSettlementDate) ??
    null
  );
}

function addCalendarDay(ymd: string, delta: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function datesInclusive(start: string, end: string): string[] {
  if (end < start) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addCalendarDay(cur, 1);
  }
  return out;
}

/**
 * Days after last present date through official LWD that payroll should treat as absence
 * (gap days without attendance, or not already marked ABSENT).
 */
export async function computeOffboardingAbsenceDays(params: {
  userId: string;
  employee: Record<string, unknown>;
  officialLastWorkingDate: string;
  monthPrefix: string;
}): Promise<{
  lastPresentDate: string | null;
  absenceFrom: string | null;
  absenceTo: string | null;
  additionalAbsentDays: number;
  absenceDates: string[];
}> {
  const lwd = params.officialLastWorkingDate.slice(0, 10);
  let lastPresent =
    toDateKey(params.employee.last_valid_working_date ?? params.employee.lastValidWorkingDate) ??
    null;

  if (!lastPresent) {
    const computed = await computeLastValidWorkingDate({
      userId: params.userId,
      employee: params.employee,
      dateFrom: monthStartFromDate(lwd),
      dateTo: lwd,
    });
    lastPresent = computed.date;
  }

  if (!lastPresent || lastPresent >= lwd) {
    return {
      lastPresentDate: lastPresent,
      absenceFrom: null,
      absenceTo: null,
      additionalAbsentDays: 0,
      absenceDates: [],
    };
  }

  const absenceFrom = addCalendarDay(lastPresent, 1);
  const absenceTo = lwd;
  const gapDates = datesInclusive(absenceFrom, absenceTo).filter((d) =>
    d.startsWith(params.monthPrefix)
  );
  if (!gapDates.length) {
    return {
      lastPresentDate: lastPresent,
      absenceFrom,
      absenceTo,
      additionalAbsentDays: 0,
      absenceDates: [],
    };
  }

  const records = await AttendanceRecord.findAll({
    where: {
      userId: params.userId,
      date: { [Op.between]: [gapDates[0], gapDates[gapDates.length - 1]] },
    },
    attributes: ['date', 'status'],
  });
  const statusByDate = new Map<string, string>();
  for (const rec of records) {
    statusByDate.set(String(rec.get('date')).slice(0, 10), String(rec.get('status') ?? '').toUpperCase());
  }

  const absenceDates: string[] = [];
  for (const d of gapDates) {
    const st = statusByDate.get(d);
    if (st === 'ABSENT') continue;
    if (st === 'PRESENT' || st === 'LATE') continue;
    if (st && isPayrollExcusedAbsence(st)) continue;
    absenceDates.push(d);
  }

  return {
    lastPresentDate: lastPresent,
    absenceFrom,
    absenceTo,
    additionalAbsentDays: absenceDates.length,
    absenceDates,
  };
}

async function countAttendanceInFinalPayPeriod(
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ total: number; presentOrLate: number }> {
  const records = await AttendanceRecord.findAll({
    where: {
      userId,
      date: { [Op.between]: [periodStart, periodEnd] },
    },
    attributes: ['status'],
  });
  let presentOrLate = 0;
  for (const rec of records) {
    const st = String(rec.get('status') ?? '').toUpperCase();
    if (st === 'PRESENT' || st === 'LATE') presentOrLate += 1;
  }
  return { total: records.length, presentOrLate };
}

export async function assessFinalSettlementEligibility(
  employeeDisplayId: string,
  options?: { lastWorkingDateOverride?: string | null }
): Promise<FinalSettlementEligibility> {
  const id = employeeDisplayId.trim();
  const reasons: string[] = [];
  const warnings: string[] = [];
  const emp = await Employee.findOne({ where: employeeLookupWhere(id) as never });
  const employeePk = emp ? String(emp.get('id')) : null;
  if (!emp) {
    return {
      eligible: false,
      employeeId: id,
      employeeName: '',
      employeeStatus: '',
      offboardLabel: '',
      suggestedLastWorkingDate: null,
      lastPresentDate: null,
      absenceFrom: null,
      absenceTo: null,
      offboardingAbsenceDays: 0,
      periodStart: null,
      periodEnd: null,
      attendanceRecordsInPeriod: 0,
      presentOrLateDays: 0,
      reasons: [`Employee "${id}" was not found.`],
      warnings: [],
      existingDraft: null,
      hasBlockingSettlement: false,
    };
  }

  const plain = emp.get({ plain: true }) as Record<string, unknown>;
  const employeeName = joinEmployeeNameParts(
    plain.first_name as string | undefined,
    plain.last_name as string | undefined
  );
  const status = normalizeEmployeeStatus(plain.status);
  const offboardLabel = offboardLabelForStatus(status);

  const existingDraftRow = employeePk
    ? await FinalSettlementRun.findOne({
        where: { employee_id: employeePk, status: 'DRAFT' },
        order: [['createdAt', 'DESC']],
      })
    : null;
  const existingDraft = existingDraftRow
    ? (existingDraftRow.get({ plain: true }) as Record<string, unknown>)
    : null;

  const blocking = employeePk
    ? await FinalSettlementRun.findOne({
        where: {
          employee_id: employeePk,
          status: { [Op.notIn]: ['REJECTED', 'PAID', 'DRAFT'] },
        },
      })
    : null;
  const hasBlockingSettlement = Boolean(blocking);

  if (!OFFBOARD_SETTLEMENT_STATUSES.has(status)) {
    reasons.push(
      'Employee must be terminated or resigned (offboarded in Employees → Offboarding) before final settlement.'
    );
  }

  const overrideLwd = toDateKey(options?.lastWorkingDateOverride);
  let suggestedLastWorkingDate = resolveOfficialLastWorkingDate(plain);
  if (overrideLwd) {
    suggestedLastWorkingDate = overrideLwd;
  }
  if (!suggestedLastWorkingDate) {
    reasons.push('Last working date is missing — set it when offboarding the employee.');
  }

  const portal = await resolvePortalUserForEmployee(id);
  if (!portal) {
    reasons.push('No portal login is linked to this employee — payroll cannot be calculated.');
  }

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let attendanceRecordsInPeriod = 0;
  let presentOrLateDays = 0;
  let lastPresentDate: string | null = null;
  let absenceFrom: string | null = null;
  let absenceTo: string | null = null;
  let offboardingAbsenceDays = 0;

  if (suggestedLastWorkingDate && portal) {
    periodStart = monthStartFromDate(suggestedLastWorkingDate);
    periodEnd = suggestedLastWorkingDate;
    const counts = await countAttendanceInFinalPayPeriod(
      portal.userId,
      periodStart,
      periodEnd
    );
    attendanceRecordsInPeriod = counts.total;
    presentOrLateDays = counts.presentOrLate;

    const absence = await computeOffboardingAbsenceDays({
      userId: portal.userId,
      employee: plain,
      officialLastWorkingDate: suggestedLastWorkingDate,
      monthPrefix: suggestedLastWorkingDate.slice(0, 7),
    });
    lastPresentDate = absence.lastPresentDate;
    absenceFrom = absence.absenceFrom;
    absenceTo = absence.absenceTo;
    offboardingAbsenceDays = absence.additionalAbsentDays;

    if (counts.total === 0 && offboardingAbsenceDays === 0) {
      warnings.push(
        'No attendance in the final month — payroll will prorate salary through the last working date only.'
      );
    }
    if (offboardingAbsenceDays > 0) {
      warnings.push(
        `${offboardingAbsenceDays} day(s) between last present (${lastPresentDate}) and last working date will be deducted as absence.`
      );
    }
  }

  if (hasBlockingSettlement && !existingDraft) {
    reasons.push(
      'A final settlement is already in progress for this employee. Complete, reject, or edit the existing run first.'
    );
  }

  const eligible =
    OFFBOARD_SETTLEMENT_STATUSES.has(status) &&
    Boolean(suggestedLastWorkingDate) &&
    Boolean(portal) &&
    (!hasBlockingSettlement || Boolean(existingDraft));

  return {
    eligible,
    employeeId: id,
    employeeName,
    employeeStatus: status,
    offboardLabel,
    suggestedLastWorkingDate,
    lastPresentDate,
    absenceFrom,
    absenceTo,
    offboardingAbsenceDays,
    periodStart,
    periodEnd,
    attendanceRecordsInPeriod,
    presentOrLateDays,
    reasons,
    warnings,
    existingDraft,
    hasBlockingSettlement,
  };
}

export async function assertFinalSettlementEligible(
  employeeDisplayId: string,
  options?: { allowDraftId?: string; lastWorkingDateOverride?: string | null }
): Promise<FinalSettlementEligibility> {
  const assessment = await assessFinalSettlementEligibility(employeeDisplayId, {
    lastWorkingDateOverride: options?.lastWorkingDateOverride,
  });
  if (assessment.eligible) return assessment;
  if (
    options?.allowDraftId &&
    assessment.existingDraft &&
    String(assessment.existingDraft.id) === options.allowDraftId
  ) {
    return assessment;
  }
  const err = new Error(assessment.reasons.join(' ')) as Error & { statusCode?: number };
  err.statusCode = 400;
  throw err;
}

export async function listFinalSettlementEligibleEmployees(): Promise<
  FinalSettlementEligibility[]
> {
  const rows = await Employee.findAll({
    where: { status: { [Op.in]: ['terminated', 'resigned'] } },
    attributes: ['employee_id'],
    order: [['updated_at', 'DESC']],
    limit: 500,
  });
  const out: FinalSettlementEligibility[] = [];
  for (const row of rows) {
    const displayId = String(row.get('employee_id'));
    const assessment = await assessFinalSettlementEligibility(displayId);
    if (assessment.eligible) out.push(assessment);
  }
  return out;
}

/** JSON stored in `clearanceJson` — offboard wizard metadata and optional settlement notes. */
export type ClearanceChecklist = {
  notes?: string;
  deductionUsd?: number;
  _offboardMeta?: Record<string, unknown>;
};

export type SettlementLineItem = {
  code: string;
  label: string;
  amountUsd: number;
  category: 'earning' | 'deduction';
};

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export async function resolvePortalUserForEmployee(displayId: string) {
  const emp = await Employee.findOne({ where: employeeLookupWhere(displayId) as never });
  if (!emp) return null;
  const plain = emp.get({ plain: true }) as { email?: string; id: string };
  const { User } = await import('../db.js');
  if (plain.email) {
    const u = await User.findOne({ where: { email: plain.email } });
    if (u) {
      return {
        userId: String(u.get('id')),
        employeePk: String(plain.id),
      };
    }
  }
  const linked = await findEmployeeByUserId(displayId);
  if (linked) {
    return { userId: displayId, employeePk: String(plain.id) };
  }
  return null;
}

/** Build settlement breakdown — uses last working date; does not reopen locked monthly payroll. */
export async function calculateFinalSettlementPreview(params: {
  employeeDisplayId: string;
  lastWorkingDate: string;
  settlementLines?: SettlementLineItem[];
  leaveEncashmentUsd?: number;
  loanSettlementUsd?: number;
  assetPenaltyUsd?: number;
  skipEligibilityCheck?: boolean;
}) {
  const lwdFromRequest = params.lastWorkingDate?.slice(0, 10) || '';
  if (!params.skipEligibilityCheck) {
    await assertFinalSettlementEligible(params.employeeDisplayId, {
      lastWorkingDateOverride: lwdFromRequest || undefined,
    });
  }

  const portal = await resolvePortalUserForEmployee(params.employeeDisplayId);
  if (!portal) {
    const err = new Error('No portal user linked to this employee') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const userId = portal.userId;
  const empFull = await findEmployeeWithCompensation(userId);
  const lwd = params.lastWorkingDate.slice(0, 10);
  const month = lwd.slice(0, 7);

  const breakdown = await buildBreakdownForUserId(userId, month, {
    skipFinalizationCheck: true,
    lastWorkingDate: lwd,
    payrollRunType: 'FINAL_SETTLEMENT',
  });

  const extraLines: SettlementLineItem[] = [...(params.settlementLines ?? [])];
  if (params.leaveEncashmentUsd && params.leaveEncashmentUsd > 0) {
    extraLines.push({
      code: 'LEAVE_ENCASH',
      label: 'Leave encashment',
      amountUsd: params.leaveEncashmentUsd,
      category: 'earning',
    });
  }
  const clearanceDed =
    (params.loanSettlementUsd ?? 0) + (params.assetPenaltyUsd ?? 0);
  if (clearanceDed > 0) {
    extraLines.push({
      code: 'CLEARANCE_DED',
      label: 'Loan / asset clearance deductions',
      amountUsd: clearanceDed,
      category: 'deduction',
    });
  }

  let offboardingAbsence: Awaited<ReturnType<typeof computeOffboardingAbsenceDays>> | null = null;
  if (empFull) {
    const employeePlain = empFull as Record<string, unknown>;
    offboardingAbsence = await computeOffboardingAbsenceDays({
      userId,
      employee: employeePlain,
      officialLastWorkingDate: lwd,
      monthPrefix: month,
    });
    if (offboardingAbsence.additionalAbsentDays > 0) {
      const dailyRate = resolveOffboardAbsenceDailyRateUsd(breakdown, employeePlain);
      if (dailyRate > 0) {
        const amountUsd =
          Math.round(dailyRate * offboardingAbsence.additionalAbsentDays * 100) / 100;
        extraLines.push({
          code: 'OFFBOARD_ABSENCE',
          label: `Absence after last present (${offboardingAbsence.absenceFrom} – ${offboardingAbsence.absenceTo})`,
          amountUsd,
          category: 'deduction',
        });
      }
    }
  }

  const extraEarnings = extraLines
    .filter((l) => l.category === 'earning')
    .reduce((s, l) => s + l.amountUsd, 0);
  const extraDeductions = extraLines
    .filter((l) => l.category === 'deduction')
    .reduce((s, l) => s + l.amountUsd, 0);

  const grossUsd = breakdown.grossSalary + extraEarnings;
  const netUsd = Math.max(0, breakdown.netSalary + extraEarnings - extraDeductions);

  const prorationConfig = await getProrationConfig();
  const monthlyRun = await PayrollRun.findOne({
    where: { month, status: { [Op.notIn]: ['REJECTED', 'REVERSED', 'CANCELLED'] } },
  });
  let originalBreakdown = null;
  if (monthlyRun) {
    const ps = await Payslip.findOne({
      where: { payrollRunId: monthlyRun.get('id'), userId },
    });
    if (ps) {
      const { loadBreakdownForPayslipId } = await import('../payslipBreakdownService.js');
      originalBreakdown = await loadBreakdownForPayslipId(String(ps.get('id')));
    }
  }

  const attPeriod = await getAttendancePeriod(month);
  const cycle = await resolvePayrollCycleForMonth(month);
  const netRounded = Math.round(netUsd * 100) / 100;

  const payrollOverlap = await assessFinalSettlementPayrollOverlap({
    userId,
    employeeDisplayId: params.employeeDisplayId,
    month,
    lastWorkingDate: lwd,
    settlementNetUsd: netRounded,
  });

  return {
    userId,
    employee: empFull,
    month,
    lastWorkingDate: lwd,
    breakdown,
    hybrid: breakdown.hybrid,
    settlementLines: extraLines,
    grossUsd: Math.round(grossUsd * 100) / 100,
    netUsd: netRounded,
    prorationMethod: prorationConfig.method,
    prorationFactor: breakdown.hybrid?.fixed?.prorationFactor ?? 1,
    originalBreakdown,
    monthlyRunLocked: monthlyRun ? isPayrollRunLocked(String(monthlyRun.get('status'))) : false,
    attendancePeriodStatus: attPeriod.status,
    payrollCycleId: cycle.cycleId,
    payrollCalendarId: cycle.calendarId,
    offboardingAbsence,
    payrollOverlap,
    disbursementMode: payrollOverlap.disbursementMode,
    recommendedPayUsd: payrollOverlap.recommendedPayUsd,
    presentDaysPaid: breakdown.proratedDays ?? 0,
    attendanceProrationReason: breakdown.hybrid?.fixed?.prorationReason ?? null,
  };
}

export async function refreshFinalSettlementPayrollOverlap(settlementId: string): Promise<void> {
  const row: any = await FinalSettlementRun.findByPk(settlementId);
  if (!row) return;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const { employeeDisplayId, userId } = await settlementIdentity(plain);
  const assessment = await assessFinalSettlementPayrollOverlap({
    userId,
    employeeDisplayId,
    month: String(row.month),
    lastWorkingDate: String(row.lastWorkingDate).slice(0, 10),
    settlementNetUsd: Number(row.netUsd ?? 0),
    settlementId,
    settlementStatus: String(row.status),
  });
  await persistSettlementPayrollOverlap(settlementId, assessment);
}

export async function createFinalSettlementRun(params: {
  employeeDisplayId: string;
  lastWorkingDate: string;
  finalSettlementDate?: string;
  paymentDate?: string;
  clearance: ClearanceChecklist;
  settlementLines?: SettlementLineItem[];
  leaveEncashmentUsd?: number;
  loanSettlementUsd?: number;
  assetPenaltyUsd?: number;
  createdBy: string;
  notes?: string;
}) {
  const employeePk = await resolveEmployeePk(params.employeeDisplayId);
  if (!employeePk) {
    const err = new Error('Employee not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existing = await FinalSettlementRun.findOne({
    where: {
      employee_id: employeePk,
      status: { [Op.notIn]: ['REJECTED', 'PAID'] },
    },
  });
  if (existing) {
    const err = new Error(
      'An active final settlement already exists for this employee. Complete or reject it first.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const emp = await Employee.findOne({ where: employeeLookupWhere(params.employeeDisplayId) as never });
  const lwdFromEmp = resolveLastWorkingDate(
    emp ? (emp.get({ plain: true }) as Record<string, unknown>) : null
  );
  const effectiveLwd = params.lastWorkingDate?.slice(0, 10) ?? lwdFromEmp;
  if (!effectiveLwd) {
    const err = new Error('Last working date is required for final settlement') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  if (emp && !lwdFromEmp) {
    await emp.update({ last_working_date: effectiveLwd });
  }

  await assertFinalSettlementEligible(params.employeeDisplayId, {
    lastWorkingDateOverride: effectiveLwd,
  });

  const preview = await calculateFinalSettlementPreview({
    ...params,
    lastWorkingDate: effectiveLwd,
  });
  const id = `fsettle-${Date.now()}`;

  const settlement = await FinalSettlementRun.create({
    id,
    employee_id: employeePk,
    month: preview.month,
    payrollType: 'FINAL_SETTLEMENT',
    disbursementMode: preview.disbursementMode ?? 'SEPARATE_IMMEDIATE',
    status: 'DRAFT',
    lastWorkingDate: preview.lastWorkingDate,
    finalSettlementDate: params.finalSettlementDate?.slice(0, 10) ?? preview.lastWorkingDate,
    paymentDate: params.paymentDate?.slice(0, 10) ?? null,
    prorationMethod: preview.prorationMethod,
    prorationFactor: preview.prorationFactor,
    linkedMonthlyRunId: null,
    grossUsd: preview.grossUsd,
    netUsd: preview.netUsd,
    recommendedPayUsd: preview.recommendedPayUsd ?? preview.netUsd,
    payrollOverlapJson: preview.payrollOverlap
      ? JSON.stringify(preview.payrollOverlap)
      : null,
    clearanceJson: JSON.stringify(params.clearance),
    settlementLinesJson: JSON.stringify(preview.settlementLines),
    breakdownSnapshotJson: JSON.stringify(preview.breakdown),
    originalBreakdownJson: preview.originalBreakdown
      ? JSON.stringify(preview.originalBreakdown)
      : null,
    payrollCalendarId: preview.payrollCalendarId,
    payrollCycleId: preview.payrollCycleId,
    createdBy: params.createdBy,
    notes: params.notes ?? null,
  });

  const monthlyRun = await PayrollRun.findOne({
    where: {
      month: preview.month,
      status: { [Op.notIn]: ['REJECTED', 'REVERSED', 'CANCELLED'] },
    },
  });
  if (monthlyRun) {
    await settlement.update({ linkedMonthlyRunId: String(monthlyRun.get('id')) });
  }

  if (preview.monthlyRunLocked && preview.originalBreakdown) {
    await createPayrollAdjustment({
      userId: preview.userId,
      month: preview.month,
      adjustmentType: 'FINAL_SETTLEMENT',
      amountUsd: Math.round((preview.netUsd - preview.originalBreakdown.netSalary) * 100) / 100,
      description: `Final settlement delta for ${params.employeeDisplayId} (monthly payroll locked)`,
      payrollRunId: String(monthlyRun?.get('id') ?? ''),
      oldValues: preview.originalBreakdown,
      newValues: preview.breakdown,
      createdBy: params.createdBy,
    });
  }

  const { applyDeductionsToSettlement, listApprovedDeductionsForEmployee } = await import(
    './authorizedDeductionService.js'
  );
  const approvedDeductions = await listApprovedDeductionsForEmployee(params.employeeDisplayId);
  if (approvedDeductions.length) {
    await applyDeductionsToSettlement(params.employeeDisplayId, id);
  }

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: id,
    actionType: 'FINAL_SETTLEMENT_CREATED',
    userId: params.createdBy,
    newValue: settlement.get({ plain: true }),
    metadata: {
      lastWorkingDate: preview.lastWorkingDate,
      netUsd: preview.netUsd,
      appliedDeductions: approvedDeductions.length,
    },
  });

  return { settlement: settlement.get({ plain: true }), preview };
}

export async function generateFinalSettlementPayslip(settlementId: string, actorUserId: string) {
  const row: any = await FinalSettlementRun.findByPk(settlementId);
  if (!row) {
    const err = new Error('Final settlement not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const st = String(row.status ?? '').toUpperCase();
  /** Post-payment compliance: final approve leaves status PAID, not APPROVED. */
  const payslipAllowed = ['APPROVED', 'PAID', 'LOCKED', 'PENDING_REMOVAL_APPROVAL'].includes(st);
  if (!payslipAllowed) {
    const err = new Error(
      `Cannot generate payslip while status is ${st}. Complete management approval or payment first.`
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  if (row.payslipId) {
    return String(row.payslipId);
  }

  const breakdown = parseJson(row.breakdownSnapshotJson, null);
  if (!breakdown) {
    const err = new Error('Missing breakdown snapshot') as Error & { statusCode?: number };
    err.statusCode = 500;
    throw err;
  }

  const { allocateNextPayslipId } = await import('./payslipIdFormat.js');
  const payslipId = await allocateNextPayslipId();
  const { employeeDisplayId, userId } = await settlementIdentity(row.get({ plain: true }) as Record<string, unknown>);
  const { Payslip: PayslipModel } = await import('../db.js');
  await PayslipModel.upsert({
    id: payslipId,
    payrollRunId: settlementId,
    userId,
    month: row.month,
    status: 'APPROVED',
    generatedAt: new Date().toISOString(),
  });

  await PayslipBreakdown.upsert(breakdownToRow(payslipId, breakdown));
  await row.update({ payslipId });

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: settlementId,
    actionType: 'FINAL_SETTLEMENT_PAYSLIP_GENERATED',
    userId: actorUserId,
    newValue: { payslipId },
  });

  return payslipId;
}

function parseSettlementJsonField(raw: unknown): unknown {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Expose stored payslip breakdown + line items to clients for review UI. */
export function attachSettlementDisplayFields(
  plain: Record<string, unknown>
): Record<string, unknown> {
  if (!plain.breakdown && plain.breakdownSnapshotJson) {
    plain.breakdown = parseSettlementJsonField(plain.breakdownSnapshotJson);
  }
  if (!plain.settlementLines && plain.settlementLinesJson) {
    plain.settlementLines = parseSettlementJsonField(plain.settlementLinesJson) ?? [];
  }
  return plain;
}

export async function listFinalSettlements(filters?: {
  employeeId?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.employeeId) {
    const pk = await resolveEmployeePk(filters.employeeId);
    if (pk) where.employee_id = pk;
  }
  if (filters?.status) where.status = filters.status;
  const rows = await FinalSettlementRun.findAll({
    where,
    order: [['createdAt', 'DESC']],
  });
  const employeePks = [...new Set(rows.map((r) => String(r.get('employee_id'))))].filter(Boolean);
  const employees = employeePks.length
    ? await Employee.findAll({ where: { id: { [Op.in]: employeePks } } })
    : [];
  const contactByPk = new Map<
    string,
    { name: string; email?: string; phone?: string; displayId: string }
  >();
  for (const emp of employees) {
    const p = emp.get({ plain: true }) as {
      id?: string;
      employee_id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
    };
    const pk = String(p.id ?? '');
    if (pk) {
      contactByPk.set(pk, {
        displayId: toCanonicalEmployeeDisplayId(p.employee_id) || String(p.employee_id ?? ''),
        name: joinEmployeeNameParts(p.first_name, p.last_name),
        email: String(p.email ?? '').trim() || undefined,
        phone: String(p.phone ?? '').trim() || undefined,
      });
    }
  }
  return Promise.all(
    rows.map(async (r) => {
      const plain = r.get({ plain: true }) as Record<string, unknown>;
      const pk = String(plain.employee_id ?? '');
      const contact = contactByPk.get(pk);
      const enriched = await settlementIdentity(plain);
      return attachSettlementDisplayFields({
        ...plain,
        employeeId:
          toCanonicalEmployeeDisplayId(enriched.employeeDisplayId) || enriched.employeeDisplayId,
        userId: enriched.userId,
        employeeName: contact?.name || undefined,
        employeeEmail: contact?.email || undefined,
        employeePhone: contact?.phone || undefined,
      });
    })
  );
}

export async function getFinalSettlementById(id: string) {
  const row = await FinalSettlementRun.findByPk(id);
  if (!row) {
    const err = new Error('Final settlement not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const { employeeDisplayId, userId } = await settlementIdentity(plain);
  const emp = employeeDisplayId
    ? await Employee.findOne({ where: employeeLookupWhere(employeeDisplayId) as never })
    : await Employee.findByPk(String(plain.employee_id ?? ''));
  if (emp) {
    const p = emp.get({ plain: true }) as { first_name?: string; last_name?: string };
    plain.employeeName = joinEmployeeNameParts(p.first_name, p.last_name);
  }
  plain.payrollOverlap =
    parsePayrollOverlap(plain.payrollOverlapJson) ??
    (await assessFinalSettlementPayrollOverlap({
      userId,
      employeeDisplayId,
      month: String(plain.month),
      lastWorkingDate: String(plain.lastWorkingDate).slice(0, 10),
      settlementNetUsd: Number(plain.netUsd ?? 0),
      settlementId: id,
      settlementStatus: String(plain.status),
    }));
  return attachSettlementDisplayFields({
    ...plain,
    employeeId: toCanonicalEmployeeDisplayId(employeeDisplayId) || employeeDisplayId,
    userId,
  });
}

export async function getFinalSettlementPrefill(
  employeeDisplayId: string,
  options?: { lastWorkingDateOverride?: string | null }
) {
  const assessment = await assessFinalSettlementEligibility(employeeDisplayId, options);
  if (!assessment.eligible && !assessment.existingDraft) {
    const err = new Error(assessment.reasons.join(' ')) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return assessment;
}

export async function updateDraftFinalSettlement(
  settlementId: string,
  params: {
    lastWorkingDate: string;
    finalSettlementDate?: string;
    paymentDate?: string;
    clearance: ClearanceChecklist;
    settlementLines?: SettlementLineItem[];
    leaveEncashmentUsd?: number;
    loanSettlementUsd?: number;
    assetPenaltyUsd?: number;
    notes?: string;
    updatedBy: string;
  }
) {
  const row = await FinalSettlementRun.findByPk(settlementId);
  if (!row) {
    const err = new Error('Final settlement not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (String(row.get('status')).toUpperCase() !== 'DRAFT') {
    const err = new Error('Only draft settlements can be edited') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const { employeeDisplayId } = await settlementIdentity(row.get({ plain: true }) as Record<string, unknown>);
  const draftLwd = params.lastWorkingDate.slice(0, 10);
  await assertFinalSettlementEligible(employeeDisplayId, {
    allowDraftId: settlementId,
    lastWorkingDateOverride: draftLwd,
  });

  const preview = await calculateFinalSettlementPreview({
    employeeDisplayId,
    lastWorkingDate: draftLwd,
    settlementLines: params.settlementLines,
    leaveEncashmentUsd: params.leaveEncashmentUsd,
    loanSettlementUsd: params.loanSettlementUsd,
    assetPenaltyUsd: params.assetPenaltyUsd,
    skipEligibilityCheck: true,
  });

  await row.update({
    month: preview.month,
    lastWorkingDate: preview.lastWorkingDate,
    finalSettlementDate:
      params.finalSettlementDate?.slice(0, 10) ?? preview.lastWorkingDate,
    paymentDate: params.paymentDate?.slice(0, 10) ?? null,
    prorationMethod: preview.prorationMethod,
    prorationFactor: preview.prorationFactor,
    grossUsd: preview.grossUsd,
    netUsd: preview.netUsd,
    recommendedPayUsd: preview.recommendedPayUsd ?? preview.netUsd,
    payrollOverlapJson: preview.payrollOverlap
      ? JSON.stringify(preview.payrollOverlap)
      : null,
    clearanceJson: JSON.stringify(params.clearance),
    settlementLinesJson: JSON.stringify(preview.settlementLines),
    breakdownSnapshotJson: JSON.stringify(preview.breakdown),
    originalBreakdownJson: preview.originalBreakdown
      ? JSON.stringify(preview.originalBreakdown)
      : null,
    payrollCalendarId: preview.payrollCalendarId,
    payrollCycleId: preview.payrollCycleId,
    notes: params.notes ?? row.get('notes'),
  });

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: settlementId,
    actionType: 'FINAL_SETTLEMENT_UPDATED',
    userId: params.updatedBy,
    newValue: row.get({ plain: true }),
  });

  return { settlement: row.get({ plain: true }), preview };
}
