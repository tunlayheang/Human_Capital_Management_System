/**

 * Build a full staff roster for calendar day(s) (ICT) — one row per eligible employee per day,

 * not only employees who already have a row in attendancerecords.

 */

import { Op } from 'sequelize';

import { AttendanceRecord } from './db.js';

import { dateKeyIct } from './attendanceTimeZone.js';

import {

  enumerateDateKeys,

  listEligibleAttendanceUsers,

  shouldReconcileAttendanceDate,

  type EligibleAttendanceUser,

} from './attendanceReconcileService.js';

import { addCalendarDays } from './attendanceTimeZone.js';

import {

  buildAttendanceStatusContextMap,

  resolveAbsentAttendanceStatus,

} from './attendanceStatusContext.js';

import { getAttendanceGeofenceConfig, DEFAULT_ATTENDANCE_RULES } from './attendanceSettings.js';

import {
  resolveAttendanceDisplayStatus,
  type AttendanceDisplayStatus,
} from './attendanceRecordStatus.js';
import { getEmployeeSchedulesForUsers } from './employeeAttendanceSchedule.js';

import { serializeAttendanceRecords } from './attendanceRecordSerialize.js';

import { toDateKey } from './payroll/dateKey.js';



function isBeforeJoinDate(dateKey: string, joinDate: string | null): boolean {

  const join = toDateKey(joinDate);

  if (!join) return false;

  return dateKey.slice(0, 10) < join;

}



/** Status for staff with no clock-in yet today (before end-of-day reconcile). */
export type AwaitingClockStatus = 'ABSENT';



export function placeholderStatusForDate(

  dateKey: string,

  resolvedAbsent: 'DAY_OFF' | 'PH' | 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'ABSENT',

  rules = DEFAULT_ATTENDANCE_RULES,

  officeEndHm?: string | null

): string {

  const day = dateKey.slice(0, 10);

  const today = dateKeyIct();

  if (day === today && !shouldReconcileAttendanceDate(day, rules, new Date(), officeEndHm)) {

    if (
      resolvedAbsent === 'PAID_LEAVE' ||
      resolvedAbsent === 'UNPAID_LEAVE' ||
      resolvedAbsent === 'DAY_OFF' ||
      resolvedAbsent === 'PH'
    ) {

      return resolvedAbsent;

    }

    return 'ABSENT';

  }

  return resolvedAbsent;

}



function userDateKey(userId: string, day: string): string {

  return `${userId}|${day}`;

}



type GridBuildContext = {

  eligible: EligibleAttendanceUser[];

  rules: typeof DEFAULT_ATTENDANCE_RULES;

  officeEndHm: string | null | undefined;

  joinByUser: Map<string, string | null>;

  enrichedByKey: Map<string, Record<string, unknown>>;

  contextMap: Map<string, import('./attendanceStatusContext.js').AttendanceStatusContext>;

};



async function loadGridBuildContext(

  from: string,

  to: string,

  eligible?: EligibleAttendanceUser[]

): Promise<GridBuildContext> {

  const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
  await ensureAttendanceLateColumns();

  const settings = await getAttendanceGeofenceConfig();

  const rules = settings?.rules ?? DEFAULT_ATTENDANCE_RULES;

  const officeEndHm = settings?.workingHoursEnd ?? null;

  const roster = eligible ?? (await listEligibleAttendanceUsers());

  const joinByUser = new Map(roster.map((e) => [e.userId, e.joinDate]));



  const eligibleIds = roster.map((e) => e.userId);

  const existingRows: InstanceType<typeof AttendanceRecord>[] = eligibleIds.length

    ? await AttendanceRecord.findAll({

        where: {

          date: { [Op.between]: [from, to] },

          userId: { [Op.in]: eligibleIds },

        },

      })

    : [];



  const contextPairs: Array<{ userId: string; date: string }> = [];
  for (const userId of eligibleIds) {
    if (isBeforeJoinDate(to, joinByUser.get(userId) ?? null)) continue;
    contextPairs.push({ userId, date: from });
    if (to !== from) contextPairs.push({ userId, date: to });
  }

  const contextMap = await buildAttendanceStatusContextMap(contextPairs);

  const userIdsInRows = [
    ...new Set(
      existingRows.map((row) => String((row.get({ plain: true }) as { userId?: string }).userId ?? ''))
    ),
  ].filter(Boolean);
  const scheduleByUser = await getEmployeeSchedulesForUsers(userIdsInRows);

  const enrichedByKey = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const userId = String(plain.userId ?? '');
    const day = String(plain.date ?? '').slice(0, 10);
    const status: AttendanceDisplayStatus = resolveAttendanceDisplayStatus(
      {
        clockIn: plain.clockIn as string | Date | null | undefined,
        status: plain.status as string | null | undefined,
        date: plain.date as string | null | undefined,
        userId,
      },
      scheduleByUser.get(userId) ?? null,
      rules,
      contextMap.get(userId)
    );
    enrichedByKey.set(userDateKey(userId, day), { ...plain, status });
  }



  return { eligible: roster, rules, officeEndHm, joinByUser, enrichedByKey, contextMap };

}



function mergeGridRowsForDays(

  days: string[],

  ctx: GridBuildContext

): Record<string, unknown>[] {

  const { eligible, rules, officeEndHm, joinByUser, enrichedByKey, contextMap } = ctx;

  const merged: Record<string, unknown>[] = [];



  for (const day of days) {

    for (const { userId } of eligible) {

      if (isBeforeJoinDate(day, joinByUser.get(userId) ?? null)) continue;

      const rosterCtx = contextMap.get(userId);

      const absent = rosterCtx ? resolveAbsentAttendanceStatus(day, rosterCtx) : 'ABSENT';

      const rosterStatus = placeholderStatusForDate(day, absent, rules, officeEndHm);



      const existing = enrichedByKey.get(userDateKey(userId, day));

      if (existing) {

        merged.push({

          ...existing,

          status: existing.status ?? rosterStatus,

          isGridPlaceholder: false,

        });

        continue;

      }



      merged.push({

        id: `grid-${userId}-${day}`,

        userId,

        date: day,

        clockIn: null,

        clockOut: null,

        status: rosterStatus,

        workHours: null,

        locationIn: null,

        locationOut: null,

        isGridPlaceholder: true,

      });

    }

  }



  return merged;

}

/** Absent-like headcount for a roster day without API serialization / leave-detail attach. */
export async function countAbsentOnRosterDate(
  dateKey: string,
  userIds?: string[]
): Promise<number> {
  const day = String(dateKey).slice(0, 10);
  let eligible: EligibleAttendanceUser[] | undefined;
  if (userIds?.length) {
    const allowed = new Set(userIds.map((id) => String(id)));
    eligible = (await listEligibleAttendanceUsers()).filter((e) => allowed.has(e.userId));
  }
  const ctx = await loadGridBuildContext(day, day, eligible);
  const merged = mergeGridRowsForDays([day], ctx);
  return merged.filter((row) => {
    const st = String(row.status ?? '').toUpperCase();
    return st === 'ABSENT' || st === 'AWAITING';
  }).length;
}

/**

 * One row per eligible employee for `dateKey`, merging DB records with placeholders.

 */

export async function buildAttendanceGridForDate(
  dateKey: string,
  userIds?: string[]
): Promise<Record<string, unknown>[]> {
  const day = String(dateKey).slice(0, 10);
  if (userIds !== undefined && !userIds.length) return [];
  let eligible: EligibleAttendanceUser[] | undefined;
  if (userIds?.length) {
    const allowed = new Set(userIds.map((id) => String(id)));
    eligible = (await listEligibleAttendanceUsers()).filter((e) => allowed.has(e.userId));
  }
  const ctx = await loadGridBuildContext(day, day, eligible);
  const merged = mergeGridRowsForDays([day], ctx);
  merged.sort((a, b) => String(a.userId).localeCompare(String(b.userId)));

  const { attachLeaveDetailsToRecords } = await import('./approvedLeaveDayMap.js');
  return serializeAttendanceRecords(await attachLeaveDetailsToRecords(merged));
}



/**
 * Stored attendance rows for a date range (fast), plus today's full roster placeholders
 * when the range includes today — so unclocked staff still appear without building
 * employees × days for the whole history window.
 */
export async function buildAttendanceHistoryForRange(
  from: string,
  to: string,
  userIds?: string[]
): Promise<Record<string, unknown>[]> {
  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  const today = dateKeyIct();
  const capEnd = end > today ? today : end;
  if (!start || !capEnd || capEnd < start) return [];
  if (userIds !== undefined && !userIds.length) return [];

  const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
  await ensureAttendanceLateColumns();

  const includeTodayRoster = start <= today && capEnd >= today;
  const historyEnd = includeTodayRoster
    ? addCalendarDays(today, -1)
    : capEnd;

  const { enrichAttendanceRecords } = await import('./attendanceRecordStatus.js');
  let historyRows: Record<string, unknown>[] = [];
  if (historyEnd >= start) {
    let eligible = await listEligibleAttendanceUsers();
    if (userIds?.length) {
      const allowed = new Set(userIds.map((id) => String(id)));
      eligible = eligible.filter((e) => allowed.has(e.userId));
    }
    const eligibleIds = eligible.map((e) => e.userId);
    const existingRows = eligibleIds.length
      ? await AttendanceRecord.findAll({
          where: {
            date: { [Op.between]: [start, historyEnd] },
            userId: { [Op.in]: eligibleIds },
          },
          order: [
            ['date', 'DESC'],
            ['userId', 'ASC'],
          ],
        })
      : [];
    historyRows = await enrichAttendanceRecords(existingRows as unknown[]);
  }

  if (includeTodayRoster) {
    const todayGrid = await buildAttendanceGridForDate(today, userIds);
    return [...todayGrid, ...serializeAttendanceRecords(historyRows)];
  }

  return serializeAttendanceRecords(historyRows);
}

/** Full roster grid for each ICT calendar day from `from` through `to` (inclusive, capped at today). */

export async function buildAttendanceGridForRange(
  from: string,
  to: string,
  userIds?: string[]
): Promise<Record<string, unknown>[]> {
  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  const today = dateKeyIct();
  const capEnd = end > today ? today : end;
  if (!start || !capEnd || capEnd < start) return [];
  if (userIds !== undefined && !userIds.length) return [];

  let eligible: EligibleAttendanceUser[] | undefined;
  if (userIds?.length) {
    const allowed = new Set(userIds.map((id) => String(id)));
    eligible = (await listEligibleAttendanceUsers()).filter((e) => allowed.has(e.userId));
  }

  const days = enumerateDateKeys(start, capEnd);
  const ctx = await loadGridBuildContext(start, capEnd, eligible);
  const merged = mergeGridRowsForDays(days, ctx);

  merged.sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.userId).localeCompare(String(b.userId));
  });

  const { attachLeaveDetailsToRecords } = await import('./approvedLeaveDayMap.js');
  return serializeAttendanceRecords(await attachLeaveDetailsToRecords(merged));
}

/** Payroll batch path — same statuses as Attendance list without API serialization or extra leave pass. */
export async function buildPayrollAttendanceGridForRange(
  from: string,
  to: string
): Promise<Record<string, unknown>[]> {
  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  const today = dateKeyIct();
  const capEnd = end > today ? today : end;
  if (!start || !capEnd || capEnd < start) return [];

  const days = enumerateDateKeys(start, capEnd);
  const ctx = await loadGridBuildContext(start, capEnd);
  return mergeGridRowsForDays(days, ctx);
}



/** Last N ICT calendar days including today (N=7 → today and the previous 6 days). */
export function resolveGridRangeFromDayCount(
  dayCount: number,
  maxDays = 14
): { from: string; to: string } {
  const today = dateKeyIct();
  const days = Math.min(Math.max(1, Math.floor(dayCount)), maxDays);
  return { from: addCalendarDays(today, -(days - 1)), to: today };
}

/** One employee's roster rows from join date through `to`, merging stored records with placeholders. */
export async function buildAttendanceGridForUserRange(
  userId: string,
  from: string,
  to: string
): Promise<Record<string, unknown>[]> {
  const uid = String(userId).trim();
  if (!uid) return [];

  const start = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  const today = dateKeyIct();
  const capEnd = end > today ? today : end;
  if (!start || !capEnd || capEnd < start) return [];

  const eligible = await listEligibleAttendanceUsers();
  const entry = eligible.find((e) => e.userId === uid);

  if (!entry) {
    const attendance = await AttendanceRecord.findAll({
      where: { userId: uid, date: { [Op.between]: [start, capEnd] } },
      order: [['date', 'DESC']],
    });
    const { enrichAttendanceRecords } = await import('./attendanceRecordStatus.js');
    const enriched = await enrichAttendanceRecords(attendance as unknown[]);
    return serializeAttendanceRecords(enriched);
  }

  let effectiveFrom = start;
  const join = toDateKey(entry.joinDate);
  if (join && effectiveFrom < join) effectiveFrom = join;
  if (effectiveFrom > capEnd) return [];

  const days = enumerateDateKeys(effectiveFrom, capEnd);
  if (!days.length) return [];

  const ctx = await loadGridBuildContext(effectiveFrom, capEnd, [entry]);
  const merged = mergeGridRowsForDays(days, ctx);

  merged.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const { attachLeaveDetailsToRecords } = await import('./approvedLeaveDayMap.js');
  return serializeAttendanceRecords(await attachLeaveDetailsToRecords(merged));
}

export async function buildAttendanceGridForUserDate(
  userId: string,
  dateKey: string
): Promise<Record<string, unknown> | null> {
  const day = String(dateKey).slice(0, 10);
  const rows = await buildAttendanceGridForUserRange(userId, day, day);
  return rows[0] ?? null;
}
