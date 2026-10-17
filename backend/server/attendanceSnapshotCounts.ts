import { Op } from 'sequelize';
import { AttendanceRecord } from './db.js';
import { dateKeyIct } from './attendanceTimeZone.js';

function isAbsentLikeStatus(status: unknown): boolean {
  const st = String(status ?? '').toUpperCase();
  return st === 'ABSENT' || st === 'AWAITING';
}

type AbsentCountCacheEntry = { at: number; value: number };
const absentCountCache = new Map<string, AbsentCountCacheEntry>();
const ABSENT_COUNT_TTL_MS = 20_000;

/**
 * Absent headcount for a calendar day.
 * For today (ICT), uses the attendance roster merge (without heavy serialization)
 * so not-yet-clocked-in staff count as absent.
 */
export async function countAbsentOnDate(
  dateKey: string,
  userIds?: string[]
): Promise<number> {
  const day = String(dateKey).slice(0, 10);
  const today = dateKeyIct();
  const scopeKey = userIds?.length
    ? [...userIds].map(String).sort().join(',')
    : '*';
  const cacheKey = `${day}|${scopeKey}`;
  const cached = absentCountCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ABSENT_COUNT_TTL_MS) {
    return cached.value;
  }

  let value: number;
  if (day === today) {
    const { countAbsentOnRosterDate } = await import('./attendanceListGridService.js');
    value = await countAbsentOnRosterDate(day, userIds);
  } else {
    const where: Record<string, unknown> = {
      date: day,
      status: { [Op.in]: ['ABSENT', 'AWAITING'] },
    };
    if (userIds?.length) where.userId = { [Op.in]: userIds };
    value = await AttendanceRecord.count({ where, logging: false });
  }

  absentCountCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** @internal test helper */
export function __clearAbsentCountCacheForTests() {
  absentCountCache.clear();
}

export { isAbsentLikeStatus };
