import { getReportDefinition, listReportCatalog } from './reportCatalog.js';
import { normalizeReportFilters, ReportValidationError } from './reportFilterUtils.js';
import { buildReportSummary } from './reportSummary.js';
import type { ReportRunContext, ReportRunResult, ReportRunner } from './reportTypes.js';
import { runHeadcountSummary } from './runners/workforceRunner.js';
import { runLeavingByDepartment } from './runners/attendanceLeaveOtRunner.js';
import {
  runNssfContributions,
  runPayrollAndRule,
  runPayrollByDepartment,
  runTaxWithholding,
} from './runners/payrollRunner.js';
import {
  runAbandonmentAbsenceAlerts,
  runOrgMonthlyKpis,
} from './runners/hrPerformanceOrgRunner.js';
import {
  runLeaveUtilization,
  runOtByDepartment,
  runWorkforceComposition,
} from './runners/analyticsRunner.js';
import {
  runAttendanceRiskOutlook,
  runHeadcountOutlook,
  runOtCostOutlook,
  runPayrollCostOutlook,
} from './runners/forecastRunner.js';

const RUNNERS: Record<string, ReportRunner> = {
  'headcount-summary': runHeadcountSummary,
  'workforce-composition': runWorkforceComposition,
  'attrition-by-department': runLeavingByDepartment,
  'leave-utilization': runLeaveUtilization,
  'ot-by-department': runOtByDepartment,
  'payroll-by-department': runPayrollByDepartment,
  'payroll-and-rule': runPayrollAndRule,
  'nssf-contributions': runNssfContributions,
  'tax-withholding': runTaxWithholding,
  'abandonment-absence-alerts': runAbandonmentAbsenceAlerts,
  'org-monthly-kpis': runOrgMonthlyKpis,
  'headcount-outlook': runHeadcountOutlook,
  'payroll-cost-outlook': runPayrollCostOutlook,
  'ot-cost-outlook': runOtCostOutlook,
  'attendance-risk-outlook': runAttendanceRiskOutlook,
};

export function getCatalog() {
  return listReportCatalog();
}

export async function runReport(
  reportId: string,
  rawFilters: Record<string, unknown> | null | undefined,
  ctx: ReportRunContext = {}
): Promise<ReportRunResult> {
  const definition = getReportDefinition(reportId);
  if (!definition) {
    const err = new ReportValidationError(`Unknown report: ${reportId}`);
    err.status = 404;
    throw err;
  }
  const runner = RUNNERS[reportId];
  if (!runner) {
    const err = new ReportValidationError(`Report runner not implemented: ${reportId}`);
    err.status = 501;
    throw err;
  }

  const filters = normalizeReportFilters(definition, rawFilters);
  const result = await runner(filters, ctx);
  const summary = buildReportSummary(result.columns, result.rows, {
    cards: result.summaryCards,
    ...(result.totalsRow !== undefined ? { totalsRow: result.totalsRow } : {}),
  });

  return {
    reportId: definition.id,
    title: definition.title,
    columns: result.columns,
    rows: result.rows,
    summary,
    meta: {
      generatedAt: new Date().toISOString(),
      rowCount: result.rows.length,
      filtersApplied: filters,
      note: result.note,
    },
  };
}

export { ReportValidationError };
