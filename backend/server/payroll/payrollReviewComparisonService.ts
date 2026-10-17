import { Op } from 'sequelize';
import { findDisplayIdByEmployeePk, findUserIdByEmployeePk } from '../employeeIdentity.js';
import { Department, Payslip, PayrollRun } from '../db.js';
import { loadBreakdownForPayslipId } from '../payslipBreakdownService.js';
import type { PayrollBreakdown } from '../payrollCalculation.js';
import type { EmploymentReviewFlag } from './payrollReviewContext.js';
import { resolveLastWorkingDate } from './employeePayrollEligibility.js';
import { toDateKey } from './dateKey.js';

const RUN_STATUS_PRIORITY: Record<string, number> = {
  PAID: 7,
  COMPLETED: 7,
  LOCKED: 6,
  APPROVED: 6,
  PAYMENT_PROCESSING: 5,
  PENDING_APPROVAL: 4,
  UNDER_REVIEW: 4,
  PROCESSING: 3,
  DRAFT: 2,
};

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function dateOnly(raw: unknown): string | null {
  return toDateKey(raw);
}

export function previousCalendarMonth(month: string): string {
  const m = month.slice(0, 7);
  const [y, mo] = m.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return m;
  const d = new Date(Date.UTC(y, mo - 2, 1));
  const py = d.getUTCFullYear();
  const pm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

export async function bulkLoadDepartmentNames(
  departmentIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(departmentIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return map;
  const rows = await Department.findAll({
    where: { id: ids },
    attributes: ['id', 'name'],
    raw: true,
  });
  for (const row of rows as { id?: string; name?: string }[]) {
    map.set(String(row.id), String(row.name ?? '').trim() || '—');
  }
  return map;
}

export async function bulkLoadPriorMonthNetByUserId(
  month: string,
  userIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;
  const prevMonth = previousCalendarMonth(month.slice(0, 7));

  const payslips = await Payslip.findAll({
    where: {
      userId: { [Op.in]: ids },
      [Op.or]: [{ month: prevMonth }, { month: { [Op.like]: `${prevMonth}-%` } }],
    },
    attributes: ['id', 'userId', 'payrollRunId', 'generatedAt'],
    order: [['generatedAt', 'DESC']],
    raw: true,
  });
  if (!payslips.length) return map;

  const runIds = [
    ...new Set(
      (payslips as { payrollRunId?: string }[])
        .map((p) => String(p.payrollRunId ?? ''))
        .filter(Boolean)
    ),
  ];
  const runStatusById = new Map<string, string>();
  if (runIds.length) {
    const runs = await PayrollRun.findAll({
      where: { id: runIds },
      attributes: ['id', 'status'],
      raw: true,
    });
    for (const r of runs as { id?: string; status?: string }[]) {
      runStatusById.set(String(r.id), String(r.status ?? 'DRAFT').toUpperCase());
    }
  }

  const bestByUser = new Map<string, { payslipId: string; priority: number }>();
  for (const ps of payslips as { id?: string; userId?: string; payrollRunId?: string }[]) {
    const uid = String(ps.userId ?? '');
    if (!uid) continue;
    const runId = String(ps.payrollRunId ?? '');
    const status = runId ? runStatusById.get(runId) ?? 'DRAFT' : 'DRAFT';
    const priority = RUN_STATUS_PRIORITY[status] ?? 1;
    const existing = bestByUser.get(uid);
    if (!existing || priority > existing.priority) {
      bestByUser.set(uid, { payslipId: String(ps.id), priority });
    }
  }

  for (const [uid, { payslipId }] of bestByUser) {
    const breakdown = payslipId ? await loadBreakdownForPayslipId(payslipId) : null;
    const net = roundUsd(num(breakdown?.netSalary));
    if (Number.isFinite(net)) map.set(uid, net);
  }
  return map;
}

export async function bulkLoadSettlementOverlapUserIds(
  month: string,
  employees: Array<{ userId: string; employeeId: string }>
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!employees.length) return out;
  const userByDisplay = new Map(
    employees.map((e) => [String(e.employeeId).trim(), String(e.userId).trim()])
  );
  const portalIds = new Set(employees.map((e) => String(e.userId).trim()).filter(Boolean));
  try {
    const { FinalSettlementRun } = await import('./finalSettlementSchema.js');
    const rows = await FinalSettlementRun.findAll({
      where: {
        month: month.slice(0, 7),
        status: { [Op.in]: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CALCULATED'] },
      },
      attributes: ['employee_id'],
      raw: true,
    });
    for (const row of rows as { employee_id?: string }[]) {
      const pk = String(row.employee_id ?? '').trim();
      if (!pk) continue;
      const uid = (await findUserIdByEmployeePk(pk)) ?? '';
      if (uid && portalIds.has(uid)) out.add(uid);
      const displayId = (await findDisplayIdByEmployeePk(pk)) ?? '';
      if (displayId && userByDisplay.has(displayId)) out.add(userByDisplay.get(displayId)!);
    }
  } catch {
    /* optional */
  }
  return out;
}

export function resolveEmploymentReviewFlags(
  employee: Record<string, unknown>,
  period: { payPeriodStart: string; payPeriodEnd: string },
  options?: { settlementOverlapUserIds?: Set<string>; userId?: string }
): EmploymentReviewFlag[] {
  const flags: EmploymentReviewFlag[] = [];
  const start = dateOnly(period.payPeriodStart);
  const end = dateOnly(period.payPeriodEnd);
  const join = toDateKey(employee.join_date ?? employee.joinDate);
  const lwd = resolveLastWorkingDate(employee) ?? toDateKey(employee.terminated_at ?? employee.terminatedAt);

  if (start && end && join) {
    if (join >= start && join <= end) {
      flags.push(join > start ? 'mid_month_join' : 'new_hire');
    } else if (join.startsWith(start.slice(0, 7))) {
      flags.push('new_hire');
    }
  }

  if (start && end && lwd && lwd >= start && lwd <= end) {
    const status = String(employee.status ?? '').toLowerCase();
    if (['terminated', 'resigned', 'inactive'].includes(status) || lwd < end) {
      flags.push('resigning');
    }
  }

  const uid = String(options?.userId ?? '').trim();
  if (uid && options?.settlementOverlapUserIds?.has(uid)) {
    flags.push('final_settlement_overlap');
  }

  return flags;
}

export function computeProrationReviewDisplay(
  breakdown: PayrollBreakdown,
  metrics?: { paidDays: number; scheduledWorkingDays: number }
): {
  payableDays: number;
  scheduledWorkingDays: number;
  prorationPct: number;
  prorationLabel: string;
} {
  const hybrid = breakdown.hybrid;
  const paidDays = num(
    metrics?.paidDays ??
      breakdown.attendanceSummary?.paidDays ??
      breakdown.proratedDays ??
      hybrid?.eligibleDays,
    0
  );
  const scheduled = num(
    metrics?.scheduledWorkingDays ??
      breakdown.attendanceSummary?.scheduledWorkDays ??
      breakdown.payrollAudit?.totalScheduledWorkingDays ??
      hybrid?.payrollAudit?.totalScheduledWorkingDays ??
      hybrid?.standardDays,
    0
  );
  const factor = num(hybrid?.fixed?.prorationFactor, 1);
  const prorationPct =
    scheduled > 0
      ? Math.round(Math.min(100, Math.max(0, (paidDays / scheduled) * 100)))
      : factor > 0 && factor <= 1
        ? Math.round(factor * 100)
        : 100;
  const prorationLabel =
    scheduled > 0 ? `${paidDays}/${scheduled} · ${prorationPct}%` : `${paidDays} · ${prorationPct}%`;
  return {
    payableDays: paidDays,
    scheduledWorkingDays: scheduled,
    prorationPct,
    prorationLabel,
  };
}

export function computeNetChange(
  currentNet: number,
  priorNet: number | null | undefined
): { deltaUsd: number | null; deltaPct: number | null } {
  if (priorNet == null || !Number.isFinite(priorNet)) {
    return { deltaUsd: null, deltaPct: null };
  }
  const deltaUsd = roundUsd(currentNet - priorNet);
  const deltaPct =
    priorNet > 0 ? Math.round((deltaUsd / priorNet) * 1000) / 10 : currentNet > 0 ? 100 : 0;
  return { deltaUsd, deltaPct };
}
