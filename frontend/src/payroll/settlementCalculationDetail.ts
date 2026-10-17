import {
  buildSettlementPayStatement,
  parseSettlementBreakdown,
  parseSettlementLines,
  type SettlementPayStatementModel,
} from './settlementPayStatement';

export type { SettlementBreakdownView, SettlementLineView } from './settlementPayStatement';
export { parseSettlementBreakdown, parseSettlementLines } from './settlementPayStatement';

export type SettlementCalculationContext = {
  month: string;
  lastWorkingDate: string;
  /** Shown when proration is below 100% — helps explain low prorated-day counts. */
  payPeriodStart?: string;
  payPeriodEnd?: string;
  joinDate?: string;
  prorationReason?: string | null;
  lines: CalculationDisplayLine[];
  /** Structured pay statement — use for finance review (sections balance to net). */
  statement: SettlementPayStatementModel | null;
};

export type CalculationDisplayLine = {
  label: string;
  amount: number;
  section: 'meta' | 'earning' | 'deduction' | 'total';
  emphasis?: boolean;
};

const ALLOWANCE_LABELS: Record<string, string> = {
  transport: 'Transport allowance',
  attendance: 'Attendance incentive',
  meal: 'Meal allowance',
  seniority: 'Seniority allowance',
  position: 'Position allowance',
  commission: 'Commission',
  otMeal: 'OT meal allowance',
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDateKey(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export function buildSettlementCalculationContext(params: {
  lastWorkingDate?: string | null;
  month?: string | null;
  netUsd?: number | null;
  breakdown?: unknown;
  settlementLines?: unknown;
  prorationFactor?: number | null;
  joinDate?: string | null;
}): SettlementCalculationContext | null {
  const breakdown = parseSettlementBreakdown(params.breakdown);
  if (!breakdown) return null;

  const lwd = String(params.lastWorkingDate ?? '').slice(0, 10);
  const month = String(params.month ?? lwd.slice(0, 7) ?? '').slice(0, 7);
  if (!month) return null;

  const lines: CalculationDisplayLine[] = [];
  const hybridRoot = breakdown.hybrid as
    | {
        payPeriodStart?: string;
        payPeriodEnd?: string;
        fixed?: {
          prorationReason?: string | null;
          prorationFactor?: number;
          contractBaseSalary?: number;
          eligibleDays?: number;
          standardDays?: number;
          payrollAudit?: { totalScheduledWorkingDays?: number };
        };
        payrollAudit?: { totalScheduledWorkingDays?: number };
      }
    | undefined;
  const hybrid = (hybridRoot?.fixed ?? breakdown.hybrid?.fixed) as
    | {
        prorationReason?: string | null;
        prorationFactor?: number;
        contractBaseSalary?: number;
        eligibleDays?: number;
        standardDays?: number;
        payrollAudit?: { totalScheduledWorkingDays?: number };
      }
    | undefined;
  const factor =
    params.prorationFactor != null
      ? Number(params.prorationFactor)
      : num(hybrid?.prorationFactor ?? 1);
  const contractBase = num(
    breakdown.contractBaseSalary ?? hybrid?.contractBaseSalary ?? breakdown.baseSalary
  );
  const proratedBase = num(breakdown.baseSalary);

  const prorationReason = hybrid?.prorationReason ?? '';
  const isAttendanceBased =
    prorationReason === 'attendance_present_days' || prorationReason === 'no_attendance_present';
  const summary = breakdown.attendanceSummary;
  const presentDays =
    summary?.paidDays ??
    breakdown.proratedDays ??
    hybrid?.eligibleDays ??
    summary?.presentDays ??
    0;
  const standardDays =
    breakdown.payrollAudit?.totalScheduledWorkingDays ??
    hybrid?.payrollAudit?.totalScheduledWorkingDays ??
    hybrid?.standardDays ??
    0;

  if (isAttendanceBased) {
    const pct = Math.round(factor * 1000) / 10;
    lines.push({
      label:
        presentDays === 0
          ? `Present days through LWD: 0 (no pay for base / fixed allowances)`
          : `Present days through LWD: ${presentDays} of ${standardDays} (${pct}% of monthly fixed pay)`,
      amount: 0,
      section: 'meta',
    });
  } else if (factor < 0.9999) {
    const pct = Math.round(factor * 1000) / 10;
    const daysNote =
      presentDays != null ? ` (${presentDays} of ${standardDays} work days)` : '';
    lines.push({
      label: `Proration through LWD: ${pct}%${daysNote}`,
      amount: 0,
      section: 'meta',
    });
  }

  if (contractBase > proratedBase + 0.005) {
    lines.push({
      label: 'Contract base salary',
      amount: contractBase,
      section: 'earning',
    });
    lines.push({
      label: 'Base salary (prorated)',
      amount: proratedBase,
      section: 'earning',
    });
  } else {
    lines.push({
      label: factor < 0.9999 ? 'Base salary (prorated)' : 'Base salary',
      amount: proratedBase,
      section: 'earning',
    });
  }

  const indemnity = num(breakdown.seniorityIndemnity);
  if (indemnity > 0) {
    lines.push({ label: 'Seniority indemnity', amount: indemnity, section: 'earning' });
  }

  const allowances = breakdown.allowances ?? {};
  for (const [key, value] of Object.entries(allowances)) {
    const amt = num(value);
    if (amt <= 0) continue;
    lines.push({
      label: ALLOWANCE_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      amount: amt,
      section: 'earning',
    });
  }

  const ot = breakdown.overtime;
  const otTotal = num(ot?.total);
  if (otTotal > 0) {
    const h150 = num(ot?.hours150);
    const h200 = num(ot?.hours200);
    const otLabel =
      h150 > 0 || h200 > 0
        ? `Overtime (${h150 ? `${h150}h×1.5` : ''}${h150 && h200 ? ', ' : ''}${h200 ? `${h200}h×2` : ''})`
        : 'Overtime';
    lines.push({ label: otLabel, amount: otTotal, section: 'earning' });
  }

  const backPay = num(breakdown.backPayment);
  if (backPay > 0) {
    lines.push({ label: 'Back pay / adjustment', amount: backPay, section: 'earning' });
  }

  const extraLines = parseSettlementLines(params.settlementLines);
  for (const line of extraLines) {
    const amt = num(line.amountUsd);
    if (amt <= 0) continue;
    if (line.category === 'earning') {
      lines.push({
        label: line.label ?? line.code ?? 'Additional earning',
        amount: amt,
        section: 'earning',
      });
    }
  }

  const gross = num(breakdown.grossSalary);
  lines.push({ label: 'Gross pay', amount: gross, section: 'earning', emphasis: true });

  const ded = breakdown.deductions ?? {};
  const nssf = num(ded.nssf);
  const tax = num(ded.taxOnSalary);
  const absences = num(ded.absences);
  const advances = num(ded.advances);
  if (nssf > 0) lines.push({ label: 'NSSF (employee)', amount: -nssf, section: 'deduction' });
  if (tax > 0) lines.push({ label: 'Salary tax', amount: -tax, section: 'deduction' });
  const depRelief = num(
    breakdown.taxDependentReliefUsd ?? breakdown.hybrid?.taxDependentReliefUsd
  );
  if (depRelief > 0) {
    lines.push({
      label: 'Dependent tax relief (on taxable base)',
      amount: depRelief,
      section: 'meta',
    });
  }
  const dailyRate = num(
    breakdown.payrollAudit?.dailyRate ?? breakdown.hybrid?.payrollAudit?.dailyRate
  );
  if (dailyRate > 0) {
    lines.push({
      label: `Contract daily rate (display): ${dailyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      amount: 0,
      section: 'meta',
    });
  }
  if (absences > 0) lines.push({ label: 'Absences / unpaid leave', amount: -absences, section: 'deduction' });
  if (advances > 0) lines.push({ label: 'Salary advances', amount: -advances, section: 'deduction' });

  for (const line of extraLines) {
    const amt = num(line.amountUsd);
    if (amt <= 0 || line.category !== 'deduction') continue;
    lines.push({
      label: line.label ?? line.code ?? 'Additional deduction',
      amount: -amt,
      section: 'deduction',
    });
  }

  const engineNet = num(breakdown.netSalary);
  lines.push({ label: 'Net (payroll engine)', amount: engineNet, section: 'total', emphasis: true });

  const finalNet = params.netUsd != null ? num(params.netUsd) : engineNet;
  if (Math.abs(finalNet - engineNet) > 0.009) {
    lines.push({
      label: 'Settlement net (after adjustments)',
      amount: finalNet,
      section: 'total',
      emphasis: true,
    });
  }

  return {
    month,
    lastWorkingDate: lwd,
    payPeriodStart: hybridRoot?.payPeriodStart,
    payPeriodEnd: hybridRoot?.payPeriodEnd,
    joinDate: toDateKey(params.joinDate),
    prorationReason: hybrid?.prorationReason ?? null,
    lines,
    statement: buildSettlementPayStatement(params),
  };
}
