import { Op } from 'sequelize';
import { LeaveRequest, RosterException } from './db.js';
import { type LeaveDurationFields } from './leaveDuration.js';
import { findActivePlanningRostersForMonth } from './planningRosterMonthQuery.js';
import { fetchPlanningRosterEntriesMap } from './monthlyPlanningRosterService.js';
import { resolveEmployeeKeysForUser, type EmployeeKeys } from './resolveEmployeeKeys.js';
import {
  loadLeaveTypeLookup,
  resolveLeaveRequestIsPaid,
  type LeaveTypeLookup,
} from './approvedLeaveDayMap.js';
import {
  dateKeyFromYmd,
  isRosterHoliday,
  isRosterMission,
  isRosterPlannedLeaveType,
  isRosterScheduledOffDay,
  parseMonthPrefix,
} from './rosterOffDays.js';

export type ApprovedLeaveDateSets = {
  approvedLeaveDates: Set<string>;
  approvedPaidLeaveDates: Set<string>;
  approvedUnpaidLeaveDates: Set<string>;
  approvedHalfDayLeaveDates: Set<string>;
};

export type AttendanceStatusContext = {
  offDates: Set<string>;
  holidayDates: Set<string>;
  /** Planning roster Mission days — clock in/out expected; status stays MISSION. */
  missionDates: Set<string>;
  approvedLeaveDates: Set<string>;
  approvedPaidLeaveDates: Set<string>;
  approvedUnpaidLeaveDates: Set<string>;
  approvedHalfDayLeaveDates: Set<string>;
  rosterLeaveDates: Set<string>;
  rosterPaidLeaveDates: Set<string>;
  rosterUnpaidLeaveDates: Set<string>;
};

function eachDateInRange(start: string, end: string, fn: (dateKey: string) => void): void {
  const s = new Date(`${start.slice(0, 10)}T12:00:00`);
  const e = new Date(`${end.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return;
  const cur = new Date(s);
  while (cur <= e) {
    fn(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    );
    cur.setDate(cur.getDate() + 1);
  }
}

function expandLeaveToDates(leave: LeaveDurationFields, fn: (dateKey: string) => void): void {
  const start = String(leave.startDate).slice(0, 10);
  const end = String(leave.endDate).slice(0, 10);
  if (leave.isHalfDay && start === end) {
    fn(start);
    return;
  }
  eachDateInRange(start, end, fn);
}

export async function getApprovedLeaveDateSetsForUser(
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<ApprovedLeaveDateSets> {
  const from = rangeStart.slice(0, 10);
  const to = rangeEnd.slice(0, 10);
  const rows = await LeaveRequest.findAll({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: to },
      endDate: { [Op.gte]: from },
    },
  });
  const lookup = await loadLeaveTypeLookup();
  const approvedLeaveDates = new Set<string>();
  const approvedPaidLeaveDates = new Set<string>();
  const approvedUnpaidLeaveDates = new Set<string>();
  const approvedHalfDayLeaveDates = new Set<string>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as LeaveDurationFields & { type?: string };
    const typeLabel = String(p.type ?? '').trim() || 'Leave';
    const isPaid = resolveLeaveRequestIsPaid(typeLabel, lookup);
    expandLeaveToDates(p, (d) => {
      if (d < from || d > to) return;
      approvedLeaveDates.add(d);
      if (isPaid) approvedPaidLeaveDates.add(d);
      else approvedUnpaidLeaveDates.add(d);
      if (p.isHalfDay) approvedHalfDayLeaveDates.add(d);
    });
  }
  return {
    approvedLeaveDates,
    approvedPaidLeaveDates,
    approvedUnpaidLeaveDates,
    approvedHalfDayLeaveDates,
  };
}

/** @deprecated Use getApprovedLeaveDateSetsForUser */
export async function getApprovedLeaveDatesForUser(
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Set<string>> {
  const sets = await getApprovedLeaveDateSetsForUser(userId, rangeStart, rangeEnd);
  return sets.approvedLeaveDates;
}

function matchesEmployee(
  entryEmployeeId: string,
  keys: EmployeeKeys,
  userId: string
): boolean {
  const eid = String(entryEmployeeId || '').trim();
  if (!eid) return false;
  if (keys.employeeId && eid === keys.employeeId) return true;
  if (keys.employeeDisplayId && eid === keys.employeeDisplayId) return true;
  if (eid === userId) return true;
  return false;
}

type MonthPlanningBundle = {
  year: number;
  monthIndex: number;
  planningRows: Awaited<ReturnType<typeof findActivePlanningRostersForMonth>>;
  entryMap: Awaited<ReturnType<typeof fetchPlanningRosterEntriesMap>>;
};

async function loadMonthPlanningBundle(
  monthPrefix: string,
  cache: Map<string, MonthPlanningBundle>
): Promise<MonthPlanningBundle> {
  const cached = cache.get(monthPrefix);
  if (cached) return cached;
  const { year, monthIndex } = parseMonthPrefix(monthPrefix);
  const planningRows = await findActivePlanningRostersForMonth(year, monthIndex);
  const entryMap = await fetchPlanningRosterEntriesMap(
    planningRows.map((r) => String(r.get('id')))
  );
  const bundle: MonthPlanningBundle = { year, monthIndex, planningRows, entryMap };
  cache.set(monthPrefix, bundle);
  return bundle;
}

function rosterPlanningDatesFromBundle(
  bundle: MonthPlanningBundle,
  keys: EmployeeKeys,
  userId: string,
  from: string,
  to: string,
  leaveLookup: LeaveTypeLookup
): {
  offDates: Set<string>;
  holidayDates: Set<string>;
  missionDates: Set<string>;
  leaveDates: Set<string>;
  paidLeaveDates: Set<string>;
  unpaidLeaveDates: Set<string>;
} {
  const offDates = new Set<string>();
  const holidayDates = new Set<string>();
  const missionDates = new Set<string>();
  const leaveDates = new Set<string>();
  const paidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  const { year, monthIndex, planningRows, entryMap } = bundle;

  for (const row of planningRows) {
    const rid = String(row.get('id'));
    for (const ent of entryMap.get(rid) ?? []) {
      if (!matchesEmployee(ent.employeeId, keys, userId)) continue;
      const key = dateKeyFromYmd(year, monthIndex, ent.day);
      if (key < from || key > to) continue;
      if (isRosterScheduledOffDay(ent.leaveType)) {
        offDates.add(key);
      } else if (isRosterHoliday(ent.leaveType)) {
        holidayDates.add(key);
      } else if (isRosterMission(ent.leaveType)) {
        missionDates.add(key);
      } else if (isRosterPlannedLeaveType(ent.leaveType)) {
        leaveDates.add(key);
        const label = String(ent.leaveType ?? '').trim();
        if (resolveLeaveRequestIsPaid(label, leaveLookup)) paidLeaveDates.add(key);
        else unpaidLeaveDates.add(key);
      }
    }
  }
  return { offDates, holidayDates, missionDates, leaveDates, paidLeaveDates, unpaidLeaveDates };
}

function monthPrefixesBetween(from: string, to: string): string[] {
  const start = parseMonthPrefix(from.slice(0, 7));
  const end = parseMonthPrefix(to.slice(0, 7));
  const out: string[] = [];
  let y = start.year;
  let m = start.monthIndex;
  const endKey = end.year * 12 + end.monthIndex;
  while (y * 12 + m <= endKey) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export type AttendanceStatusContextBuildOptions = {
  monthPlanningCache?: Map<string, MonthPlanningBundle>;
  leaveLookup?: LeaveTypeLookup;
  preloadedLeaveSets?: ApprovedLeaveDateSets;
  preloadedExceptionsByEmployee?: Map<string, Array<{ date: string; isWorking?: boolean }>>;
};

export async function buildAttendanceStatusContext(
  userId: string,
  keys: EmployeeKeys,
  rangeStart: string,
  rangeEnd: string,
  options?: AttendanceStatusContextBuildOptions
): Promise<AttendanceStatusContext> {
  const from = rangeStart.slice(0, 10);
  const to = rangeEnd.slice(0, 10);
  const offDates = new Set<string>();
  const holidayDates = new Set<string>();
  const missionDates = new Set<string>();
  const rosterLeaveDates = new Set<string>();
  const rosterPaidLeaveDates = new Set<string>();
  const rosterUnpaidLeaveDates = new Set<string>();
  const monthPlanningCache = options?.monthPlanningCache ?? new Map<string, MonthPlanningBundle>();
  const leaveLookup = options?.leaveLookup ?? (await loadLeaveTypeLookup());

  for (const monthPrefix of monthPrefixesBetween(from, to)) {
    const bundle = await loadMonthPlanningBundle(monthPrefix, monthPlanningCache);
    const monthRoster = rosterPlanningDatesFromBundle(
      bundle,
      keys,
      userId,
      from,
      to,
      leaveLookup
    );
    monthRoster.offDates.forEach((d) => offDates.add(d));
    monthRoster.holidayDates.forEach((d) => holidayDates.add(d));
    monthRoster.missionDates.forEach((d) => missionDates.add(d));
    monthRoster.leaveDates.forEach((d) => rosterLeaveDates.add(d));
    monthRoster.paidLeaveDates.forEach((d) => rosterPaidLeaveDates.add(d));
    monthRoster.unpaidLeaveDates.forEach((d) => rosterUnpaidLeaveDates.add(d));

    if (keys.employeeId) {
      const exceptions =
        options?.preloadedExceptionsByEmployee?.get(keys.employeeId) ??
        (
          await RosterException.findAll({
            where: {
              employeeId: keys.employeeId,
              date: {
                [Op.gte]: new Date(
                  parseMonthPrefix(monthPrefix).year,
                  parseMonthPrefix(monthPrefix).monthIndex,
                  1
                ),
                [Op.lt]: new Date(
                  parseMonthPrefix(monthPrefix).year,
                  parseMonthPrefix(monthPrefix).monthIndex + 1,
                  1
                ),
              },
            },
          })
        ).map((ex) => {
          const p = ex.get({ plain: true }) as { date: string | Date; isWorking?: boolean };
          return { date: String(p.date).slice(0, 10), isWorking: p.isWorking };
        });

      const { year, monthIndex } = parseMonthPrefix(monthPrefix);
      const monthStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
      const monthEndDate = new Date(year, monthIndex + 1, 0);
      const monthEnd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(
        monthEndDate.getDate()
      ).padStart(2, '0')}`;

      for (const ex of exceptions) {
        const key = String(ex.date).slice(0, 10);
        if (key < from || key > to) continue;
        if (key < monthStart || key > monthEnd) continue;
        if (ex.isWorking === false) offDates.add(key);
        else if (ex.isWorking === true) offDates.delete(key);
      }
    }
  }

  const {
    approvedLeaveDates,
    approvedPaidLeaveDates,
    approvedUnpaidLeaveDates,
    approvedHalfDayLeaveDates,
  } =
    options?.preloadedLeaveSets ??
    (await getApprovedLeaveDateSetsForUser(userId, from, to));

  // Day off / holiday / mission from monthly planning roster and roster exceptions only —
  // not calendar weekends or fixed weekly "weekend off" patterns.
  return {
    offDates,
    holidayDates,
    missionDates,
    approvedLeaveDates,
    approvedPaidLeaveDates,
    approvedUnpaidLeaveDates,
    approvedHalfDayLeaveDates,
    rosterLeaveDates,
    rosterPaidLeaveDates,
    rosterUnpaidLeaveDates,
  };
}

/** Resolve status when employee did not clock in. */
export function resolveAbsentAttendanceStatus(
  dateKey: string,
  ctx: AttendanceStatusContext
): 'DAY_OFF' | 'PH' | 'MISSION' | 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'ABSENT' {
  const d = dateKey.slice(0, 10);
  if (ctx.approvedPaidLeaveDates.has(d)) return 'PAID_LEAVE';
  if (ctx.approvedUnpaidLeaveDates.has(d)) return 'UNPAID_LEAVE';
  if (ctx.rosterPaidLeaveDates.has(d)) return 'PAID_LEAVE';
  if (ctx.rosterUnpaidLeaveDates.has(d)) return 'UNPAID_LEAVE';
  if (ctx.offDates.has(d)) return 'DAY_OFF';
  if (ctx.holidayDates.has(d)) return 'PH';
  if (ctx.missionDates.has(d)) return 'MISSION';
  return 'ABSENT';
}

export async function buildAttendanceStatusContextMap(
  records: Array<{ userId: string; date: string }>
): Promise<Map<string, AttendanceStatusContext>> {
  const byUser = new Map<string, { min: string; max: string }>();
  for (const r of records) {
    const userId = String(r.userId ?? '').trim();
    const d = String(r.date ?? '').slice(0, 10);
    if (!userId || !d) continue;
    const cur = byUser.get(userId);
    if (!cur) byUser.set(userId, { min: d, max: d });
    else {
      if (d < cur.min) cur.min = d;
      if (d > cur.max) cur.max = d;
    }
  }

  const userIds = [...byUser.keys()];
  if (!userIds.length) return new Map();

  let globalMin = '';
  let globalMax = '';
  for (const range of byUser.values()) {
    if (!globalMin || range.min < globalMin) globalMin = range.min;
    if (!globalMax || range.max > globalMax) globalMax = range.max;
  }

  const [{ resolveEmployeeKeysForUsers }, leaveLookup] = await Promise.all([
    import('./resolveEmployeeKeys.js'),
    loadLeaveTypeLookup(),
  ]);
  const keysByUser = await resolveEmployeeKeysForUsers(userIds);

  const leaveRows =
    userIds.length > 0
      ? await LeaveRequest.findAll({
          where: {
            userId: { [Op.in]: userIds },
            status: 'APPROVED',
            startDate: { [Op.lte]: globalMax },
            endDate: { [Op.gte]: globalMin },
          },
        })
      : [];

  const leaveSetsByUser = new Map<string, ApprovedLeaveDateSets>();
  for (const userId of userIds) {
    leaveSetsByUser.set(userId, {
      approvedLeaveDates: new Set(),
      approvedPaidLeaveDates: new Set(),
      approvedUnpaidLeaveDates: new Set(),
      approvedHalfDayLeaveDates: new Set(),
    });
  }
  for (const row of leaveRows) {
    const p = row.get({ plain: true }) as LeaveDurationFields & {
      type?: string;
      userId?: string;
    };
    const userId = String(p.userId ?? '').trim();
    const sets = leaveSetsByUser.get(userId);
    if (!sets) continue;
    const range = byUser.get(userId);
    if (!range) continue;
    const typeLabel = String(p.type ?? '').trim() || 'Leave';
    const isPaid = resolveLeaveRequestIsPaid(typeLabel, leaveLookup);
    expandLeaveToDates(p, (d) => {
      if (d < range.min || d > range.max) return;
      sets.approvedLeaveDates.add(d);
      if (isPaid) sets.approvedPaidLeaveDates.add(d);
      else sets.approvedUnpaidLeaveDates.add(d);
      if (p.isHalfDay) sets.approvedHalfDayLeaveDates.add(d);
    });
  }

  const employeeIds = [
    ...new Set(
      [...keysByUser.values()]
        .map((k) => k.employeeId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const exceptionsByEmployee = new Map<
    string,
    Array<{ date: string; isWorking?: boolean }>
  >();
  if (employeeIds.length) {
    const exceptionRows = await RosterException.findAll({
      where: {
        employeeId: { [Op.in]: employeeIds },
        date: {
          [Op.gte]: new Date(`${globalMin}T00:00:00`),
          [Op.lte]: new Date(`${globalMax}T23:59:59`),
        },
      },
    });
    for (const ex of exceptionRows) {
      const p = ex.get({ plain: true }) as {
        employeeId?: string;
        date: string | Date;
        isWorking?: boolean;
      };
      const employeeId = String(p.employeeId ?? '').trim();
      if (!employeeId) continue;
      const list = exceptionsByEmployee.get(employeeId) ?? [];
      list.push({ date: String(p.date).slice(0, 10), isWorking: p.isWorking });
      exceptionsByEmployee.set(employeeId, list);
    }
  }

  const monthPlanningCache = new Map<string, MonthPlanningBundle>();
  const map = new Map<string, AttendanceStatusContext>();
  await Promise.all(
    [...byUser.entries()].map(async ([userId, range]) => {
      const keys = keysByUser.get(userId) ?? { employeeId: null, employeeDisplayId: null };
      map.set(
        userId,
        await buildAttendanceStatusContext(userId, keys, range.min, range.max, {
          monthPlanningCache,
          leaveLookup,
          preloadedLeaveSets: leaveSetsByUser.get(userId),
          preloadedExceptionsByEmployee: exceptionsByEmployee,
        })
      );
    })
  );
  return map;
}

export { resolveEmployeeKeysForUser };
