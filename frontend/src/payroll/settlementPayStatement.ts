/**
 * Final settlement pay statement — structured so every section subtotal rolls into net payable.
 * Wording follows common Cambodian payroll practice (salary / NSSF / leave payout / clearance).
 */

export type SettlementBreakdownView = {
  baseSalary?: number;
  contractBaseSalary?: number;
  proratedDays?: number;
  seniorityIndemnity?: number;
  backPayment?: number;
  allowances?: Record<string, number>;
  overtime?: {
    hours150?: number;
    amount150?: number;
    hours200?: number;
    amount200?: number;
    total?: number;
  };
  grossSalary?: number;
  deductions?: {
    nssf?: number;
    taxOnSalary?: number;
    absences?: number;
    advances?: number;
    total?: number;
  };
  netSalary?: number;
  taxDependentReliefUsd?: number;
  taxDependents?: number;
  attendanceSummary?: {
    paidDays?: number;
    presentDays?: number;
  };
  payrollAudit?: {
    totalScheduledWorkingDays?: number;
    dailyRate?: number;
    hourlyRate?: number;
  };
  hybrid?: {
    payPeriodStart?: string;
    payPeriodEnd?: string;
    standardDays?: number;
    eligibleDays?: number;
    taxDependentReliefUsd?: number;
    payrollAudit?: { totalScheduledWorkingDays?: number; dailyRate?: number; hourlyRate?: number };
    fixed?: {
      prorationFactor?: number;
      prorationReason?: string | null;
      contractBaseSalary?: number;
    };
  };
};

export type SettlementLineView = {
  code?: string;
  label?: string;
  amountUsd?: number;
  category?: 'earning' | 'deduction';
};

export function parseSettlementBreakdown(raw: unknown): SettlementBreakdownView | null {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' ? (o as SettlementBreakdownView) : null;
  } catch {
    return null;
  }
}

export function parseSettlementLines(raw: unknown): SettlementLineView[] {
  if (!raw) return [];
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(o) ? (o as SettlementLineView[]) : [];
  } catch {
    return [];
  }
}

export type StatementRow = {
  label: string;
  amount: number;
  hint?: string;
};

export type StatementSection = {
  id: string;
  title: string;
  subtitle?: string;
  rows: StatementRow[];
  subtotalLabel: string;
  subtotal: number;
};

export type SettlementPayStatementModel = {
  month: string;
  lastWorkingDate: string;
  presentDays: number | null;
  standardDays: number;
  sections: StatementSection[];
  netPayable: number;
  /** Shown when arithmetic is verified against backend netUsd */
  verification: { workNet: number; adjustments: number; matches: boolean };
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function allowanceTotal(b: SettlementBreakdownView): number {
  const a = b.allowances ?? {};
  return (
    num(a.transport) +
    num(a.attendance) +
    num(a.meal) +
    num(a.seniority) +
    num(a.position) +
    num(a.commission) +
    num(a.otMeal)
  );
}

function splitSettlementLines(lines: SettlementLineView[]) {
  const earnings: StatementRow[] = [];
  const deductions: StatementRow[] = [];
  for (const line of lines) {
    const amt = num(line.amountUsd);
    if (amt <= 0) continue;
    const label = line.label ?? line.code ?? 'Adjustment';
    if (line.category === 'earning') {
      earnings.push({ label, amount: amt });
    } else if (line.category === 'deduction') {
      deductions.push({ label, amount: -amt });
    }
  }
  return { earnings, deductions };
}

export function buildSettlementPayStatement(params: {
  lastWorkingDate?: string | null;
  month?: string | null;
  netUsd?: number | null;
  breakdown?: unknown;
  settlementLines?: unknown;
}): SettlementPayStatementModel | null {
  const breakdown = parseSettlementBreakdown(params.breakdown);
  if (!breakdown) return null;

  const lwd = String(params.lastWorkingDate ?? '').slice(0, 10);
  const month = String(params.month ?? lwd.slice(0, 7) ?? '').slice(0, 7);
  const standardDays =
    breakdown.payrollAudit?.totalScheduledWorkingDays ??
    breakdown.hybrid?.payrollAudit?.totalScheduledWorkingDays ??
    breakdown.hybrid?.standardDays ??
    0;
  const presentDays =
    breakdown.attendanceSummary?.paidDays ??
    breakdown.proratedDays ??
    breakdown.hybrid?.eligibleDays ??
    null;

  const workGross = num(breakdown.grossSalary);
  const workNet = num(breakdown.netSalary);
  const ded = breakdown.deductions ?? {};
  const nssf = num(ded.nssf);
  const tax = num(ded.taxOnSalary);
  const absences = num(ded.absences);
  const advances = num(ded.advances);
  const workDeductions = nssf + tax + absences + advances;

  const base = num(breakdown.baseSalary);
  const contractBase = num(
    breakdown.contractBaseSalary ?? breakdown.hybrid?.fixed?.contractBaseSalary
  );
  const otTotal = num(breakdown.overtime?.total);
  const indemnity = num(breakdown.seniorityIndemnity);
  const allowTotal = allowanceTotal(breakdown);

  const extraLines = parseSettlementLines(params.settlementLines);
  const { earnings: extraEarnings, deductions: extraDeductions } = splitSettlementLines(extraLines);
  const adjustmentsTotal =
    extraEarnings.reduce((s, r) => s + r.amount, 0) +
    extraDeductions.reduce((s, r) => s + r.amount, 0);

  const netPayable =
    params.netUsd != null ? num(params.netUsd) : Math.max(0, workNet + adjustmentsTotal);
  const verification = {
    workNet,
    adjustments: adjustmentsTotal,
    matches: Math.abs(workNet + adjustmentsTotal - netPayable) < 0.02,
  };

  const presentNote =
    presentDays === null
      ? 'Counted from Present/Late attendance through last working date.'
      : presentDays === 0
        ? 'No Present/Late attendance recorded in this month through LWD — salary portion is zero.'
        : `${presentDays} day(s) with Present/Late attendance (of ${standardDays} standard days per month).`;

  const sections: StatementSection[] = [];

  const earningsRows: StatementRow[] = [];
  if (contractBase > base + 0.005) {
    earningsRows.push({
      label: 'Contract base salary (monthly)',
      amount: contractBase,
      hint: 'Full monthly rate before attendance proration',
    });
  }
  earningsRows.push({
    label:
      presentDays === 0
        ? 'Base salary for days worked'
        : 'Base salary for days worked (prorated)',
    amount: base,
  });
  if (indemnity > 0) {
    earningsRows.push({ label: 'Seniority indemnity (Jun/Dec)', amount: indemnity });
  }
  if (allowTotal > 0) {
    earningsRows.push({
      label: 'Fixed allowances (transport, meal, attendance, etc.)',
      amount: allowTotal,
      hint: 'Scaled by days worked when attendance proration applies',
    });
  }
  if (otTotal > 0) {
    earningsRows.push({ label: 'Overtime', amount: otTotal });
  }

  sections.push({
    id: 'work-earnings',
    title: '1. Salary for days worked',
    subtitle: presentNote,
    rows: earningsRows,
    subtotalLabel: 'Gross salary (work portion)',
    subtotal: workGross,
  });

  const statutoryRows: StatementRow[] = [];
  if (nssf > 0) {
    statutoryRows.push({
      label: 'NSSF (employee share)',
      amount: -nssf,
      hint: 'Calculated on salary portion only',
    });
  }
  const depRelief = num(
    breakdown.taxDependentReliefUsd ?? breakdown.hybrid?.taxDependentReliefUsd
  );
  if (depRelief > 0) {
    statutoryRows.push({
      label: 'Dependent tax relief (excluded from taxable salary)',
      amount: depRelief,
      hint: 'Same GDT rule as monthly payroll — reduces salary tax base',
    });
  }
  if (tax > 0) statutoryRows.push({ label: 'Salary tax (ToS)', amount: -tax });
  if (absences > 0) {
    statutoryRows.push({ label: 'Absences / unpaid leave', amount: -absences });
  }
  if (advances > 0) statutoryRows.push({ label: 'Salary advances', amount: -advances });

  sections.push({
    id: 'work-deductions',
    title: '2. Deductions on salary (statutory & attendance)',
    subtitle:
      'These are already included in the net salary below — not subtracted again later.',
    rows:
      statutoryRows.length > 0
        ? statutoryRows
        : [{ label: 'No deductions on salary portion', amount: 0 }],
    subtotalLabel: 'Total deductions on salary',
    subtotal: -workDeductions,
  });

  sections.push({
    id: 'work-net',
    title: '3. Net from salary (after NSSF & tax)',
    subtitle: 'What the employee earned from payroll for days worked in the period.',
    rows: [],
    subtotalLabel: 'Net salary (work portion)',
    subtotal: workNet,
  });

  const adjustmentRows = [...extraEarnings, ...extraDeductions];
  sections.push({
    id: 'adjustments',
    title: '4. Leave payout & clearance (HR entered)',
    subtitle:
      'Unused annual leave paid in cash, loans, assets, or other items agreed at offboarding. Enter amounts on the settlement form.',
    rows:
      adjustmentRows.length > 0
        ? adjustmentRows
        : [
            {
              label: 'No leave encashment or clearance deductions entered',
              amount: 0,
            },
          ],
    subtotalLabel: 'Subtotal adjustments',
    subtotal: adjustmentsTotal,
  });

  return {
    month,
    lastWorkingDate: lwd,
    presentDays,
    standardDays,
    sections,
    netPayable,
    verification,
  };
}
