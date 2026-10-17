/**
 * Approved leave ↔ calendar dates, with paid/unpaid from LeaveType configuration.
 */
import { Op } from 'sequelize';
import { LeaveRequest, LeaveType } from './db.js';
import { type LeaveDurationFields } from './leaveDuration.js';
import { toDateKey } from './payroll/dateKey.js';

/** Payroll treatment of a leave day. */
export type LeavePayrollCategory = 'payable' | 'deductible' | 'neutral';

export type LeaveDayInfo = {
  typeLabel: string;
  typeCode: string | null;
  isPaid: boolean;
  /** Payroll category (paid -> payable, unpaid -> deductible) unless explicitly overridden. */
  payrollCategory: LeavePayrollCategory;
};

export type LeaveTypeLookup = Map<
  string,
  {
    name: string;
    code: string;
    isPaid: boolean;
    payrollCategory: LeavePayrollCategory;
  }
>;

/** Derive the payroll category from explicit override or the paid flag. */
export function deriveLeavePayrollCategory(params: {
  payrollCategory?: unknown;
  deductSalary?: unknown;
  isPaid: boolean;
}): LeavePayrollCategory {
  const raw = String(params.payrollCategory ?? '').trim().toLowerCase();
  if (raw === 'payable' || raw === 'deductible' || raw === 'neutral') {
    return raw;
  }
  if (params.deductSalary === true) return 'deductible';
  if (params.deductSalary === false) return 'payable';
  return params.isPaid ? 'payable' : 'deductible';
}

let leaveTypeLookupCache: LeaveTypeLookup | null = null;
let leaveTypeLookupLoadedAt = 0;
const LEAVE_TYPE_CACHE_MS = 60_000;

/** Call after leave type create/update/delete so payroll sees fresh paid/unpaid flags. */
export function invalidateLeaveTypeLookupCache(): void {
  leaveTypeLookupCache = null;
  leaveTypeLookupLoadedAt = 0;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

export function isUnpaidLeaveTypeLabel(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === 'unpaid' || t.includes('unpaid');
}

/** Load active leave types for matching request.type (name or code). */
export async function loadLeaveTypeLookup(): Promise<LeaveTypeLookup> {
  const now = Date.now();
  if (leaveTypeLookupCache && now - leaveTypeLookupLoadedAt < LEAVE_TYPE_CACHE_MS) {
    return leaveTypeLookupCache;
  }
  const rows = await LeaveType.findAll({ where: { isActive: true } });
  const map: LeaveTypeLookup = new Map();
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      name?: string;
      code?: string;
      isPaid?: boolean;
      payrollCategory?: unknown;
      deductSalary?: unknown;
    };
    const name = String(p.name ?? '').trim();
    const code = String(p.code ?? '').trim();
    const isPaid = p.isPaid !== false && !isUnpaidLeaveTypeLabel(code) && !isUnpaidLeaveTypeLabel(name);
    const payrollCategory = deriveLeavePayrollCategory({
      payrollCategory: p.payrollCategory,
      deductSalary: p.deductSalary,
      isPaid,
    });
    const entry = { name, code, isPaid, payrollCategory };
    if (name) map.set(normalizeKey(name), entry);
    if (code) map.set(normalizeKey(code), entry);
  }
  leaveTypeLookupCache = map;
  leaveTypeLookupLoadedAt = now;
  return map;
}

/** Whether an approved leave request type counts as paid (default: paid unless UNPAID). */
export function resolveLeaveRequestIsPaid(
  typeLabel: string,
  lookup: LeaveTypeLookup
): boolean {
  const raw = String(typeLabel ?? '').trim();
  if (!raw) return true;
  if (isUnpaidLeaveTypeLabel(raw)) return false;

  const hit = lookup.get(normalizeKey(raw));
  if (hit) return hit.isPaid;

  for (const entry of lookup.values()) {
    if (normalizeKey(entry.name) === normalizeKey(raw)) return entry.isPaid;
    if (entry.code && normalizeKey(entry.code) === normalizeKey(raw)) return entry.isPaid;
  }

  return true;
}

function mapKey(userId: string, dateKey: string): string {
  return `${userId}:${dateKey.slice(0, 10)}`;
}

/**
 * Approved leave per user/day in range (for attendance UI and payroll).
 * When multiple leaves overlap a day, paid leave wins over unpaid.
 */
export async function buildApprovedLeaveByDateForUsers(
  userIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<Map<string, LeaveDayInfo>> {
  const result = new Map<string, LeaveDayInfo>();
  const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return result;

  const from = rangeStart.slice(0, 10);
  const to = rangeEnd.slice(0, 10);
  const lookup = await loadLeaveTypeLookup();

  const rows = await LeaveRequest.findAll({
    where: {
      userId: { [Op.in]: ids },
      status: 'APPROVED',
      startDate: { [Op.lte]: to },
      endDate: { [Op.gte]: from },
    },
  });

  for (const row of rows) {
    const p = row.get({ plain: true }) as LeaveDurationFields & { userId: string; type: string };
    const userId = String(p.userId);
    const typeLabel = String(p.type ?? '').trim() || 'Leave';
    const isPaid = resolveLeaveRequestIsPaid(typeLabel, lookup);
    const matched =
      lookup.get(normalizeKey(typeLabel)) ??
      [...lookup.values()].find((e) => normalizeKey(e.name) === normalizeKey(typeLabel));
    const info: LeaveDayInfo = {
      typeLabel: matched?.name ?? typeLabel,
      typeCode: matched?.code ?? null,
      isPaid,
      payrollCategory:
        matched?.payrollCategory ?? deriveLeavePayrollCategory({ isPaid }),
    };

    expandLeaveToDates(p, (d) => {
      if (d < from || d > to) return;
      const key = mapKey(userId, d);
      const existing = result.get(key);
      if (!existing) {
        result.set(key, info);
        return;
      }
      if (isPaid && !existing.isPaid) result.set(key, info);
    });
  }

  return result;
}

/** Distinct dates with approved paid leave in range. */
export async function getApprovedPaidLeaveDatesForUser(
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Set<string>> {
  const map = await buildApprovedLeaveByDateForUsers([userId], rangeStart, rangeEnd);
  const dates = new Set<string>();
  const prefix = `${userId}:`;
  for (const [key, info] of map) {
    if (!key.startsWith(prefix) || !info.isPaid) continue;
    dates.add(key.slice(prefix.length));
  }
  return dates;
}

export async function attachLeaveDetailsToRecords(
  records: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!records.length) return records;

  let min = '';
  let max = '';
  const userIds: string[] = [];
  for (const r of records) {
    const userId = String(r.userId ?? '').trim();
    const d = String(r.date ?? '').slice(0, 10);
    if (!userId || !d) continue;
    userIds.push(userId);
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return records;

  const leaveMap = await buildApprovedLeaveByDateForUsers(userIds, min, max);

  return records.map((r) => {
    const userId = String(r.userId ?? '').trim();
    const d = String(r.date ?? '').slice(0, 10);
    const leave = leaveMap.get(mapKey(userId, d));
    if (!leave) return r;
    return {
      ...r,
      leaveTypeLabel: leave.typeLabel,
      leaveTypeCode: leave.typeCode,
      leaveIsPaid: leave.isPaid,
    };
  });
}
