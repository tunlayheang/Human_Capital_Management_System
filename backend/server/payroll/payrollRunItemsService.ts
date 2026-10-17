/**

 * Single source of truth for per-employee payroll line items (preview + run creation).

 * Finance rule: preview and payroll run MUST use this module — never duplicate loops in routes.

 */

import {

  buildBreakdownForUserId,

  reconcilePayrollBreakdown,

  type PayrollBreakdown,

} from '../payrollCalculation.js';

import { breakdownToRow, rowToBreakdown } from '../payslipBreakdownDb.js';

import { loadActiveEmployeesForPayroll } from '../salaryStructureService.js';

import { buildPayrollEngineCache } from './payrollEngineCache.js';



import { PAYROLL_CALCULATION_ENGINE_VERSION } from './payrollWorkingDaysService.js';

import { toCanonicalEmployeeDisplayId } from '../employeeIdFormat.js';

const CALCULATION_ENGINE_VERSION = PAYROLL_CALCULATION_ENGINE_VERSION;

const PAYROLL_ITEM_CONCURRENCY = 12;



export type PayrollRunItemWarning = {

  code: string;

  message: string;

};



export type PayrollRunItem = {

  userId: string;

  employeeId: string;

  employeeStatus: string;

  breakdown: PayrollBreakdown;

  warnings: PayrollRunItemWarning[];

  /** AI / rule-based payroll review patterns (see payrollAnomalyDetectionService). */

  anomalies?: import('./payrollAnomalyDetectionService.js').PayrollAnomaly[];

};



export type PayrollRunItemError = {

  userId: string;

  employeeId: string;

  message: string;

};



export type PayrollGlobalWarning = {

  code: string;

  message: string;

};



export type PayrollRunItemsResult = {

  month: string;

  calculationEngine: string;

  generatedAt: string;

  period: {

    payPeriodStart: string;

    payPeriodEnd: string;

    attendanceCutoffDate: string | null;

    payrollGroupId: string;

  };

  attendancePeriodStatus: string;

  attendanceFinalized: boolean;

  items: PayrollRunItem[];

  errors: PayrollRunItemError[];

  globalWarnings: PayrollGlobalWarning[];

  anomalySummary?: import('./payrollAnomalyDetectionService.js').PayrollAnomalySummary;

  prorationMethod?: string;

  engineRulesSummary?: string;

};



function roundUsd(n: number): number {

  return Math.round(n * 100) / 100;

}



/** Same rounding path as persisted payslipbreakdowns rows. */

export function finalizeBreakdownForPersistence(b: PayrollBreakdown): PayrollBreakdown {

  return rowToBreakdown(breakdownToRow('__finance_validate__', reconcilePayrollBreakdown(b)));

}



/** Returns human-readable message when gross − deductions ≠ net (tolerance 2 cents). */

export function validatePayrollBreakdownBalance(b: PayrollBreakdown): string | null {

  const gross = roundUsd(Number(b.grossSalary) || 0);

  const ded = roundUsd(Number(b.deductions?.total) || 0);

  const net = roundUsd(Number(b.netSalary) || 0);

  const expected = roundUsd(Math.max(0, gross - ded));

  if (Math.abs(net - expected) > 0.02) {

    return `Net pay $${net} ≠ gross $${gross} − deductions $${ded} (expected $${expected})`;

  }

  return null;

}



function itemWarnings(

  breakdown: PayrollBreakdown,

  employeeId: string,

  options?: { estimateMode?: boolean }

): PayrollRunItemWarning[] {

  const warnings: PayrollRunItemWarning[] = [];

  if ((breakdown.baseSalary ?? 0) <= 0) {

    const contractBase = Number(breakdown.contractBaseSalary ?? 0) || 0;

    if (contractBase > 0) {

      warnings.push({

        code: 'ZERO_PRORATED_BASE',

        message: `${employeeId}: $0 prorated base for this period (check join/leave dates) — contract base $${contractBase}.`,

      });

    } else {

      warnings.push({

        code: 'ZERO_BASE_SALARY',

        message: `${employeeId}: no base salary on file — verify salary structure before paying.`,

      });

    }

  }

  const summary = breakdown.attendanceSummary;

  if (
    !options?.estimateMode &&
    (!summary || (summary.recordsInPeriod ?? 0) === 0)
  ) {

    warnings.push({

      code: 'NO_ATTENDANCE_IN_PERIOD',

      message: `${employeeId}: no attendance records in payroll period.`,

    });

  }

  const balanceErr = validatePayrollBreakdownBalance(breakdown);

  if (balanceErr) {

    warnings.push({ code: 'BREAKDOWN_IMBALANCE', message: `${employeeId}: ${balanceErr}` });

  }

  return warnings;

}



async function mapWithConcurrency<T, R>(

  items: T[],

  limit: number,

  fn: (item: T) => Promise<R>

): Promise<R[]> {

  const results: R[] = [];

  for (let i = 0; i < items.length; i += limit) {

    const chunk = items.slice(i, i + limit);

    results.push(...(await Promise.all(chunk.map(fn))));

  }

  return results;

}



export async function buildPayrollRunItemsForMonth(

  monthStr: string,

  options: {

    skipFinalizationCheck?: boolean;

    payrollGroupId?: string;

    /** When false, skips Violet AI anomaly detection (faster preview). */

    skipAnomalyDetection?: boolean;

    /** When false, skips writing unified rule evaluation rows (faster dashboard preview). */

    persistRuleLogs?: boolean;

    /** Net pay from the prior calculation of the same run (recalculate diff). */

    previousRunNetByUserId?: Map<string, number>;

    /** When false, payroll preview uses contract/allowance estimates only (no attendance grid or absence deductions). */

    includeAttendance?: boolean;

  } = {}

): Promise<PayrollRunItemsResult> {

  const month = monthStr.slice(0, 7);

  const payrollGroupId = options.payrollGroupId ?? 'default';
  const includeAttendance = options.includeAttendance !== false;
  const estimateMode = !includeAttendance;

  const [
    { ensureAttendanceLateColumns },
    { ensureFinalSettlementSchema },
    { ensurePayrollHybridSchema },
    { ensureLeaveTypeCategoryColumns },
    { ensureAllowanceRulesSchema },
    { ensureSeniorityEngineSchema },
    { ensureUnifiedPayrollRuleSchema },
    { ensureEmployeeMonthlySalesSchema },
  ] = await Promise.all([
    import('../attendanceLateFields.js'),
    import('./finalSettlementSchema.js'),
    import('./payrollHybridSchema.js'),
    import('../leaveTypeSchema.js'),
    import('../allowanceSchemaService.js'),
    import('./seniority/seniorityRuleSchema.js'),
    import('./unifiedPayrollRuleSchema.js'),
    import('./employeeMonthlySalesSchema.js'),
  ]);
  const runSchemaEnsure = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[payroll] Schema ensure ${label} skipped:`, (err as Error)?.message || err);
    }
  };
  await Promise.all([
    runSchemaEnsure('attendance late columns', ensureAttendanceLateColumns),
    runSchemaEnsure('final settlement schema', ensureFinalSettlementSchema),
    runSchemaEnsure('payroll hybrid schema', ensurePayrollHybridSchema),
    runSchemaEnsure('leave type category columns', ensureLeaveTypeCategoryColumns),
    runSchemaEnsure('allowance rules schema', ensureAllowanceRulesSchema),
    runSchemaEnsure('seniority engine schema', ensureSeniorityEngineSchema),
    runSchemaEnsure('unified payroll rules schema', ensureUnifiedPayrollRuleSchema),
    runSchemaEnsure('employee monthly sales schema', ensureEmployeeMonthlySalesSchema),
  ]);



  const [engineCache, eligibleEmployees] = await Promise.all([

    buildPayrollEngineCache(month, payrollGroupId),

    loadActiveEmployeesForPayroll(),

  ]);
  engineCache.estimateMode = estimateMode;

  const attPeriod = engineCache.attPeriod;



  const period = engineCache.period;

  const attStatus = String(attPeriod.status ?? 'OPEN').toUpperCase();

  const attendanceFinalized = attStatus === 'FINALIZED' || attStatus === 'LOCKED';



  const globalWarnings: PayrollGlobalWarning[] = [];

  if (!attendanceFinalized && options.skipFinalizationCheck) {

    globalWarnings.push({

      code: 'ATTENDANCE_NOT_FINALIZED',

      message:

        `Attendance for ${month} is ${attStatus}. Figures may change until attendance is finalized and locked.`,

    });

  }

  if (estimateMode) {
    globalWarnings.push({
      code: 'ESTIMATE_NO_ATTENDANCE',
      message:
        'Estimate preview — base pay, allowances, and statutory deductions only. Absence and late penalties apply after attendance is finalized.',
    });
  } else if (includeAttendance && !attendanceFinalized) {
    globalWarnings.push({
      code: 'DEDUCTIONS_INACTIVE_UNTIL_FINALIZED',
      message:
        `Attendance for ${month} is ${attStatus}. Absence and late deductions are included only after attendance is finalized and locked.`,
    });
  }

  const { FinalSettlementRun } = await import('./finalSettlementSchema.js');
  const { findDisplayIdByEmployeePk } = await import('../employeeIdentity.js');
  let pendingSeparatePay: InstanceType<typeof FinalSettlementRun>[] = [];
  try {
    pendingSeparatePay = await FinalSettlementRun.findAll({
      where: { month, status: 'APPROVED' },
      attributes: ['employee_id', 'netUsd', 'recommendedPayUsd'],
    });
  } catch (settlementErr) {
    console.warn(
      '[payroll] Final settlement lookup skipped:',
      (settlementErr as Error)?.message || settlementErr
    );
  }
  if (pendingSeparatePay.length) {
    const ids = (
      await Promise.all(
        pendingSeparatePay.map(async (r) =>
          (await findDisplayIdByEmployeePk(String(r.get('employee_id')))) ??
          String(r.get('employee_id'))
        )
      )
    )
      .slice(0, 8)
      .join(', ');
    const more =
      pendingSeparatePay.length > 8 ? ` (+${pendingSeparatePay.length - 8} more)` : '';
    globalWarnings.push({
      code: 'FINAL_SETTLEMENT_SEPARATE_PAY_PENDING',
      message: `Option A: ${pendingSeparatePay.length} approved final settlement(s) await separate payment (${ids}${more}). Pay via Offboarding → Payment before closing monthly payroll if those employees appear on this run.`,
    });
  }

  const employeesByUserId = new Map(

    eligibleEmployees.map((e) => [e.userId, e.employee])

  );

  if (eligibleEmployees.length === 0) {
    globalWarnings.push({
      code: 'NO_PAYROLL_EMPLOYEES',
      message:
        'No active employees with portal login are eligible for this payroll period. Activate employees (not draft), ensure each has a work email, and enable portal login in User Management.',
    });
  }

  const { preloadBackPayForMonth, applyBackPayToBreakdown } = await import(

    './payrollBackPayService.js'

  );

  const backPayByUser = await preloadBackPayForMonth(month, employeesByUserId);

  const { bulkGetApprovedOvertimeHoursForUsers } = await import('../overtimeRequestService.js');
  const { resolveLastWorkingDate } = await import('./employeePayrollEligibility.js');
  const throughDateByUserId = new Map<string, string | null>();
  for (const { userId, employee } of eligibleEmployees) {
    throughDateByUserId.set(userId, resolveLastWorkingDate(employee) ?? null);
  }
  engineCache.approvedOvertimeByUserId = await bulkGetApprovedOvertimeHoursForUsers({
    userIds: eligibleEmployees.map((e) => e.userId),
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    throughDateByUserId,
  });

  const batchAttEnd =
    period.attendanceCutoffDate && period.attendanceCutoffDate <= period.payPeriodEnd
      ? period.attendanceCutoffDate
      : period.payPeriodEnd;

  if (!attendanceFinalized && includeAttendance) {
    try {
      const { reconcileAttendanceAbsences } = await import('../attendanceReconcileService.js');
      await reconcileAttendanceAbsences({
        from: period.payPeriodStart,
        to: batchAttEnd,
      });
    } catch (reconcileErr) {
      console.warn(
        '[payroll] Attendance reconcile before batch calculation skipped:',
        (reconcileErr as Error)?.message || reconcileErr
      );
    }
  }

  const userIds = eligibleEmployees.map((e) => e.userId);
  const [{ buildApprovedLeaveByDateForUsers }, { countApprovedLeaveDaysByUserForMonth }, { preloadPayrollAttendanceGridForUsers }] =
    await Promise.all([
      import('../approvedLeaveDayMap.js'),
      import('../payrollLeaveDeductions.js'),
      import('./payrollAttendanceRecordService.js'),
    ]);
  const [approvedLeaveByDateMap, leaveDayCounts, attendanceGridByUserId] = await Promise.all([
    buildApprovedLeaveByDateForUsers(userIds, period.payPeriodStart, batchAttEnd),
    countApprovedLeaveDaysByUserForMonth(userIds, month, {
      periodStart: period.payPeriodStart,
      periodEnd: batchAttEnd,
    }),
    includeAttendance
      ? preloadPayrollAttendanceGridForUsers({
          userIds,
          periodStart: period.payPeriodStart,
          periodEnd: batchAttEnd,
        })
      : Promise.resolve(new Map<string, import('./payrollAttendanceRecordService.js').AttendanceRowLike[]>()),
  ]);
  engineCache.approvedLeaveByDateMap = approvedLeaveByDateMap;
  engineCache.unpaidLeaveDaysByUserId = new Map(
    [...leaveDayCounts.entries()].map(([uid, counts]) => [uid, counts.unpaidDays])
  );
  engineCache.attendanceGridByUserId = attendanceGridByUserId;

  let zeroProratedBaseCount = 0;

  let zeroContractBaseCount = 0;

  let backPayEmployeeCount = 0;

  let backPayTotalUsd = 0;

  const { enrichPayrollBreakdownReviewFields } = await import('./payrollReviewEnrichment.js');
  const { Position } = await import('../db.js');
  const positionIds = [
    ...new Set(
      eligibleEmployees
        .map(({ employee }) => String(employee.position_id ?? '').trim())
        .filter(Boolean)
    ),
  ];
  const positionRows = positionIds.length
    ? ((await Position.findAll({
        where: { id: positionIds },
        attributes: ['id', 'title'],
        raw: true,
      })) as { id?: string; title?: string }[])
    : [];
  const positionTitleById = new Map(
    positionRows.map((p) => [String(p.id), String(p.title ?? '').trim() || '—'])
  );

  const {
    bulkLoadDepartmentNames,
    bulkLoadPriorMonthNetByUserId,
    bulkLoadSettlementOverlapUserIds,
  } = await import('./payrollReviewComparisonService.js');
  const departmentIds = [
    ...new Set(
      eligibleEmployees
        .map(({ employee }) => String(employee.department_id ?? '').trim())
        .filter(Boolean)
    ),
  ];
  const departmentNameById = await bulkLoadDepartmentNames(departmentIds);
  const cohortUserIds = eligibleEmployees.map(({ userId }) => userId);
  const cohortForSettlement = eligibleEmployees.map(({ userId, employee }) => ({
    userId,
    employeeId: toCanonicalEmployeeDisplayId(employee.employee_id) || String(employee.employee_id ?? userId),
  }));
  const [priorMonthNetByUserId, settlementOverlapUserIds] = await Promise.all([
    bulkLoadPriorMonthNetByUserId(month, cohortUserIds),
    bulkLoadSettlementOverlapUserIds(month, cohortForSettlement),
  ]);

  const built = await mapWithConcurrency(

    eligibleEmployees,

    PAYROLL_ITEM_CONCURRENCY,

    async ({ userId, employee }) => {

      const employeeId =
        toCanonicalEmployeeDisplayId(employee.employee_id) || String(employee.employee_id ?? userId);

      try {

        const raw = await buildBreakdownForUserId(userId, month, {

          skipFinalizationCheck: options.skipFinalizationCheck ?? false,

          engineCache,

          employee,

          persistRuleLogs: options.persistRuleLogs !== false,

        });

        let breakdown = raw;

        const backPay = backPayByUser.get(userId);

        if (backPay && backPay.totalUsd !== 0) {

          breakdown = await applyBackPayToBreakdown(breakdown, backPay, userId, {

              employee,

              engineInputs: engineCache,

            });

        }

        breakdown = enrichPayrollBreakdownReviewFields(breakdown, employee, {
          taxBrackets: engineCache.taxBrackets,
          positionTitleById,
          departmentNameById,
          userId,
          period: {
            payPeriodStart: period.payPeriodStart,
            payPeriodEnd: period.payPeriodEnd,
          },
          priorMonthNetByUserId,
          previousRunNetByUserId: options.previousRunNetByUserId,
          settlementOverlapUserIds,
          attendancePeriodStatus: attStatus,
          attendanceFinalized,
          payrollMonth: month,
        });

        breakdown = finalizeBreakdownForPersistence(breakdown);



        const warnings = itemWarnings(breakdown, employeeId, { estimateMode });

        let zeroProrated = false;

        let zeroContract = false;

        if ((breakdown.baseSalary ?? 0) <= 0) {

          if ((Number(breakdown.contractBaseSalary ?? 0) || 0) > 0) zeroProrated = true;

          else zeroContract = true;

        }

        if (backPay && backPay.totalUsd !== 0) {

          warnings.push({

            code: 'BACK_PAY_INCLUDED',

            message: `${employeeId}: $${backPay.totalUsd} back pay from ${backPay.sourceMonth} included in this period.`,

          });

        }



        return {

          ok: true as const,

          item: {

            userId,

            employeeId,

            employeeStatus: String(employee.status ?? 'active'),

            breakdown,

            warnings,

          },

          zeroProrated,

          zeroContract,

          backPayUsd: backPay?.totalUsd ?? 0,

        };

      } catch (err) {

        return {

          ok: false as const,

          error: {

            userId,

            employeeId,

            message: err instanceof Error ? err.message : 'Calculation failed',

          },

        };

      }

    }

  );



  const items: PayrollRunItem[] = [];

  const errors: PayrollRunItemError[] = [];



  for (const row of built) {

    if (row.ok) {

      items.push(row.item);

      if (row.zeroProrated) zeroProratedBaseCount += 1;

      if (row.zeroContract) zeroContractBaseCount += 1;

      if (row.backPayUsd !== 0) {

        backPayEmployeeCount += 1;

        backPayTotalUsd = roundUsd(backPayTotalUsd + row.backPayUsd);

      }

    } else {

      errors.push(row.error);

    }

  }



  if (zeroProratedBaseCount > 0) {

    globalWarnings.push({

      code: 'ZERO_PRORATED_BASE',

      message: `${zeroProratedBaseCount} employee(s) have $0 prorated base for this period — check join/leave dates (compensation is on file).`,

    });

  }

  if (zeroContractBaseCount > 0) {

    globalWarnings.push({

      code: 'EMPLOYEES_MISSING_SALARY',

      message: `${zeroContractBaseCount} employee(s) have no base salary on file — review compensation before disbursement.`,

    });

  }

  if (errors.length > 0) {

    globalWarnings.push({

      code: 'CALCULATION_ERRORS',

      message: `${errors.length} employee(s) could not be calculated — resolve errors before running payroll.`,

    });

  }

  if (backPayEmployeeCount > 0) {

    globalWarnings.push({

      code: 'BACK_PAY_ROLLED_FORWARD',

      message: `${backPayEmployeeCount} employee(s) include $${backPayTotalUsd} back pay from approved adjustments not yet applied (prior locked months).`,

    });

  }



  let anomalySummary: import('./payrollAnomalyDetectionService.js').PayrollAnomalySummary | undefined;



  if (!options.skipAnomalyDetection) {

    const { detectPayrollAnomalies } = await import('./payrollAnomalyDetectionService.js');

    const anomalyResult = await detectPayrollAnomalies(items, month);

    anomalySummary = anomalyResult.summary;

    for (const item of items) {

      const anomalies = anomalyResult.byEmployeeId.get(item.employeeId);

      if (anomalies?.length) {

        item.anomalies = anomalies;

        for (const a of anomalies) {

          item.warnings.push({

            code: a.code,

            message: a.message,

          });

        }

      }

    }

    for (const insight of anomalyResult.globalInsights) {

      globalWarnings.push(insight);

    }

  }

  const prorationMethod = engineCache.prorationConfig.method;
  const workDayMethod =
    engineCache.workDayPolicy?.method ??
    engineCache.prorationConfig.workDayMethod ??
    'fixed_employee_basis';
  const companyBasisDays =
    engineCache.workDayPolicy?.companyBasisDays ??
    engineCache.prorationConfig.companyBasisDays ??
    26;
  const engineRulesSummary =
    workDayMethod === 'fixed_company_basis'
      ? `Daily rate = monthly salary ÷ company payroll basis (${companyBasisDays} days). Attendance metrics from attendance records only.`
      : 'Daily rate = monthly salary ÷ each employee’s payroll basis days (22/24/26). Attendance metrics from attendance records only.';

  return {

    month,

    calculationEngine: CALCULATION_ENGINE_VERSION,

    prorationMethod,

    engineRulesSummary,

    generatedAt: new Date().toISOString(),

    period: {

      payPeriodStart: period.payPeriodStart,

      payPeriodEnd: period.payPeriodEnd,

      attendanceCutoffDate: period.attendanceCutoffDate ?? null,

      payrollGroupId,

    },

    attendancePeriodStatus: attStatus,

    attendanceFinalized,

    items,

    errors,

    globalWarnings,

    anomalySummary,

  };

}



export function sumPayrollRunItems(items: PayrollRunItem[]): {

  totalEmployees: number;

  totalGross: number;

  totalNetPay: number;

} {

  let totalGross = 0;

  let totalNetPay = 0;

  for (const item of items) {
    const b = reconcilePayrollBreakdown(item.breakdown);
    totalGross += b.grossSalary ?? 0;
    totalNetPay += b.netSalary ?? 0;
  }

  return {

    totalEmployees: items.length,

    totalGross: roundUsd(totalGross),

    totalNetPay: roundUsd(totalNetPay),

  };

}

export function summarizePayrollRunItemsResult(result: {
  items: PayrollRunItem[];
  errors: PayrollRunItemError[];
}): {
  totalEmployees: number;
  totalGross: number;
  totalNetPay: number;
  eligibleEmployees: number;
  failedEmployees: number;
} {
  const totals = sumPayrollRunItems(result.items);
  return {
    ...totals,
    eligibleEmployees: result.items.length + result.errors.length,
    failedEmployees: result.errors.length,
  };
}


