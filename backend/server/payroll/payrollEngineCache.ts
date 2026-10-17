import { loadPayrollEngineInputs, type PayrollEngineInputs } from '../payrollEngineInputs.js';
import { resolvePayrollPeriod } from './payrollPeriodService.js';
import { getAttendancePeriod } from './attendanceFinalizationService.js';
import { getProrationConfig } from './prorationConfigService.js';
import type { PayrollPeriodBounds } from './hybridPayrollTypes.js';
import type { AttendancePeriodStatus } from './hybridPayrollTypes.js';
import type { ApprovedOvertimeHours } from '../overtimeRequestService.js';
import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import type { AttendanceRowLike } from './payrollAttendanceRecordService.js';
import type { PayrollWorkDayPolicy } from './payrollBasisDaysService.js';

export type PayrollEngineCache = PayrollEngineInputs & {
  monthPrefix: string;
  period: PayrollPeriodBounds & { cycle?: import('./payrollCalendarCycleTypes.js').ResolvedPayrollCycle };
  attPeriod: { status: AttendancePeriodStatus | string };
  prorationConfig: Awaited<ReturnType<typeof getProrationConfig>>;
  workDayPolicy: PayrollWorkDayPolicy;
  /** Filled by buildPayrollRunItemsForMonth after employee cohort is known. */
  approvedOvertimeByUserId?: Map<string, ApprovedOvertimeHours>;
  /** Keys `${userId}:${YYYY-MM-DD}` — batch-loaded once per preview/run. */
  approvedLeaveByDateMap?: Map<string, LeaveDayInfo>;
  unpaidLeaveDaysByUserId?: Map<string, number>;
  /** Attendance-module grid rows (same statuses as Attendance list) keyed by portal user id. */
  attendanceGridByUserId?: Map<string, AttendanceRowLike[]>;
  /** Active monthly seniority policies (0 = skip accrual engine). Loaded once per preview/run. */
  activeSeniorityRuleCount?: number;
  /** Dashboard estimate preview — skip attendance-driven absence/late deductions. */
  estimateMode?: boolean;
  /** Commission sales by employees.id for this payroll month. */
  salesAmountByEmployeeId?: Map<string, number>;
};

/** Month-scoped payroll inputs — load once per preview/run, not per employee. */
export async function buildPayrollEngineCache(
  monthStr: string,
  payrollGroupId = 'default'
): Promise<PayrollEngineCache> {
  const monthPrefix = monthStr.slice(0, 7);
  const { getPayrollWorkDayPolicy } = await import('./payrollBasisDaysService.js');
  const { countActiveSeniorityRules } = await import('./seniority/seniorityEngineService.js');
  const { loadMonthlySalesMapByEmployeeId } = await import('./employeeMonthlySalesService.js');
  const { ensureEmployeeMonthlySalesSchema } = await import('./employeeMonthlySalesSchema.js');
  await ensureEmployeeMonthlySalesSchema().catch((err) => {
    console.warn(
      '[payroll] employee_monthly_sales schema ensure skipped:',
      (err as Error)?.message || err
    );
  });
  const [
    engine,
    periodBundle,
    attPeriod,
    prorationConfig,
    workDayPolicy,
    activeSeniorityRuleCount,
    salesAmountByEmployeeId,
  ] = await Promise.all([
    loadPayrollEngineInputs(monthPrefix),
    resolvePayrollPeriod(monthPrefix, payrollGroupId),
    getAttendancePeriod(monthPrefix, payrollGroupId),
    getProrationConfig(),
    getPayrollWorkDayPolicy(monthPrefix),
    countActiveSeniorityRules(),
    loadMonthlySalesMapByEmployeeId(monthPrefix),
  ]);
  return {
    ...engine,
    monthPrefix,
    period: periodBundle,
    attPeriod,
    prorationConfig: {
      ...prorationConfig,
      workDayMethod: workDayPolicy.method,
      companyBasisDays: workDayPolicy.companyBasisDays,
    },
    workDayPolicy,
    activeSeniorityRuleCount,
    salesAmountByEmployeeId,
  };
}
