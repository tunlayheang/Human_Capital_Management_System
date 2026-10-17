import { getCambodiaPublicHolidays } from '../constants/cambodiaPublicHolidays';
import { MonthlyFixedRoster, MonthlyRosterEntry } from '../types/roster';
import {
  buildRosterPaintTypesWithHoliday,
  findRosterPaintType,
  resolveEntryToRosterTypeId,
  type RosterPaintType,
  type RosterTypeId,
} from './rosterPaintTypes';
import { isRosterHoliday, isRosterScheduledOffDay } from './rosterOffDays';
import type { LeaveType } from '../types';

export type RosterGrid = Record<string, Record<number, RosterTypeId>>;
export type RosterEmployee = {
  id: string;
  /** Business code (e.g. ROC00014) — used to match legacy roster entry ids. */
  employeeCode?: string;
  name: string;
  department?: string;
};

/** Map roster entry employeeId to the grid row key (internal employee pk). */
export function resolveRosterEmployeeId(
  entryEmployeeId: string,
  employees: RosterEmployee[]
): string {
  const key = String(entryEmployeeId || '').trim();
  if (!key) return key;
  const byPk = employees.find((e) => e.id === key);
  if (byPk) return byPk.id;
  const byCode = employees.find(
    (e) => e.employeeCode && e.employeeCode === key
  );
  if (byCode) return byCode.id;
  return key;
}

export function mergeRosterEmployees(
  base: RosterEmployee[],
  initial?: MonthlyFixedRoster | null
): RosterEmployee[] {
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const ent of initial?.entries ?? []) {
    const resolved = resolveRosterEmployeeId(ent.employeeId, base);
    if (!byId.has(resolved)) {
      byId.set(resolved, { id: resolved, name: ent.employeeId });
    }
  }
  return [...byId.values()];
}

function ensureEmployeeGridRow(
  grid: RosterGrid,
  employeeId: string,
  daysInMonth: number
): Record<number, RosterTypeId> {
  if (!grid[employeeId]) {
    grid[employeeId] = {};
  }
  const row = grid[employeeId];
  for (let d = 1; d <= daysInMonth; d++) {
    if (row[d] === undefined) row[d] = 'working';
  }
  return row;
}

/** Paint MLVT public holidays for the selected month on every employee row. */
export function applyPublicHolidaysToGrid(
  grid: RosterGrid,
  employees: RosterEmployee[],
  month: number,
  year: number,
  daysInMonth: number
): void {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const holidayDays = new Set<number>();
  for (const h of getCambodiaPublicHolidays(year)) {
    if (!h.date.startsWith(monthPrefix)) continue;
    const day = Number(h.date.slice(8, 10));
    if (day >= 1 && day <= daysInMonth) holidayDays.add(day);
  }
  if (!holidayDays.size) return;
  employees.forEach((e) => {
    const row = ensureEmployeeGridRow(grid, e.id, daysInMonth);
    holidayDays.forEach((day) => {
      const current = row[day];
      if (current === undefined || current === 'working') {
        row[day] = 'holiday';
      }
    });
  });
}

/** Mon–Fri working, Sat–Sun day off (then public holidays). */
export function applyMonFriWeekendOffPattern(
  grid: RosterGrid,
  employees: RosterEmployee[],
  month: number,
  year: number,
  daysInMonth: number
): void {
  employees.forEach((e) => {
    const row = ensureEmployeeGridRow(grid, e.id, daysInMonth);
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month, d, 12, 0, 0).getDay();
      row[d] = dow === 0 || dow === 6 ? 'dayoff' : 'working';
    }
  });
  applyPublicHolidaysToGrid(grid, employees, month, year, daysInMonth);
}

/** Rotating day off every 7th calendar day (then public holidays). */
export function applyRotatingDayOffPattern(
  grid: RosterGrid,
  employees: RosterEmployee[],
  month: number,
  year: number,
  daysInMonth: number
): void {
  employees.forEach((e) => {
    const row = ensureEmployeeGridRow(grid, e.id, daysInMonth);
    for (let d = 1; d <= daysInMonth; d++) {
      row[d] = d % 7 === 6 ? 'dayoff' : 'working';
    }
  });
  applyPublicHolidaysToGrid(grid, employees, month, year, daysInMonth);
}

/** Reset all cells to working, then re-apply public holidays. */
export function clearGridToWorking(
  grid: RosterGrid,
  employees: RosterEmployee[],
  month: number,
  year: number,
  daysInMonth: number
): void {
  employees.forEach((e) => {
    const row = ensureEmployeeGridRow(grid, e.id, daysInMonth);
    for (let d = 1; d <= daysInMonth; d++) row[d] = 'working';
  });
  applyPublicHolidaysToGrid(grid, employees, month, year, daysInMonth);
}

/** Build editable grid from roster entries + public holidays. */
export function buildRosterGrid(
  employees: RosterEmployee[],
  daysInMonth: number,
  month: number,
  year: number,
  initial?: MonthlyFixedRoster | null,
  leaveTypes: LeaveType[] = []
): RosterGrid {
  const paintTypes = buildRosterPaintTypesWithHoliday(leaveTypes);
  const grid: RosterGrid = {};
  employees.forEach((e) => {
    grid[e.id] = {};
    for (let d = 1; d <= daysInMonth; d++) grid[e.id][d] = 'working';
  });
  if (initial) {
    initial.entries.forEach((ent) => {
      const empKey = resolveRosterEmployeeId(ent.employeeId, employees);
      if (!grid[empKey]) {
        grid[empKey] = {};
        for (let d = 1; d <= daysInMonth; d++) grid[empKey][d] = 'working';
      }
      grid[empKey][ent.day] = resolveEntryToRosterTypeId(ent.leaveType, paintTypes);
    });
  }
  applyPublicHolidaysToGrid(grid, employees, month, year, daysInMonth);
  return grid;
}

/**
 * Paint saved planning cells onto a grid (same calendar day numbers).
 * Used to copy each employee's pattern from a prior month roster.
 */
export function applyPlanningEntriesToGrid(
  grid: RosterGrid,
  employees: RosterEmployee[],
  entries: MonthlyRosterEntry[],
  daysInMonth: number,
  paintTypes: RosterPaintType[],
  scopeEmployees: RosterEmployee[] = employees,
  options?: { staffingPatternOnly?: boolean }
): { cellsApplied: number; employeesWithCells: number } {
  const scopeIds = new Set(scopeEmployees.map((e) => e.id));
  let cellsApplied = 0;
  const employeesWithCells = new Set<string>();

  for (const ent of entries) {
    const empKey = resolveRosterEmployeeId(ent.employeeId, employees);
    if (!scopeIds.has(empKey)) continue;
    if (ent.day < 1 || ent.day > daysInMonth) continue;
    let typeId = resolveEntryToRosterTypeId(ent.leaveType, paintTypes);
    if (options?.staffingPatternOnly) {
      if (typeId === 'working') continue;
      typeId = typeId === 'holiday' ? 'holiday' : 'dayoff';
    }
    if (typeId === 'working') continue;
    const row = ensureEmployeeGridRow(grid, empKey, daysInMonth);
    row[ent.day] = typeId;
    cellsApplied += 1;
    employeesWithCells.add(empKey);
  }

  return { cellsApplied, employeesWithCells: employeesWithCells.size };
}

/** Serialize non-working cells for API persistence. */
export function buildEntriesFromGrid(
  rosterData: RosterGrid,
  employees: RosterEmployee[],
  daysInMonth: number,
  paintTypes: RosterPaintType[] = buildRosterPaintTypesWithHoliday([]),
  /** Preserve leave-sync metadata when re-saving an edited roster. */
  existingEntries: MonthlyRosterEntry[] = []
): MonthlyRosterEntry[] {
  const sourceByCell = new Map<string, string | null>();
  for (const ent of existingEntries) {
    const key = `${ent.employeeId}:${ent.day}`;
    if (ent.sourceLeaveRequestId) sourceByCell.set(key, ent.sourceLeaveRequestId);
  }

  const entries: MonthlyRosterEntry[] = [];
  employees.forEach((e) => {
    const empKey = resolveRosterEmployeeId(e.id, employees);
    for (let d = 1; d <= daysInMonth; d++) {
      const tid = rosterData[e.id]?.[d] || 'working';
      if (tid === 'working') continue;
      const rt = findRosterPaintType(paintTypes, tid);
      entries.push({
        employeeId: empKey,
        day: d,
        leaveType: rt?.name || tid,
        isLocked: true,
        sourceLeaveRequestId: sourceByCell.get(`${empKey}:${d}`) ?? null,
      });
    }
  });
  return entries;
}

/** Grid for PDF/CSV from saved roster + employee list. */
export function rosterToGridData(
  roster: MonthlyFixedRoster,
  employees: RosterEmployee[],
  leaveTypes: LeaveType[] = []
): RosterGrid {
  const days = new Date(roster.year, roster.month + 1, 0).getDate();
  return buildRosterGrid(employees, days, roster.month, roster.year, roster, leaveTypes);
}

function isPayrollWorkDayTypeId(typeId: string, paintTypes: RosterPaintType[]): boolean {
  if (!typeId || typeId === 'working') return true;
  if (typeId === 'holiday' || typeId === 'dayoff') return false;
  if (isRosterScheduledOffDay(typeId) || isRosterHoliday(typeId)) return false;
  const rt = findRosterPaintType(paintTypes, typeId);
  const label = rt?.name ?? rt?.code ?? typeId;
  if (isRosterScheduledOffDay(label) || isRosterHoliday(label)) return false;
  return true;
}

/**
 * Payroll work days from saved roster entries (same rule as backend buildEmployeeRosterSchedule).
 */
export function countRosterPayrollWorkDaysFromEntries(
  entries: MonthlyRosterEntry[],
  employeeId: string,
  employees: RosterEmployee[],
  daysInMonth: number
): number {
  const empKey = resolveRosterEmployeeId(employeeId, employees);
  const dayOffDays = new Set<number>();
  for (const ent of entries) {
    if (resolveRosterEmployeeId(ent.employeeId, employees) !== empKey) continue;
    if (isRosterScheduledOffDay(ent.leaveType) || isRosterHoliday(ent.leaveType)) {
      dayOffDays.add(ent.day);
    }
  }
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (!dayOffDays.has(d)) count += 1;
  }
  return count;
}

/**
 * Payroll work days for one employee row — matches backend Planning roster rule:
 * every calendar day in the month except Day off and Holiday (planned leave still counts).
 */
export function countRosterPayrollWorkDays(
  rosterData: RosterGrid,
  employeeId: string,
  daysInMonth: number,
  paintTypes: RosterPaintType[] = buildRosterPaintTypesWithHoliday([])
): number {
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const tid = rosterData[employeeId]?.[d] ?? 'working';
    if (isPayrollWorkDayTypeId(tid, paintTypes)) count += 1;
  }
  return count;
}

export function rosterEmployeeIdsKey(employees: RosterEmployee[]): string {
  return employees
    .map((e) => e.id)
    .sort()
    .join('|');
}
