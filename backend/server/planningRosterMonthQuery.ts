import { MonthlyPlanningRoster } from './db.js';

/** Month index from API body (frontend sends 0–11; also accepts 1–12). */
export function apiMonthToIndex(monthRaw: number): number {
  if (!Number.isFinite(monthRaw)) return new Date().getMonth();
  if (monthRaw >= 0 && monthRaw <= 11) return monthRaw;
  if (monthRaw >= 1 && monthRaw <= 12) return monthRaw - 1;
  return new Date().getMonth();
}

/** Month index from DB column (calendar 1–12; legacy rows may still be 0–11). */
export function dbMonthToIndex(monthRaw: number): number {
  if (!Number.isFinite(monthRaw)) return new Date().getMonth();
  if (monthRaw >= 1 && monthRaw <= 12) return monthRaw - 1;
  if (monthRaw >= 0 && monthRaw <= 11) return monthRaw;
  return new Date().getMonth();
}

/** DB stores calendar month 1–12 (May=5); API uses 0–11 (May=4). */
export function normalizeStoredMonthIndex(monthRaw: number): number {
  return dbMonthToIndex(monthRaw);
}

export async function findActivePlanningRostersForMonth(
  year: number,
  monthIndex: number
) {
  const rows = await MonthlyPlanningRoster.findAll({
    where: { year, isActive: true },
    order: [['updatedAt', 'DESC']],
  });
  return rows.filter((row) => {
    const plain = row.get({ plain: true }) as { month?: number };
    return normalizeStoredMonthIndex(Number(plain.month)) === monthIndex;
  });
}
