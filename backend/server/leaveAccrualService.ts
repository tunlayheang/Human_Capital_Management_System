import { Op } from 'sequelize';
import { Employee, LeaveBalance, LeaveType } from './db.js';
import { roundLeaveDays, roundLeaveDaysToHalf } from './leaveBalanceCalc.js';
import {
  loadAnnualLeaveAccrualConfig,
  resolveTierLabel,
  type AnnualLeaveAccrualConfig,
} from './annualLeaveAccrualConfig.js';
import { isEmployeeEligibleForAccrualMonth } from './leaveAccrualEligibility.js';
import {
  accrualAmountForMonth,
  currentAccrualMonth,
  isAccrualMonthOnOrAfterJoin,
  listEligibleAccrualMonths,
  normalizeJoinDateOnly,
  proratedYearEntitlementDays,
  resolveAppliedTierForMonth,
  todayDateOnly,
} from './leaveAccrualRules.js';
import {
  inferLeaveCategory,
  leaveCategorySupportsMonthlyAccrual,
} from './leaveTypeCategory.js';
import {
  deleteAccrualLedgerForMonth,
  findAccrualLedgerForMonth,
  insertLeaveLedgerEntry,
  leaveAccrualLedgerId,
  sumAccruedFromLedger,
  syncLeaveBalanceFromLedger,
} from './leaveLedgerService.js';

export type MonthlyAccrualResult = {
  month: string;
  year: number;
  processed: number;
  skipped: number;
  errors: string[];
};

type AccrualTypeMeta = {
  leaveTypeId: string;
  rate: number;
  fullYearDays: number;
};

type EmployeeAccrualContext = {
  id: string;
  joinDate: string | null;
  status: string | null;
  probation_period_months: number | null;
  probation_confirmed_at: string | Date | null;
  worker_type: string | null;
  terminated_at: string | Date | null;
  last_working_date: string | Date | null;
  last_valid_working_date: string | Date | null;
};

async function loadAccrualTypes(): Promise<Map<string, AccrualTypeMeta>> {
  const types = await LeaveType.findAll({ where: { isActive: true } });
  const map = new Map<string, AccrualTypeMeta>();
  for (const row of types) {
    const t = row.get ? row.get({ plain: true }) : row;
    const category = inferLeaveCategory(t);
    if (!leaveCategorySupportsMonthlyAccrual(category)) continue;
    const configured = Number(t.monthlyAccrualRate ?? t.accrualRate ?? 0);
    // Keep the type even when rate is unset — postAccrual falls back to system config.
    const rate = Number.isFinite(configured) && configured > 0 ? configured : 0;
    map.set(String(t.id), {
      leaveTypeId: String(t.id),
      rate,
      fullYearDays: Number(t.daysAllowed ?? 0),
    });
  }
  return map;
}

async function loadEmployeeContexts(employeeIds: string[]): Promise<Map<string, EmployeeAccrualContext>> {
  if (!employeeIds.length) return new Map();
  const rows = await Employee.findAll({
    where: { id: { [Op.in]: employeeIds } },
    attributes: [
      'id',
      'join_date',
      'status',
      'probation_period_months',
      'probation_confirmed_at',
      'worker_type',
      'terminated_at',
      'last_working_date',
      'last_valid_working_date',
    ],
  });
  const map = new Map<string, EmployeeAccrualContext>();
  for (const row of rows) {
    const plain = row.get ? row.get({ plain: true }) : row;
    map.set(String(plain.id), {
      id: String(plain.id),
      joinDate: normalizeJoinDateOnly(plain.join_date),
      status: plain.status ?? null,
      probation_period_months: plain.probation_period_months ?? null,
      probation_confirmed_at: plain.probation_confirmed_at ?? null,
      worker_type: plain.worker_type ?? null,
      terminated_at: plain.terminated_at ?? null,
      last_working_date: plain.last_working_date ?? null,
      last_valid_working_date: plain.last_valid_working_date ?? null,
    });
  }
  return map;
}

async function postAccrualLedgerEntry(params: {
  employee: EmployeeAccrualContext;
  leaveTypeId: string;
  accrualMonth: string;
  config: AnnualLeaveAccrualConfig;
  typeMeta: AccrualTypeMeta;
  generatedBy: string;
}): Promise<'created' | 'skipped' | 'zero'> {
  const { employee, leaveTypeId, accrualMonth, config, typeMeta, generatedBy } = params;
  const year = Number.parseInt(accrualMonth.slice(0, 4), 10);

  const asOf = todayDateOnly();
  const eligibility = isEmployeeEligibleForAccrualMonth(employee, accrualMonth, {
    blockAccrualDuringProbation: config.blockAccrualDuringProbation,
    asOfDate: asOf,
  });
  if (!eligibility.eligible) return 'skipped';

  if (!isAccrualMonthOnOrAfterJoin(employee.joinDate, accrualMonth)) return 'skipped';

  const exists = await findAccrualLedgerForMonth(employee.id, leaveTypeId, accrualMonth);
  if (exists) return 'skipped';

  // Leave-type monthly rate wins when set; otherwise AnnualLeaveAccrual system setting.
  const monthlyRate =
    typeMeta.rate > 0
      ? typeMeta.rate
      : config.monthlyRate > 0
        ? config.monthlyRate
        : 1.5;
  let days = accrualAmountForMonth(
    employee.joinDate,
    accrualMonth,
    monthlyRate,
    config.joinDateTiers
  );
  if (days <= 0) return 'zero';

  const cap = proratedYearEntitlementDays(employee.joinDate, year, typeMeta.fullYearDays, {
    asOfDate: asOf,
    monthlyRate,
    joinDateTiers: config.joinDateTiers,
  });
  if (cap > 0) {
    const currentAccrued = await sumAccruedFromLedger(employee.id, leaveTypeId, year);
    days = roundLeaveDaysToHalf(
      Math.min(days, Math.max(0, roundLeaveDays(cap - currentAccrued)))
    );
  }
  if (days <= 0) return 'zero';

  const joinParts = employee.joinDate ? employee.joinDate.slice(0, 10) : null;
  const joinDay = joinParts ? Number.parseInt(joinParts.slice(8, 10), 10) : null;
  const appliedTier = resolveAppliedTierForMonth(
    employee.joinDate,
    accrualMonth,
    config.joinDateTiers
  );

  const { created } = await insertLeaveLedgerEntry({
    id: leaveAccrualLedgerId(employee.id, leaveTypeId, accrualMonth),
    employeeId: employee.id,
    leaveTypeId,
    calendarYear: year,
    accrualMonth,
    transactionType: 'accrual',
    days,
    joinDate: joinParts,
    joinDay,
    appliedTier,
    generatedBy,
    auditJson: {
      joinDate: joinParts,
      joinDay,
      appliedTier,
      tierLabel:
        appliedTier !== 'standard' && joinDay != null
          ? resolveTierLabel(joinDay, config.joinDateTiers)
          : appliedTier,
      monthlyRate,
      accrualMonth,
      generatedAt: new Date().toISOString(),
    },
  });

  if (created) {
    await syncLeaveBalanceFromLedger(employee.id, leaveTypeId, year);
    return 'created';
  }
  return 'skipped';
}

/** Backfill missing ledger accrual entries through `throughMonth` (never overwrites existing). */
export async function recalculateEmployeeAccrualBalances(
  employeeId: string,
  throughMonth?: string
): Promise<{ updated: number; created: number; skipped: number }> {
  const month = throughMonth ?? currentAccrualMonth();
  const year = Number.parseInt(month.slice(0, 4), 10);
  let updated = 0;
  let created = 0;
  let skipped = 0;

  const employeeRow: any = await Employee.findByPk(employeeId, {
    attributes: [
      'id',
      'join_date',
      'status',
      'probation_period_months',
      'probation_confirmed_at',
      'worker_type',
      'terminated_at',
      'last_working_date',
      'last_valid_working_date',
    ],
  });
  if (!employeeRow) return { updated: 0, created: 0, skipped: 0 };

  const employee: EmployeeAccrualContext = {
    id: String(employeeRow.id),
    joinDate: normalizeJoinDateOnly(employeeRow.join_date),
    status: employeeRow.status ?? null,
    probation_period_months: employeeRow.probation_period_months ?? null,
    probation_confirmed_at: employeeRow.probation_confirmed_at ?? null,
    worker_type: employeeRow.worker_type ?? null,
    terminated_at: employeeRow.terminated_at ?? null,
    last_working_date: employeeRow.last_working_date ?? null,
    last_valid_working_date: employeeRow.last_valid_working_date ?? null,
  };

  const config = await loadAnnualLeaveAccrualConfig();
  const accrualTypes = await loadAccrualTypes();
  const asOf = todayDateOnly();

  for (const [, typeMeta] of accrualTypes) {
    const balance: any = await LeaveBalance.findOne({
      where: { employeeId, leaveTypeId: typeMeta.leaveTypeId, year },
    });
    if (!balance) continue;

    const rate =
      typeMeta.rate > 0
        ? typeMeta.rate
        : config.monthlyRate > 0
          ? config.monthlyRate
          : 1.5;
    const entitlement = proratedYearEntitlementDays(employee.joinDate, year, typeMeta.fullYearDays, {
      asOfDate: asOf,
      monthlyRate: rate,
      joinDateTiers: config.joinDateTiers,
    });
    await balance.update({ entitlement, updatedAt: new Date() });

    const eligibleMonths = listEligibleAccrualMonths(employee.joinDate, year, month);
    for (const accrualMonth of eligibleMonths) {
      const eligibility = isEmployeeEligibleForAccrualMonth(employee, accrualMonth, {
        blockAccrualDuringProbation: config.blockAccrualDuringProbation,
        asOfDate: asOf,
      });
      if (!eligibility.eligible) {
        // Undo premature join-month accrual posted before the join day.
        if (eligibility.reason === 'not_yet_joined') {
          const removed = await deleteAccrualLedgerForMonth(
            employeeId,
            typeMeta.leaveTypeId,
            accrualMonth
          );
          if (removed) skipped += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const result = await postAccrualLedgerEntry({
        employee,
        leaveTypeId: typeMeta.leaveTypeId,
        accrualMonth,
        config,
        typeMeta,
        generatedBy: 'recalculate_accrual',
      });
      if (result === 'created') created += 1;
      else if (result === 'skipped' || result === 'zero') skipped += 1;
    }

    await syncLeaveBalanceFromLedger(employeeId, typeMeta.leaveTypeId, year);
    updated += 1;
  }

  return { updated, created, skipped };
}

/** Month-end accrual job — posts immutable ledger entries (idempotent per employee/type/month). */
export async function runMonthlyAccrual(forMonth?: string): Promise<MonthlyAccrualResult> {
  const month = forMonth ?? currentAccrualMonth();
  const year = Number.parseInt(month.slice(0, 4), 10);
  const result: MonthlyAccrualResult = {
    month,
    year,
    processed: 0,
    skipped: 0,
    errors: [],
  };

  const config = await loadAnnualLeaveAccrualConfig();
  const accrualTypes = await loadAccrualTypes();
  if (accrualTypes.size === 0) return result;

  const balances = await LeaveBalance.findAll({
    where: {
      year,
      leaveTypeId: { [Op.in]: [...accrualTypes.keys()] },
    },
  });

  const employeeIds = [...new Set(balances.map((b) => String((b as any).employeeId)))];
  const employees = await loadEmployeeContexts(employeeIds);

  for (const balanceRow of balances) {
    const b: any = balanceRow.get ? balanceRow.get({ plain: true }) : balanceRow;
    const leaveTypeId = String(b.leaveTypeId);
    const employeeId = String(b.employeeId);
    const typeMeta = accrualTypes.get(leaveTypeId);
    const employee = employees.get(employeeId);
    if (!typeMeta || !employee) {
      result.skipped += 1;
      continue;
    }

    try {
      const postResult = await postAccrualLedgerEntry({
        employee,
        leaveTypeId,
        accrualMonth: month,
        config,
        typeMeta,
        generatedBy: 'month_end_accrual',
      });
      if (postResult === 'created') result.processed += 1;
      else result.skipped += 1;
    } catch (e) {
      result.errors.push(
        `Balance ${b.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return result;
}
