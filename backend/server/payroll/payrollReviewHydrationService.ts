import type { PayrollBreakdown } from '../payrollCalculation.js';
import { PayslipBreakdown } from '../db.js';
import { breakdownToRow } from '../payslipBreakdownDb.js';
import { loadActiveEmployeesForPayroll } from '../salaryStructureService.js';
import { buildPayrollEngineCache } from './payrollEngineCache.js';
import {
  bulkLoadDepartmentNames,
  bulkLoadPriorMonthNetByUserId,
  bulkLoadSettlementOverlapUserIds,
} from './payrollReviewComparisonService.js';
import { enrichPayrollBreakdownReviewFields } from './payrollReviewEnrichment.js';
import type { PayrollReviewContext } from './payrollReviewContext.js';

function reviewContextNeedsRefresh(ctx: PayrollReviewContext | undefined): boolean {
  if (!ctx) return true;
  // Legacy rows before register enrichment — prorationLabel is always set when enriched.
  if (!String(ctx.prorationLabel ?? '').trim()) return true;
  return false;
}

/** Batch-refresh reviewContext on payslips loaded from DB (legacy rows / partial snapshots). */
export async function ensureReviewContextForPayslips(
  payslipRows: Array<{
    userId: string;
    breakdown: PayrollBreakdown | null;
  }>,
  month: string,
  payrollGroupId = 'default'
): Promise<void> {
  const monthKey = month.slice(0, 7);
  const needsRefresh = payslipRows.filter(
    (row) => row.breakdown && reviewContextNeedsRefresh(row.breakdown.reviewContext)
  );
  if (!needsRefresh.length) return;

  const [engineCache, eligibleEmployees] = await Promise.all([
    buildPayrollEngineCache(monthKey, payrollGroupId),
    loadActiveEmployeesForPayroll(),
  ]);
  const employeeByUserId = new Map(
    eligibleEmployees.map(({ userId, employee }) => [userId, employee])
  );

  const { Position } = await import('../db.js');
  const positionIds = [
    ...new Set(
      [...employeeByUserId.values()]
        .map((e) => String(e.position_id ?? '').trim())
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

  const departmentIds = [
    ...new Set(
      [...employeeByUserId.values()]
        .map((e) => String(e.department_id ?? '').trim())
        .filter(Boolean)
    ),
  ];
  const departmentNameById = await bulkLoadDepartmentNames(departmentIds);

  const userIds = needsRefresh.map((r) => r.userId);
  const cohortForSettlement = userIds.map((userId) => {
    const emp = employeeByUserId.get(userId);
    return {
      userId,
      employeeId: String(emp?.employee_id ?? emp?.id ?? userId),
    };
  });

  const [priorMonthNetByUserId, settlementOverlapUserIds] = await Promise.all([
    bulkLoadPriorMonthNetByUserId(monthKey, userIds),
    bulkLoadSettlementOverlapUserIds(monthKey, cohortForSettlement),
  ]);

  const attStatus = String(engineCache.attPeriod?.status ?? 'OPEN').toUpperCase();
  const attendanceFinalized = attStatus === 'FINALIZED' || attStatus === 'LOCKED';

  for (const row of needsRefresh) {
    if (!row.breakdown) continue;
    const employee = employeeByUserId.get(row.userId) ?? null;
    row.breakdown = enrichPayrollBreakdownReviewFields(row.breakdown, employee, {
      taxBrackets: engineCache.taxBrackets,
      positionTitleById,
      departmentNameById,
      userId: row.userId,
      period: engineCache.period,
      priorMonthNetByUserId,
      settlementOverlapUserIds,
      attendancePeriodStatus: attStatus,
      attendanceFinalized,
      payrollMonth: monthKey,
    });
  }
}

/** Persist hydrated reviewContext onto payslipbreakdowns (draft runs only). */
export async function persistReviewContextSnapshots(
  rows: Array<{ payslipId: string; breakdown: PayrollBreakdown | null }>
): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    if (!row.breakdown?.reviewContext || !row.payslipId) continue;
    const patch = breakdownToRow(row.payslipId, row.breakdown);
    const [count] = await PayslipBreakdown.update(
      { reviewContextJson: patch.reviewContextJson ?? null },
      { where: { payslipId: row.payslipId } }
    );
    if (count > 0) updated += 1;
  }
  return updated;
}
