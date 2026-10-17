import { Op } from 'sequelize';
import { Employee, LeaveBalance, LeaveType } from './db.js';
import {
  computeCarryForwardAmount,
  computeLeaveRemaining,
  roundLeaveDays,
  type LeaveBalanceComponents,
} from './leaveBalanceCalc.js';
import {
  proratedYearEntitlementDays,
  normalizeJoinDateOnly,
  todayDateOnly,
} from './leaveAccrualRules.js';
import { loadAnnualLeaveAccrualConfig } from './annualLeaveAccrualConfig.js';
import {
  inferLeaveCategory,
  leaveCategorySupportsYearlyRenewal,
  type LeaveCategory,
} from './leaveTypeCategory.js';

export type YearEndRenewalResult = {
  closingYear: number;
  newYear: number;
  renewed: number;
  skipped: number;
  errors: string[];
};

function initialBalanceForCategory(
  category: LeaveCategory,
  typeRow: Record<string, unknown>
): Partial<LeaveBalanceComponents> {
  const daysAllowed = Number(typeRow.daysAllowed ?? 0);
  if (
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation'
  ) {
    return {
      openingBalance: 0,
      accrued: 0,
      entitlement: daysAllowed,
      used: 0,
      carriedOver: 0,
    };
  }
  return { openingBalance: 0, accrued: 0, entitlement: 0, used: 0, carriedOver: 0 };
}

export async function runYearEndRenewal(newYear?: number): Promise<YearEndRenewalResult> {
  const targetYear = newYear ?? new Date().getFullYear();
  const closingYear = targetYear - 1;
  const result: YearEndRenewalResult = {
    closingYear,
    newYear: targetYear,
    renewed: 0,
    skipped: 0,
    errors: [],
  };

  const types = await LeaveType.findAll({ where: { isActive: true } });
  const typeById = new Map<string, Record<string, unknown>>();
  const renewalTypeIds = new Set<string>();

  for (const row of types) {
    const t = (row.get ? row.get({ plain: true }) : row) as Record<string, unknown>;
    const id = String(t.id);
    typeById.set(id, t);
    const category = inferLeaveCategory(t);
    if (leaveCategorySupportsYearlyRenewal(category)) {
      renewalTypeIds.add(id);
    }
  }

  if (renewalTypeIds.size === 0) return result;

  const accrualConfig = await loadAnnualLeaveAccrualConfig();

  const closingBalances = await LeaveBalance.findAll({
    where: {
      year: closingYear,
      leaveTypeId: { [Op.in]: [...renewalTypeIds] },
    },
  });

  const employeeIds = [
    ...new Set(closingBalances.map((row) => String((row as { employeeId: string }).employeeId))),
  ];
  const joinDateByEmployeeId = new Map<string, string | null>();
  if (employeeIds.length > 0) {
    const employees = await Employee.findAll({
      where: { id: { [Op.in]: employeeIds } },
      attributes: ['id', 'join_date'],
    });
    for (const emp of employees) {
      const plain = emp.get ? emp.get({ plain: true }) : emp;
      joinDateByEmployeeId.set(
        String(plain.id),
        normalizeJoinDateOnly(plain.join_date)
      );
    }
  }

  for (const balanceRow of closingBalances) {
    const b = (balanceRow.get ? balanceRow.get({ plain: true }) : balanceRow) as Record<
      string,
      unknown
    >;
    const leaveTypeId = String(b.leaveTypeId);
    const employeeId = String(b.employeeId);
    const typeRow = typeById.get(leaveTypeId);
    if (!typeRow) {
      result.skipped += 1;
      continue;
    }

    const category = inferLeaveCategory(typeRow);
    if (!leaveCategorySupportsYearlyRenewal(category)) {
      result.skipped += 1;
      continue;
    }

    try {
      const components: LeaveBalanceComponents = {
        openingBalance: Number(b.openingBalance ?? 0),
        accrued: Number(b.accrued ?? 0),
        entitlement: Number(b.entitlement ?? typeRow.daysAllowed ?? 0),
        carriedOver: Number(b.carriedOver ?? 0),
        used: Number(b.used ?? 0),
      };

      const remaining = computeLeaveRemaining(components, category);
      const allowCarryForward =
        Boolean(typeRow.allowCarryForward) ||
        Number(typeRow.maxCarryForward ?? typeRow.carryoverLimit ?? 0) > 0;
      const maxCarry = Number(typeRow.maxCarryForward ?? typeRow.carryoverLimit ?? 0);
      const carry = computeCarryForwardAmount(remaining, maxCarry, allowCarryForward);

      const existingNext: any = await LeaveBalance.findOne({
        where: { employeeId, leaveTypeId, year: targetYear },
      });

      const initial = initialBalanceForCategory(category, typeRow);
      if (category === 'accrual_based' || category === 'join_date_based') {
        const joinDate = joinDateByEmployeeId.get(employeeId) ?? null;
        const typeRate = Number(typeRow.monthlyAccrualRate ?? typeRow.accrualRate ?? 0);
        initial.entitlement = proratedYearEntitlementDays(
          joinDate,
          targetYear,
          Number(typeRow.daysAllowed ?? 0),
          {
            asOfDate: todayDateOnly(),
            monthlyRate: typeRate > 0 ? typeRate : accrualConfig.monthlyRate,
            joinDateTiers: accrualConfig.joinDateTiers,
          }
        );
      }
      const nextPayload = {
        ...initial,
        carriedOver: carry,
        lastAccrualMonth: null,
        updatedAt: new Date(),
      };

      if (existingNext) {
        await existingNext.update(nextPayload);
      } else {
        await LeaveBalance.create({
          id: `lb-${employeeId}-${leaveTypeId}-${targetYear}`,
          employeeId,
          leaveTypeId,
          year: targetYear,
          ...nextPayload,
        });
      }

      if (category === 'accrual_based' || category === 'join_date_based') {
        await balanceRow.update({
          used: roundLeaveDays(components.used),
          updatedAt: new Date(),
        });
      }

      result.renewed += 1;
    } catch (e) {
      result.errors.push(
        `Employee ${employeeId} type ${leaveTypeId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Employees with no prior-year balance still need current-year defaults.
  try {
    const { ensureDefaultLeaveBalancesForActiveEmployees } = await import('./leaveBalanceService.js');
    await ensureDefaultLeaveBalancesForActiveEmployees(targetYear);
  } catch (e) {
    result.errors.push(
      `Default leave heal after year-end: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return result;
}

/**
 * Ensure current-year balance rows exist using gender-based defaults
 * (maternity only for female). Then recalculate join-date / accrual ledgers.
 */
export async function ensureCurrentYearBalancesForEmployee(
  employeeId: string,
  year: number = new Date().getFullYear()
): Promise<void> {
  const employee: any = await Employee.findByPk(employeeId, {
    attributes: ['id', 'join_date', 'gender', 'status'],
  });
  if (!employee) return;

  const status = String(employee.status ?? '').toLowerCase();
  if (status === 'draft' || status === 'profile_incomplete') return;

  const gender = employee.gender != null ? String(employee.gender) : null;
  const {
    applyDefaultLeaveAssignmentsToEmployee,
    employeeNeedsDefaultLeaveBalances,
  } = await import('./leaveBalanceService.js');

  if (await employeeNeedsDefaultLeaveBalances(employeeId, gender, year)) {
    await applyDefaultLeaveAssignmentsToEmployee(employeeId, gender, year);
  }

  const { recalculateEmployeeAccrualBalances } = await import('./leaveAccrualService.js');
  await recalculateEmployeeAccrualBalances(
    employeeId,
    `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );
}

/** Provision balances for every active employee at year start (fixed allocation yearly grant). */
export async function provisionYearlyFixedAllocations(
  year: number = new Date().getFullYear()
): Promise<{ updated: number }> {
  let updated = 0;
  const employees = await Employee.findAll({ attributes: ['id'] });
  const types = await LeaveType.findAll({ where: { isActive: true } });

  for (const emp of employees) {
    const employeeId = String(emp.get ? emp.get('id') : (emp as { id: string }).id);
    for (const row of types) {
      const t = row.get ? row.get({ plain: true }) : row;
      if (inferLeaveCategory(t) !== 'fixed_allocation') continue;

      const leaveTypeId = String(t.id);
      const balance: any = await LeaveBalance.findOne({
        where: { employeeId, leaveTypeId, year },
      });
      if (!balance) continue;

      const days = Number(t.daysAllowed ?? 0);
      if (Number(balance.entitlement) !== days) {
        await balance.update({ entitlement: days, updatedAt: new Date() });
        updated += 1;
      }
    }
  }
  return { updated };
}
