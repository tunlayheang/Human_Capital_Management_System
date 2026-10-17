import { Op } from 'sequelize';
import {
  FixedRoster,
  MonthlyPlanningRoster,
  RosterAssignment,
  RosterException,
} from './db.js';
import { findActivePlanningRostersForMonth } from './planningRosterMonthQuery.js';
import { fetchPlanningRosterEntriesMap } from './monthlyPlanningRosterService.js';
import {
  dateKeyFromYmd,
  isRosterScheduledOffDay,
  parseMonthPrefix,
} from './rosterOffDays.js';

export type { MonthlyRosterEntryRow } from './monthlyPlanningRosterService.js';

function matchesEmployee(
  entryEmployeeId: string,
  employeeId: string | null | undefined,
  userId: string | null | undefined,
  employeeDisplayId?: string | null
): boolean {
  const eid = String(entryEmployeeId || '').trim();
  if (!eid) return false;
  if (employeeId && eid === employeeId) return true;
  if (employeeDisplayId && eid === employeeDisplayId) return true;
  if (userId && eid === userId) return true;
  return false;
}

async function weeklyOffWeekdays(employeeId: string): Promise<Set<number>> {
  const assignments = await RosterAssignment.findAll({
    where: { entityType: 'EMPLOYEE', entityId: employeeId },
  });
  const off = new Set<number>();
  for (const row of assignments) {
    const plain = row.get({ plain: true }) as { rosterId: string };
    const roster = await FixedRoster.findByPk(plain.rosterId);
    if (!roster) continue;
    const r = roster.get({ plain: true }) as {
      isActive?: boolean;
      schedule?: { days?: number[] };
    };
    if (r.isActive === false) continue;
    for (const d of r.schedule?.days ?? []) {
      if (Number.isFinite(d) && d >= 0 && d <= 6) off.add(Number(d));
    }
  }
  return off;
}

function applyMonthlyEntries(
  offDates: Set<string>,
  monthlyByDay: Map<number, string>,
  year: number,
  monthIndex: number
): void {
  for (const [day, leaveType] of monthlyByDay) {
    const key = dateKeyFromYmd(year, monthIndex, day);
    if (isRosterScheduledOffDay(leaveType)) offDates.add(key);
    else offDates.delete(key);
  }
}

function applyWeeklyPattern(
  offDates: Set<string>,
  weeklyOff: Set<number>,
  year: number,
  monthIndex: number,
  monthlyByDay: Map<number, string>
): void {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    if (monthlyByDay.has(day)) continue;
    const dow = new Date(year, monthIndex, day).getDay();
    if (weeklyOff.has(dow)) offDates.add(dateKeyFromYmd(year, monthIndex, day));
  }
}

/**
 * Rest days for premium OT: Planning roster "Day Off" entries, then weekly fixed roster
 * assignments, then roster exceptions (isWorking=false).
 */
export async function getEmployeeOffDatesForMonth(params: {
  employeeId?: string | null;
  userId?: string | null;
  employeeDisplayId?: string | null;
  month: string;
}): Promise<Set<string>> {
  const { year, monthIndex } = parseMonthPrefix(params.month);
  const employeeId = params.employeeId ? String(params.employeeId) : null;
  const userId = params.userId ? String(params.userId) : null;
  const employeeDisplayId = params.employeeDisplayId
    ? String(params.employeeDisplayId)
    : null;
  const offDates = new Set<string>();
  const monthlyByDay = new Map<number, string>();

  const planningRows = await findActivePlanningRostersForMonth(year, monthIndex);
  const entryMap = await fetchPlanningRosterEntriesMap(
    planningRows.map((r) => String((r.get({ plain: true }) as { id: string }).id))
  );

  for (const row of planningRows) {
    const rid = String((row.get({ plain: true }) as { id: string }).id);
    for (const ent of entryMap.get(rid) ?? []) {
      if (!matchesEmployee(ent.employeeId, employeeId, userId, employeeDisplayId)) continue;
      monthlyByDay.set(ent.day, ent.leaveType);
    }
  }

  applyMonthlyEntries(offDates, monthlyByDay, year, monthIndex);

  if (employeeId) {
    const weeklyOff = await weeklyOffWeekdays(employeeId);
    applyWeeklyPattern(offDates, weeklyOff, year, monthIndex, monthlyByDay);

    const exceptions = await RosterException.findAll({
      where: {
        employeeId,
        date: {
          [Op.gte]: new Date(year, monthIndex, 1),
          [Op.lt]: new Date(year, monthIndex + 1, 1),
        },
      },
    });
    for (const ex of exceptions) {
      const p = ex.get({ plain: true }) as { date: string | Date; isWorking?: boolean };
      const key = String(p.date).slice(0, 10);
      if (p.isWorking === false) offDates.add(key);
      else if (p.isWorking === true) offDates.delete(key);
    }
  }

  return offDates;
}

export async function getEmployeeOffDatesForMonthPrefix(
  employeeId: string | null | undefined,
  userId: string | null | undefined,
  monthPrefix: string,
  employeeDisplayId?: string | null
): Promise<Set<string>> {
  return getEmployeeOffDatesForMonth({
    employeeId,
    userId,
    employeeDisplayId,
    month: monthPrefix.length >= 7 ? monthPrefix : `${monthPrefix}-01`,
  });
}
