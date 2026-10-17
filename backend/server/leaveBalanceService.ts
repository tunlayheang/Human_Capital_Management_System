import {

  LeaveBalance,

  LeaveRequest,

  LeaveType,

  Employee,

  EmployeeLeaveTypeAssignment,

} from './db.js';
import { Op } from 'sequelize';

import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';

import { leaveDurationDays } from './leaveDuration.js';

import { computeLeaveRemaining, roundLeaveDays } from './leaveBalanceCalc.js';
import {
  proratedYearEntitlementDays,
  normalizeJoinDateOnly,
  isJoinCalendarYear,
  todayDateOnly,
} from './leaveAccrualRules.js';
import { loadAnnualLeaveAccrualConfig } from './annualLeaveAccrualConfig.js';
import { recalculateEmployeeAccrualBalances } from './leaveAccrualService.js';
import {
  insertLeaveLedgerEntry,
  leaveUsageLedgerId,
  syncLeaveBalanceFromLedger,
} from './leaveLedgerService.js';

import {

  inferLeaveCategory,

  leaveCategorySupportsMonthlyAccrual,

  leaveCategoryTracksBalance,

  type LeaveCategory,

} from './leaveTypeCategory.js';



const COUNTED_LEAVE_STATUSES = ['APPROVED', 'APPLIED'];



export type LeaveBalanceRow = {

  leaveTypeId: string;

  leaveTypeName: string;

  leaveTypeNameKh?: string | null;

  code: string;

  isPaid: boolean;

  year: number;

  entitlement: number;

  openingBalance?: number;

  accrued?: number;

  used: number;

  carriedOver: number;

  remaining: number;

  leaveCategory?: LeaveCategory;

  /** Full-year policy maximum (e.g. 18). */
  fullYearEntitlement?: number;

  /** True when `entitlement` is prorated for the employee's join year. */
  proratedJoinYear?: boolean;

};



export type LeaveAssignmentOption = {

  leaveTypeId: string;

  name: string;

  code: string;

  isPaid: boolean;

  daysAllowed: number;

  assigned: boolean;

  leaveCategory?: LeaveCategory;

};



function requestOverlapsYear(startDate: string, endDate: string, year: number): boolean {

  const y = String(year);

  return (

    String(startDate).slice(0, 4) === y ||

    String(endDate).slice(0, 4) === y ||

    (String(startDate).slice(0, 4) < y && String(endDate).slice(0, 4) > y)

  );

}



function leaveTypeMatchesRequest(requestType: string, typeName: string, typeCode: string): boolean {

  const a = String(requestType ?? '').trim().toLowerCase();

  const b = String(typeName ?? '').trim().toLowerCase();

  const c = String(typeCode ?? '').trim().toLowerCase();

  if (!a || !b) return false;

  if (a === b || a === c) return true;

  if (b.includes(a) || a.includes(b)) return true;

  const aWord = a.split(/\s+/)[0];

  const bWord = b.split(/\s+/)[0];

  return aWord === bWord;

}



async function usedDaysFromRequests(

  userId: string,

  typeName: string,

  typeCode: string,

  year: number

): Promise<number> {

  const requests = await LeaveRequest.findAll({ where: { userId } });

  let used = 0;

  for (const row of requests) {

    const r = row.get ? row.get({ plain: true }) : row;

    const status = String(r.status ?? '').toUpperCase();

    if (!COUNTED_LEAVE_STATUSES.includes(status)) continue;

    if (!requestOverlapsYear(r.startDate, r.endDate, year)) continue;

    if (!leaveTypeMatchesRequest(r.type, typeName, typeCode)) continue;

    used += leaveDurationDays({

      startDate: r.startDate,

      endDate: r.endDate,

      isHalfDay: Boolean(r.isHalfDay),

      halfDayPeriod: r.halfDayPeriod,

    });

  }

  return roundLeaveDays(used);

}



/** Persist approved/applied usage onto the balance row (category-aware). */

export async function syncBalanceUsedFromRequests(

  employeeId: string,

  leaveTypeId: string,

  year: number,

  userId: string

): Promise<void> {

  const balance: any = await LeaveBalance.findOne({

    where: { employeeId, leaveTypeId, year },

  });

  if (!balance) return;



  const typeRow = await LeaveType.findByPk(leaveTypeId);

  if (!typeRow) return;

  const t = typeRow.get ? typeRow.get({ plain: true }) : typeRow;

  const category = inferLeaveCategory(t);

  if (!leaveCategoryTracksBalance(category)) return;



  const requests = await LeaveRequest.findAll({ where: { userId } });
  for (const row of requests) {
    const r = row.get ? row.get({ plain: true }) : row;
    const status = String(r.status ?? '').toUpperCase();
    if (!COUNTED_LEAVE_STATUSES.includes(status)) continue;
    if (!requestOverlapsYear(r.startDate, r.endDate, year)) continue;
    if (!leaveTypeMatchesRequest(r.type, String(t.name ?? ''), String(t.code ?? ''))) continue;

    const requestDays = leaveDurationDays({
      startDate: r.startDate,
      endDate: r.endDate,
      isHalfDay: Boolean(r.isHalfDay),
      halfDayPeriod: r.halfDayPeriod,
    });
    if (requestDays <= 0) continue;

    await insertLeaveLedgerEntry({
      id: leaveUsageLedgerId(String(r.id)),
      employeeId,
      leaveTypeId,
      calendarYear: year,
      accrualMonth: null,
      transactionType: 'usage',
      days: -roundLeaveDays(requestDays),
      sourceRef: `leave_request:${r.id}`,
      generatedBy: 'leave_usage_sync',
      auditJson: {
        leaveRequestId: String(r.id),
        startDate: r.startDate,
        endDate: r.endDate,
        days: requestDays,
      },
    });
  }

  await syncLeaveBalanceFromLedger(employeeId, leaveTypeId, year);

}



async function isAssignmentEnabled(

  employeeId: string,

  leaveTypeId: string,

  year: number

): Promise<boolean> {

  const balance = await LeaveBalance.findOne({

    where: { employeeId, leaveTypeId, year },

  });

  if (balance) return true;



  const assignment = await EmployeeLeaveTypeAssignment.findOne({

    where: { employeeId, leaveTypeId, year, enabled: true },

  });

  return Boolean(assignment);

}



/** All active leave types with yes/no assignment for an employee (internal employees.id). */

export async function getLeaveAssignmentOptions(

  employeeId: string,

  year: number = new Date().getFullYear()

): Promise<LeaveAssignmentOption[]> {

  const types = await LeaveType.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });

  const balanceRows = await LeaveBalance.findAll({ where: { employeeId, year } });

  const assignmentRows = await EmployeeLeaveTypeAssignment.findAll({

    where: { employeeId, year, enabled: true },

  });



  const assignedIds = new Set<string>();

  balanceRows.forEach((row) =>

    assignedIds.add(String((row.get ? row.get({ plain: true }) : row).leaveTypeId))

  );

  assignmentRows.forEach((row) =>

    assignedIds.add(String((row.get ? row.get({ plain: true }) : row).leaveTypeId))

  );



  return types.map((typeRow) => {

    const t = typeRow.get ? typeRow.get({ plain: true }) : typeRow;

    const category = inferLeaveCategory(t);

    return {

      leaveTypeId: String(t.id),

      name: String(t.name ?? '').trim(),

      code: String(t.code ?? '').trim(),

      isPaid: Boolean(t.isPaid ?? true),

      daysAllowed: Number(t.daysAllowed ?? 0),

      assigned: assignedIds.has(String(t.id)),

      leaveCategory: category,

    };

  });

}



export function assignmentsToMap(options: LeaveAssignmentOption[]): Record<string, boolean> {

  return Object.fromEntries(options.map((o) => [o.leaveTypeId, o.assigned]));

}



export function isFemaleGender(gender: string | null | undefined): boolean {

  const g = String(gender ?? '').trim().toLowerCase();

  return g === 'female' || g === 'f';

}



export function isMaternityLeaveType(type: {

  name?: string | null;

  code?: string | null;

  id?: string | null;

}): boolean {

  const name = String(type.name ?? '').toLowerCase();

  const code = String(type.code ?? '').toLowerCase();

  const id = String(type.id ?? '').toLowerCase();

  return name.includes('maternity') || code.includes('maternity') || id.includes('maternity');

}



/** Default toggles: all active types on; Maternity only when gender is Female. */

export async function buildDefaultLeaveAssignments(

  gender: string | null | undefined

): Promise<Record<string, boolean>> {

  const types = await LeaveType.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });

  const assignments: Record<string, boolean> = {};

  for (const row of types) {

    const t = row.get ? row.get({ plain: true }) : row;

    const leaveTypeId = String(t.id);

    assignments[leaveTypeId] = isMaternityLeaveType(t)

      ? isFemaleGender(gender)

      : true;

  }

  return assignments;

}



export async function applyDefaultLeaveAssignmentsToEmployee(

  employeeId: string,

  gender: string | null | undefined,

  year: number = new Date().getFullYear()

): Promise<Record<string, boolean>> {

  const assignments = await buildDefaultLeaveAssignments(gender);

  await syncLeaveAssignments(employeeId, assignments, year);

  return assignments;

}



/** True when any leave preference or balance row exists for this employee/year. */

export async function hasStoredLeaveAssignmentSelection(

  employeeId: string,

  year: number = new Date().getFullYear()

): Promise<boolean> {

  if (!employeeId) return false;

  const balanceCount = await LeaveBalance.count({ where: { employeeId, year } });

  if (balanceCount > 0) return true;

  const assignmentCount = await EmployeeLeaveTypeAssignment.count({

    where: { employeeId, year },

  });

  return assignmentCount > 0;

}



/**

 * Persist leave-type toggles for draft employees without creating LeaveBalance rows.

 * Uses assignment markers (including enabled=false) so reopen keeps the same selections.

 */

export async function syncDraftLeaveAssignmentPreferences(

  employeeId: string,

  assignments: Record<string, boolean>,

  year: number = new Date().getFullYear()

): Promise<void> {

  if (!employeeId || !assignments || typeof assignments !== 'object') return;



  const types = await LeaveType.findAll({ where: { isActive: true } });

  for (const row of types) {

    const t = row.get ? row.get({ plain: true }) : row;

    const leaveTypeId = String(t.id);

    const enabled = Object.prototype.hasOwnProperty.call(assignments, leaveTypeId)

      ? Boolean(assignments[leaveTypeId])

      : false;



    const id = `ela-${employeeId}-${leaveTypeId}-${year}`;

    const existing: any = await EmployeeLeaveTypeAssignment.findOne({

      where: { employeeId, leaveTypeId, year },

    });

    if (existing) {

      await existing.update({ enabled, updatedAt: new Date() });

    } else {

      await EmployeeLeaveTypeAssignment.create({

        id,

        employeeId,

        leaveTypeId,

        year,

        enabled,

      });

    }



    // Drafts must not accrue / hold balances until the profile is activated.

    const existingBalance: any = await LeaveBalance.findOne({

      where: { employeeId, leaveTypeId, year },

    });

    if (existingBalance) await existingBalance.destroy();

  }

}



/**

 * Map of leave-type toggles for API responses.

 * Drafts with no stored preferences get gender-aware defaults (same as first-time create UI).

 */

export async function resolveLeaveAssignmentsMap(

  employeeId: string,

  gender: string | null | undefined,

  status?: string | null,

  year: number = new Date().getFullYear()

): Promise<Record<string, boolean>> {

  const lifecycle = String(status ?? '')

    .trim()

    .toLowerCase();

  const isDraft =

    lifecycle === 'draft' || lifecycle === 'profile_incomplete' || lifecycle === '';



  if (isDraft && !(await hasStoredLeaveAssignmentSelection(employeeId, year))) {

    return buildDefaultLeaveAssignments(gender);

  }



  const options = await getLeaveAssignmentOptions(employeeId, year);

  return assignmentsToMap(options);

}



async function upsertNonBalanceAssignment(

  employeeId: string,

  leaveTypeId: string,

  year: number,

  enabled: boolean

): Promise<void> {

  const id = `ela-${employeeId}-${leaveTypeId}-${year}`;

  const existing: any = await EmployeeLeaveTypeAssignment.findOne({

    where: { employeeId, leaveTypeId, year },

  });

  if (enabled) {

    if (existing) {

      await existing.update({ enabled: true, updatedAt: new Date() });

    } else {

      await EmployeeLeaveTypeAssignment.create({

        id,

        employeeId,

        leaveTypeId,

        year,

        enabled: true,

      });

    }

  } else if (existing) {

    await existing.destroy();

  }

}



/** Sync assignments: balance rows only for accrual/fixed; marker rows for event/approval. */

export async function syncLeaveAssignments(

  employeeId: string,

  assignments: Record<string, boolean>,

  year: number = new Date().getFullYear()

): Promise<void> {

  if (!employeeId || !assignments || typeof assignments !== 'object') return;

  const employee: any = await Employee.findByPk(employeeId, { attributes: ['id', 'join_date'] });
  const joinDate = normalizeJoinDateOnly(employee?.join_date);
  const accrualConfig = await loadAnnualLeaveAccrualConfig();

  const types = await LeaveType.findAll({ where: { isActive: true } });

  const typeById = new Map(

    types.map((row) => {

      const t = row.get ? row.get({ plain: true }) : row;

      return [String(t.id), t];

    })

  );



  for (const [leaveTypeId, enabled] of Object.entries(assignments)) {

    const type = typeById.get(leaveTypeId);

    if (!type) continue;



    const category = inferLeaveCategory(type);

    const tracksBalance = leaveCategoryTracksBalance(category);



    const existingBalance: any = await LeaveBalance.findOne({

      where: { employeeId, leaveTypeId, year },

    });

    const existingAssignment: any = await EmployeeLeaveTypeAssignment.findOne({

      where: { employeeId, leaveTypeId, year },

    });



    if (enabled) {

      if (tracksBalance) {

        const daysAllowed = Number(type.daysAllowed ?? 0);

        const openingBalance = 0;

        const accrued = 0;

        const typeRate = Number(type.monthlyAccrualRate ?? type.accrualRate ?? 0);
        const entitlement =

          category === 'fixed_allocation'

            ? daysAllowed

            : proratedYearEntitlementDays(joinDate, year, daysAllowed, {
                asOfDate: todayDateOnly(),
                monthlyRate: typeRate > 0 ? typeRate : accrualConfig.monthlyRate,
                joinDateTiers: accrualConfig.joinDateTiers,
              });

        if (existingBalance) {

          await existingBalance.update({

            entitlement,

            updatedAt: new Date(),

          });

        } else {

          await LeaveBalance.create({

            id: `lb-${employeeId}-${leaveTypeId}-${year}`,

            employeeId,

            leaveTypeId,

            year,

            openingBalance,

            accrued,

            entitlement,

            used: 0,

            carriedOver: 0,

          });

        }

        if (leaveCategorySupportsMonthlyAccrual(category)) {

          await recalculateEmployeeAccrualBalances(employeeId);

        }

        if (existingAssignment) await existingAssignment.destroy();

      } else {

        await upsertNonBalanceAssignment(employeeId, leaveTypeId, year, true);

        if (existingBalance) await existingBalance.destroy();

      }

    } else {

      if (existingBalance) await existingBalance.destroy();

      if (existingAssignment) await existingAssignment.destroy();

    }

  }

}



/** Per leave-type balances for portal user — balance-tracked types only. */

export async function getLeaveBalancesForUser(

  userId: string,

  year: number = new Date().getFullYear()

): Promise<LeaveBalanceRow[]> {

  const employee = await findEmployeeByUserId(userId);

  const empId = employee ? (employee.get ? employee.get('id') : employee.id) : null;

  if (!empId) return [];

  const joinDate = employee
    ? normalizeJoinDateOnly(
        employee.get ? employee.get('join_date') : (employee as { join_date?: unknown }).join_date
      )
    : null;
  const gender = employee
    ? ((employee.get ? employee.get('gender') : (employee as { gender?: unknown }).gender) as
        | string
        | null
        | undefined)
    : null;
  const status = String(
    employee.get ? employee.get('status') : (employee as { status?: unknown }).status ?? ''
  ).toLowerCase();

  let balanceRows = await LeaveBalance.findAll({ where: { employeeId: empId, year } });

  // Heal missing assignments for active employees (draft→active gaps, missed bootstrap).
  const blockedStatuses = new Set([
    'draft',
    'profile_incomplete',
    'terminated',
    'resigned',
    'abandoned',
  ]);
  if (!balanceRows.length && !blockedStatuses.has(status)) {
    try {
      if (await employeeNeedsDefaultLeaveBalances(String(empId), gender, year)) {
        await applyDefaultLeaveAssignmentsToEmployee(String(empId), gender, year);
      }
    } catch (healErr) {
      console.warn(
        '[leave] Auto-assign defaults on balance read failed:',
        healErr instanceof Error ? healErr.message : healErr
      );
    }
    balanceRows = await LeaveBalance.findAll({ where: { employeeId: empId, year } });
  }

  try {
    await recalculateEmployeeAccrualBalances(String(empId));
  } catch (accrualErr) {
    console.warn(
      '[leave] Accrual refresh on balance read failed:',
      accrualErr instanceof Error ? accrualErr.message : accrualErr
    );
  }

  balanceRows = await LeaveBalance.findAll({ where: { employeeId: empId, year } });

  if (!balanceRows.length) return [];



  const types = await LeaveType.findAll({ where: { isActive: true } });

  const typeById = new Map(

    types.map((row) => {

      const t = row.get ? row.get({ plain: true }) : row;

      return [String(t.id), t];

    })

  );



  const result: LeaveBalanceRow[] = [];
  const asOf = todayDateOnly();
  const notYetJoined = Boolean(joinDate && joinDate > asOf);
  const accrualConfig = await loadAnnualLeaveAccrualConfig();

  for (const balanceRow of balanceRows) {

    const b = balanceRow.get ? balanceRow.get({ plain: true }) : balanceRow;

    const leaveTypeId = String(b.leaveTypeId);

    const type = typeById.get(leaveTypeId);

    if (!type) continue;



    const category = inferLeaveCategory(type);

    if (!leaveCategoryTracksBalance(category)) continue;



    const leaveTypeName = String(type.name ?? '').trim();
    const leaveTypeNameKh = String(type.nameKh ?? '').trim() || null;
    const code = String(type.code ?? '').trim();
    const isPaid = Boolean(type.isPaid ?? true);



    await syncBalanceUsedFromRequests(empId, leaveTypeId, year, userId);

    const refreshed: any = await LeaveBalance.findByPk(b.id);

    const rb = refreshed.get ? refreshed.get({ plain: true }) : refreshed;



    const openingBalance = Number(rb.openingBalance ?? 0);

    const accrued = Number(rb.accrued ?? 0);

    const entitlement = Number(rb.entitlement ?? type.daysAllowed ?? 0);

    const carriedOver = Number(rb.carriedOver ?? 0);

    let used = Number(rb.used ?? 0);

    if (!Number.isFinite(used) || used < 0) used = 0;



    const fullYearEntitlement = Number(type.daysAllowed ?? 0);
    const usesJoinProration = leaveCategorySupportsMonthlyAccrual(category);
    const typeRate = Number(type.monthlyAccrualRate ?? type.accrualRate ?? 0);
    // No leave balance before employment starts (any category).
    const yearCap = notYetJoined
      ? 0
      : usesJoinProration
        ? proratedYearEntitlementDays(joinDate, year, fullYearEntitlement, {
            asOfDate: asOf,
            monthlyRate: typeRate > 0 ? typeRate : accrualConfig.monthlyRate,
            joinDateTiers: accrualConfig.joinDateTiers,
          })
        : entitlement;
    const displayAccrued = notYetJoined ? 0 : accrued;
    const displayCarriedOver = notYetJoined ? 0 : carriedOver;
    const proratedJoinYear =
      usesJoinProration && !notYetJoined && isJoinCalendarYear(joinDate, year);

    const remaining = computeLeaveRemaining(
      {
        openingBalance: notYetJoined ? 0 : openingBalance,
        accrued: displayAccrued,
        entitlement: yearCap,
        carriedOver: displayCarriedOver,
        used,
      },
      category
    );

    result.push({

      leaveTypeId,

      leaveTypeName,

      leaveTypeNameKh,

      code,

      isPaid,

      year,

      entitlement: yearCap,

      openingBalance: notYetJoined ? 0 : openingBalance,

      accrued: displayAccrued,

      used,

      carriedOver: displayCarriedOver,

      remaining,

      leaveCategory: category,

      fullYearEntitlement: usesJoinProration ? fullYearEntitlement : undefined,

      proratedJoinYear: proratedJoinYear || undefined,

    });

  }



  result.sort((a, b) => a.leaveTypeName.localeCompare(b.leaveTypeName));

  return result;

}

const ACTIVE_EMPLOYEE_STATUSES = ['active', 'ACTIVE', 'pending_approval'];

export async function employeeNeedsDefaultLeaveBalances(
  employeeId: string,
  gender: string | null | undefined,
  year: number
): Promise<boolean> {
  const defaults = await buildDefaultLeaveAssignments(gender);
  for (const [leaveTypeId, enabled] of Object.entries(defaults)) {
    if (!enabled) continue;
    const typeRow = await LeaveType.findByPk(leaveTypeId);
    if (!typeRow) continue;
    const t = typeRow.get ? typeRow.get({ plain: true }) : typeRow;
    const category = inferLeaveCategory(t);
    if (!leaveCategoryTracksBalance(category)) continue;
    const existing = await LeaveBalance.findOne({
      where: { employeeId, leaveTypeId, year },
    });
    if (!existing) return true;
  }
  return false;
}

/**
 * Idempotent deploy/bootstrap: assign default leave types and create balance rows
 * for active employees missing any balance-tracked leave balance this year.
 */
export async function ensureDefaultLeaveBalancesForActiveEmployees(
  year: number = new Date().getFullYear()
): Promise<{ scanned: number; provisioned: number }> {
  const employees = await Employee.findAll({
    where: { status: { [Op.in]: ACTIVE_EMPLOYEE_STATUSES } },
    attributes: ['id', 'gender'],
  });

  let provisioned = 0;
  for (const row of employees) {
    const e = row.get ? row.get({ plain: true }) : row;
    const employeeId = String(e.id);
    const gender = e.gender != null ? String(e.gender) : null;
    if (!(await employeeNeedsDefaultLeaveBalances(employeeId, gender, year))) continue;
    await applyDefaultLeaveAssignmentsToEmployee(employeeId, gender, year);
    provisioned += 1;
  }

  return { scanned: employees.length, provisioned };
}


