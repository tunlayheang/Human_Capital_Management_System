import { Op } from 'sequelize';
import { AttendanceRecord, Employee, User } from './db.js';
import { dateKeyIct, minutesNowIct, addCalendarDays } from './attendanceTimeZone.js';
import {
  DEFAULT_ATTENDANCE_RULES,
  getAttendanceGeofenceConfig,
  type AttendanceClockRules,
} from './attendanceSettings.js';
import { parseTimeToMinutes } from './employeeAttendanceSchedule.js';
import { isEmployeeEligibleForAttendanceRoster } from './employeePortalStatus.js';
import {
  buildAttendanceStatusContext,
  buildAttendanceStatusContextMap,
  resolveAbsentAttendanceStatus,
} from './attendanceStatusContext.js';
import { isScheduledDayOff, isScheduledMission, isScheduledPublicHoliday } from './attendanceDayOffWork.js';
import { toDateKey } from './payroll/dateKey.js';
import { isPortalUserExcludedFromPayroll } from './payroll/employeePayrollEligibility.js';
import { isSystemAdminAccount } from './systemAdminAccount.js';
import { portalLoginIsActive } from './userAuth.js';

const DEFAULT_RECONCILE_DAYS = 90;

export function enumerateDateKeys(from: string, to: string): string[] {
  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  if (!start || !end || end < start) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function resolveEndOfDayMinutes(rules: AttendanceClockRules, officeEndHm?: string | null): number {
  const fromOffice = officeEndHm ? parseTimeToMinutes(officeEndHm) : null;
  if (fromOffice != null) return fromOffice;
  const fromRules =
    parseTimeToMinutes(
      `${String(rules.lateAfterHour).padStart(2, '0')}:${String(rules.lateAfterMinute).padStart(2, '0')}`
    ) ?? null;
  if (fromRules != null) return fromRules + 8 * 60;
  return 17 * 60;
}

/** Whether we should materialize no-clock-in rows for this calendar day (ICT). */
export function shouldReconcileAttendanceDate(
  dateKey: string,
  rules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES,
  now = new Date(),
  officeEndHm?: string | null
): boolean {
  const day = String(dateKey).slice(0, 10);
  const today = dateKeyIct(now);
  if (day > today) return false;

  if (day < today) return true;

  const endMinutes = resolveEndOfDayMinutes(rules, officeEndHm);
  const grace = Math.max(0, Number(rules.gracePeriodMinutes) || 0);
  return minutesNowIct(now) >= endMinutes + grace;
}

export type EligibleAttendanceUser = {
  userId: string;
  joinDate: string | null;
  /** Employee row PK (`employees.id`). */
  employeePk: string;
  /** Display badge when available (`employees.employee_id`, e.g. ROC#####). */
  employeeDisplayId: string | null;
};

/**
 * Attendance roster is employee-first: only Active / Pending Approval employees with a
 * linked portal login. System admins and other non-employee portal accounts are excluded
 * (including email-only matches that previously pulled ADM##### into the list).
 */
let eligibleAttendanceUsersCache: {
  at: number;
  rows: EligibleAttendanceUser[];
} | null = null;
const ELIGIBLE_ATTENDANCE_USERS_TTL_MS = 30_000;

export function invalidateEligibleAttendanceUsersCache(): void {
  eligibleAttendanceUsersCache = null;
}

export async function listEligibleAttendanceUsers(): Promise<EligibleAttendanceUser[]> {
  if (
    eligibleAttendanceUsersCache &&
    Date.now() - eligibleAttendanceUsersCache.at < ELIGIBLE_ATTENDANCE_USERS_TTL_MS
  ) {
    return eligibleAttendanceUsersCache.rows;
  }

  // `access_role` lives on `positions`, not `employees`. Admin exclusion is done
  // below via the linked portal user's `role` (isPortalUserExcludedFromPayroll /
  // isSystemAdminAccount) — selecting employees.access_role caused MySQL 500s.
  const empRows: any[] = await Employee.findAll({
    attributes: ['id', 'employee_id', 'email', 'status', 'join_date'],
    // Attendance roster = Active employees only (helper below is the safety net for odd casings).
    where: { status: { [Op.in]: ['active', 'ACTIVE'] } },
  });
  if (!empRows.length) {
    eligibleAttendanceUsersCache = { at: Date.now(), rows: [] };
    return [];
  }

  const eligibleEmployees: Array<{
    pk: string;
    displayId: string | null;
    email: string;
    joinDate: string | null;
  }> = [];
  const employeePks = new Set<string>();
  const displayCodes = new Set<string>();

  for (const row of empRows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const pk = String(plain.id ?? '').trim();
    if (!pk) continue;
    if (!isEmployeeEligibleForAttendanceRoster(plain.status as string | null | undefined)) continue;

    const displayId = String(plain.employee_id ?? '').trim() || null;
    const email = String(plain.email ?? '').trim().toLowerCase();
    const joinDate = toDateKey(plain.join_date as string | null | undefined);
    eligibleEmployees.push({ pk, displayId, email, joinDate });
    employeePks.add(pk);
    if (displayId) displayCodes.add(displayId);
  }

  if (!eligibleEmployees.length) {
    eligibleAttendanceUsersCache = { at: Date.now(), rows: [] };
    return [];
  }

  const linkIds = [...new Set([...employeePks, ...displayCodes])];
  const users: any[] = await User.findAll({
    where: {
      employeeId: { [Op.in]: linkIds },
    },
    attributes: ['id', 'employeeId', 'email', 'role', 'isActive', 'status'],
  });

  const usersByEmployeeLink = new Map<string, Record<string, unknown>>();
  for (const row of users) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    if (!portalLoginIsActive(plain as { isActive?: boolean; status?: string })) continue;
    if (isPortalUserExcludedFromPayroll(plain.role)) continue;
    if (isSystemAdminAccount(plain)) continue;

    const link = String(plain.employeeId ?? '').trim();
    if (!link) continue;
    // Prefer first linked portal user per employee PK / display code.
    if (!usersByEmployeeLink.has(link)) usersByEmployeeLink.set(link, plain);
  }

  const out: EligibleAttendanceUser[] = [];
  const seenUserIds = new Set<string>();

  for (const emp of eligibleEmployees) {
    const userPlain =
      usersByEmployeeLink.get(emp.pk) ??
      (emp.displayId ? usersByEmployeeLink.get(emp.displayId) : undefined) ??
      null;
    if (!userPlain) continue;

    const userId = String(userPlain.id ?? '').trim();
    if (!userId || seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);

    out.push({
      userId,
      joinDate: emp.joinDate,
      employeePk: emp.pk,
      employeeDisplayId: emp.displayId,
    });
  }

  eligibleAttendanceUsersCache = { at: Date.now(), rows: out };
  return out;
}

/** @deprecated Use listEligibleAttendanceUsers */
export async function listEligibleAttendanceUserIds(): Promise<string[]> {
  const rows = await listEligibleAttendanceUsers();
  return rows.map((r) => r.userId);
}

export type ReconcileAttendanceResult = {
  from: string;
  to: string;
  datesProcessed: number;
  created: number;
  skippedExisting: number;
};

function isBeforeJoinDate(dateKey: string, joinDate: string | null): boolean {
  const join = toDateKey(joinDate);
  if (!join) return false;
  return dateKey.slice(0, 10) < join;
}

/**
 * Create attendance rows for eligible staff who did not clock in.
 * Uses ON_LEAVE / DAY_OFF / ABSENT from planning roster, fixed roster, and approved leave.
 */
export async function reconcileAttendanceAbsences(params: {
  from: string;
  to: string;
  rules?: AttendanceClockRules;
  /** When set, only materialize/update rows for these portal user ids (self-service reads). */
  userIds?: string[];
}): Promise<ReconcileAttendanceResult> {
  const settings = await getAttendanceGeofenceConfig();
  const rules = params.rules ?? settings?.rules ?? DEFAULT_ATTENDANCE_RULES;
  const officeEndHm = settings?.workingHoursEnd ?? null;

  const from = String(params.from).slice(0, 10);
  const to = String(params.to).slice(0, 10);
  let eligible = await listEligibleAttendanceUsers();
  if (params.userIds?.length) {
    const allow = new Set(params.userIds.map((id) => String(id).trim()).filter(Boolean));
    eligible = eligible.filter((e) => allow.has(e.userId));
  }

  let created = 0;
  let skippedExisting = 0;
  let datesProcessed = 0;

  const dateKeys = enumerateDateKeys(from, to).filter((d) =>
    shouldReconcileAttendanceDate(d, rules, new Date(), officeEndHm)
  );
  datesProcessed = dateKeys.length;

  if (!eligible.length || !dateKeys.length) {
    return { from, to, datesProcessed, created, skippedExisting };
  }

  const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
  await ensureAttendanceLateColumns();

  const eligibleIds = eligible.map((e) => e.userId);
  const joinByUser = new Map(eligible.map((e) => [e.userId, e.joinDate]));

  const rangeStart = dateKeys[0] ?? from;
  const rangeEnd = dateKeys[dateKeys.length - 1] ?? to;
  const existingInRange: any[] = await AttendanceRecord.findAll({
    where: {
      date: { [Op.between]: [rangeStart, rangeEnd] },
      userId: { [Op.in]: eligibleIds },
    },
  });
  const existingByDate = new Map<string, Map<string, any>>();
  for (const row of existingInRange) {
    const day = String(row.get('date')).slice(0, 10);
    const uid = String(row.get('userId'));
    if (!existingByDate.has(day)) existingByDate.set(day, new Map());
    existingByDate.get(day)!.set(uid, row);
  }

  for (const dateKey of dateKeys) {
    const dayRows = existingByDate.get(dateKey);
    const existingRows = dayRows ? [...dayRows.values()] : [];
    const hasRow = new Set(existingRows.map((r) => String(r.get('userId'))));
    const rosterUserIds = eligibleIds.filter(
      (userId) => !isBeforeJoinDate(dateKey, joinByUser.get(userId) ?? null)
    );
    const missing = rosterUserIds.filter((userId) => !hasRow.has(userId));
    skippedExisting += eligibleIds.length - missing.length;

    const contextMap = await buildAttendanceStatusContextMap(
      rosterUserIds.map((userId) => ({ userId, date: dateKey }))
    );

    const { resolveAttendanceFreezePolicy, AttendanceFrozenError } = await import(
      './payroll/attendanceFreezeGuard.js'
    );
    let freezePolicy: Awaited<ReturnType<typeof resolveAttendanceFreezePolicy>> | null = null;
    try {
      freezePolicy = await resolveAttendanceFreezePolicy(dateKey);
    } catch (freezeErr) {
      if (freezeErr instanceof AttendanceFrozenError) {
        freezePolicy = null;
      } else {
        throw freezeErr;
      }
    }
    const allowUpdate = freezePolicy?.allowUpdate ?? false;
    const allowCreate = freezePolicy?.allowCreate ?? false;

    if (allowUpdate) {
      for (const row of existingRows) {
        const plain = row.get({ plain: true }) as {
          userId: string;
          clockIn?: string | null;
          status?: string | null;
        };
        const userId = String(plain.userId);
        const ctx = contextMap.get(userId);
        if (!ctx) continue;
        const hasClockIn = plain.clockIn != null && String(plain.clockIn).trim() !== '';
        const halfDayLeave =
          hasClockIn && ctx.approvedHalfDayLeaveDates.has(dateKey);
        if (halfDayLeave) continue;

        if (hasClockIn) {
          const stored = String(plain.status ?? '').toUpperCase();
          if (isScheduledPublicHoliday(ctx, dateKey)) {
            if (stored !== 'PH') {
              await row.update({ status: 'PH' });
            }
          } else if (isScheduledDayOff(ctx, dateKey)) {
            if (stored !== 'DAY_OFF') {
              await row.update({ status: 'DAY_OFF' });
            }
          } else if (isScheduledMission(ctx, dateKey)) {
            if (stored !== 'MISSION') {
              await row.update({ status: 'MISSION' });
            }
          }
          continue;
        }

        const targetStatus = resolveAbsentAttendanceStatus(dateKey, ctx);
        const stored = String(plain.status ?? '').toUpperCase();
        if (stored !== targetStatus) {
          await row.update({ status: targetStatus });
        }
      }
    }

    if (!missing.length) continue;

    for (const userId of missing) {
      const ctx =
        contextMap.get(userId) ??
        (await buildAttendanceStatusContext(
          userId,
          await import('./resolveEmployeeKeys.js').then((m) =>
            m.resolveEmployeeKeysForUser(userId)
          ),
          dateKey,
          dateKey
        ));
      const status = resolveAbsentAttendanceStatus(dateKey, ctx);
      const stableId = `att-${userId}-${dateKey}`;

      try {
        if (!allowCreate) {
          skippedExisting += 1;
          continue;
        }

        await AttendanceRecord.create({
          id: stableId,
          userId,
          date: dateKey,
          status,
          clockIn: null,
          clockOut: null,
          workHours: null,
        });
        created += 1;
        if (status === 'ABSENT' && dateKey === dateKeyIct()) {
          const { notifyMissedCheckIn } = await import('./notificationService.js');
          void notifyMissedCheckIn({
            attendanceId: stableId,
            userId,
            date: dateKey,
          }).catch(() => undefined);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate|unique/i.test(msg)) {
          console.warn('[attendanceReconcile] create failed:', userId, dateKey, msg);
        } else {
          skippedExisting += 1;
        }
      }
    }
  }

  if (created > 0) {
    console.log(
      `[attendanceReconcile] ${created} absence/day-off/leave row(s) for ${from}..${to}`
    );
  }

  return { from, to, datesProcessed, created, skippedExisting };
}

/** When true, materialize missing absence rows before returning list data (slow). */
export function shouldReconcileOnRead(query: Record<string, unknown>): boolean {
  const v = query.reconcile;
  return v === '1' || v === 'true' || v === true;
}

export function resolveAttendanceListDateRange(query: Record<string, unknown>): {

  from: string;
  to: string;
  whereDate?: string | { [Op.between]: [string, string] };
} {
  const today = dateKeyIct();
  const single =
    query.date === 'today'
      ? today
      : query.date
        ? String(query.date).slice(0, 10)
        : null;

  if (single) {
    return { from: single, to: single, whereDate: single };
  }

  const daysRaw = Number(query.reconcile_days);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0
      ? Math.min(Math.floor(daysRaw), 365)
      : DEFAULT_RECONCILE_DAYS;
  const from = addCalendarDays(today, -days);
  return {
    from,
    to: today,
    whereDate: { [Op.between]: [from, today] },
  };
}
